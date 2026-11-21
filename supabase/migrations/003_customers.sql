-- Customer accounts: sign up / log in with a mobile number and an OTP.
-- Run after 001 and 002 (Supabase SQL Editor). Nothing here is readable by the public; only the `account`
-- Edge Function (service role) uses these tables and functions.

create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  mobile        text not null unique check (mobile ~ '^[6-9][0-9]{9}$'),
  name          text not null,
  email         text,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists public.otp_codes (
  mobile       text primary key,
  code_hash    text not null,                    -- sha256 of code + mobile + secret; the code itself is never stored
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  sent_count   integer not null default 1,
  window_start timestamptz not null default now(),
  sent_at      timestamptz not null default now()
);

create table if not exists public.customer_sessions (
  token_hash  text primary key,                  -- sha256 of the token kept in the customer's browser
  customer_id uuid not null references public.customers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists customer_sessions_customer_idx on public.customer_sessions (customer_id);

alter table public.customers         enable row level security;
alter table public.otp_codes         enable row level security;
alter table public.customer_sessions enable row level security;
-- (no policies on purpose: only the service role can touch these tables)

-- ask for a code: limits 1 per 30 seconds and 5 per hour per number
create or replace function public.store_otp(p_mobile text, p_hash text, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  mob text := public.norm_mobile(p_mobile);
  o   public.otp_codes;
  has boolean;
begin
  if mob !~ '^[6-9][0-9]{9}$' then raise exception 'INVALID: Enter a valid 10-digit mobile number.'; end if;
  has := exists (select 1 from public.customers where mobile = mob);
  if p_mode = 'login' and not has then
    raise exception 'NO_ACCOUNT: No account found for this number. Please sign up first.';
  end if;

  select * into o from public.otp_codes where mobile = mob;
  if found then
    if o.sent_at > now() - interval '30 seconds' then
      raise exception 'TOO_MANY: Please wait 30 seconds before asking for another code.';
    end if;
    if o.window_start > now() - interval '1 hour' and o.sent_count >= 5 then
      raise exception 'RATE_LIMIT: Too many codes requested. Please try again in an hour.';
    end if;
  end if;

  insert into public.otp_codes (mobile, code_hash, expires_at, attempts, sent_count, window_start, sent_at)
  values (mob, p_hash, now() + interval '10 minutes', 0, 1, now(), now())
  on conflict (mobile) do update set
    code_hash    = excluded.code_hash,
    expires_at   = excluded.expires_at,
    attempts     = 0,
    sent_count   = case when public.otp_codes.window_start > now() - interval '1 hour' then public.otp_codes.sent_count + 1 else 1 end,
    window_start = case when public.otp_codes.window_start > now() - interval '1 hour' then public.otp_codes.window_start else now() end,
    sent_at      = now();
  return jsonb_build_object('mobile', mob, 'exists', has);
end $$;

-- check the code; on success create the account (first time) and a 30-day session
create or replace function public.verify_otp(p_mobile text, p_hash text, p_name text, p_email text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  mob text := public.norm_mobile(p_mobile);
  o   public.otp_codes;
  c   public.customers;
begin
  select * into o from public.otp_codes where mobile = mob for update;
  if not found or o.expires_at < now() then raise exception 'INVALID: The code has expired. Please ask for a new one.'; end if;
  if o.attempts >= 5 then raise exception 'RATE_LIMIT: Too many wrong codes. Please ask for a new code.'; end if;
  if o.code_hash <> p_hash then
    -- return (not raise): a raised error would roll the attempt counter back and allow unlimited guesses
    update public.otp_codes set attempts = attempts + 1 where mobile = mob;
    return jsonb_build_object('error', 'INVALID: Wrong code. Please check and try again.');
  end if;
  delete from public.otp_codes where mobile = mob;

  select * into c from public.customers where mobile = mob;
  if not found then
    if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'INVALID: Please enter your name to create the account.'; end if;
    insert into public.customers (mobile, name, email, last_login_at)
    values (mob, trim(p_name), nullif(trim(coalesce(p_email, '')), ''), now()) returning * into c;
  else
    update public.customers set last_login_at = now() where id = c.id returning * into c;
  end if;

  insert into public.customer_sessions (token_hash, customer_id, expires_at)
  values (p_token_hash, c.id, now() + interval '30 days');
  delete from public.customer_sessions where expires_at < now();

  return jsonb_build_object('id', c.id, 'name', c.name, 'mobile', c.mobile, 'email', c.email, 'new', c.created_at > now() - interval '1 minute');
end $$;

create or replace function public.session_customer(p_token_hash text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'mobile', c.mobile, 'email', c.email)
  from public.customer_sessions s join public.customers c on c.id = s.customer_id
  where s.token_hash = p_token_hash and s.expires_at > now()
$$;

-- every order placed with the customer's verified mobile number (any device)
create or replace function public.customer_orders(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  cust jsonb := public.session_customer(p_token_hash);
begin
  if cust is null then raise exception 'UNAUTHORIZED: Please log in again.'; end if;
  return coalesce((select jsonb_agg(public.order_json(o) order by o.created_at desc)
                   from (select * from public.orders where cust_mobile = cust->>'mobile' order by created_at desc limit 100) o), '[]'::jsonb);
end $$;

create or replace function public.update_customer(p_token_hash text, p_name text, p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cust jsonb := public.session_customer(p_token_hash);
begin
  if cust is null then raise exception 'UNAUTHORIZED: Please log in again.'; end if;
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'INVALID: Please enter your name.'; end if;
  if nullif(trim(coalesce(p_email, '')), '') is not null and p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID: Please enter a valid email address.';
  end if;
  update public.customers set name = trim(p_name), email = nullif(trim(coalesce(p_email, '')), '')
  where id = (cust->>'id')::uuid;
  return public.session_customer(p_token_hash);
end $$;

create or replace function public.end_session(p_token_hash text)
returns void language sql security definer set search_path = public as $$
  delete from public.customer_sessions where token_hash = p_token_hash
$$;

revoke all on function public.store_otp(text, text, text)                       from public, anon, authenticated;
revoke all on function public.verify_otp(text, text, text, text, text)          from public, anon, authenticated;
revoke all on function public.session_customer(text)                            from public, anon, authenticated;
revoke all on function public.customer_orders(text)                             from public, anon, authenticated;
revoke all on function public.update_customer(text, text, text)                 from public, anon, authenticated;
revoke all on function public.end_session(text)                                 from public, anon, authenticated;
grant execute on function public.store_otp(text, text, text)                    to service_role;
grant execute on function public.verify_otp(text, text, text, text, text)       to service_role;
grant execute on function public.session_customer(text)                         to service_role;
grant execute on function public.customer_orders(text)                          to service_role;
grant execute on function public.update_customer(text, text, text)              to service_role;
grant execute on function public.end_session(text)                              to service_role;
