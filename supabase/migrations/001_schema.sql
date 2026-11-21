-- Selvi Fireworks: orders database.
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Design: nobody (not even logged-in customers) can read or write these tables directly.
-- The website talks only to the Edge Functions, which use the service role and the functions below.
-- The admin page reads through Row Level Security (admins only).


-- ---------- tables ----------
create table if not exists public.products (
  pid        integer primary key,
  code       text    not null,
  name       text    not null,
  rate       numeric(10,2) not null check (rate >= 0),
  category   text,
  active     boolean not null default true
);

create table if not exists public.bill_counters (
  yy   char(2) primary key,
  last integer not null default 0
);

create table if not exists public.orders (
  id             uuid primary key default gen_random_uuid(),
  bill_no        text not null unique,
  created_at     timestamptz not null default now(),
  cust_name      text not null,
  cust_mobile    text not null check (cust_mobile ~ '^[6-9][0-9]{9}$'),
  cust_email     text,
  cust_pin       text not null check (cust_pin ~ '^[0-9]{6}$'),
  cust_addr      text,
  cust_city      text not null,
  cust_district  text not null,
  cust_state     text,
  subtotal       numeric(12,2) not null,
  packing        numeric(12,2) not null,
  total          numeric(12,2) not null,
  status         text not null default 'placed'
                 check (status in ('placed','packed','transporting','arrived','cancelled')),
  payment_status text not null default 'submitted'
                 check (payment_status in ('submitted','verified','rejected')),
  utr            text,
  screenshot_path text
);
create index if not exists orders_mobile_idx  on public.orders (cust_mobile);
create index if not exists orders_created_idx on public.orders (created_at desc);

create table if not exists public.order_items (
  id       bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  pid      integer not null,
  code     text not null,
  name     text not null,
  rate     numeric(10,2) not null,
  qty      integer not null check (qty > 0),
  amount   numeric(12,2) not null
);
create index if not exists order_items_order_idx on public.order_items (order_id);

create table if not exists public.order_events (
  id       bigserial primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status   text not null,
  note     text,
  by_user  uuid,
  at       timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id);

create table if not exists public.notifications (
  id          bigserial primary key,
  order_id    uuid references public.orders(id) on delete cascade,
  channel     text not null check (channel in ('whatsapp','sms','email')),
  template    text not null,
  to_addr     text,
  audience    text not null default 'customer',
  status      text not null check (status in ('sent','failed','skipped')),
  provider_id text,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_order_idx on public.notifications (order_id);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note    text
);

create table if not exists public.lookup_failures (
  bill_no text not null,
  at      timestamptz not null default now()
);
create index if not exists lookup_failures_idx on public.lookup_failures (bill_no, at);

-- ---------- bill numbers: SF + 2-digit year + 3-digit counter (SF26001); restarts each year ----------
create or replace function public.next_bill_no(p_now timestamptz default now())
returns text language plpgsql security definer set search_path = public as $$
declare
  y text := to_char(p_now at time zone 'Asia/Kolkata', 'YY');
  n integer;
begin
  insert into public.bill_counters (yy, last) values (y, 1)
  on conflict (yy) do update set last = public.bill_counters.last + 1
  returning last into n;
  -- lpad would cut a 4-digit number to 3 digits, so only pad below 1000
  return 'SF' || y || case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
end $$;

-- ---------- helpers ----------
create or replace function public.norm_mobile(m text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(m, ''), '\D', '', 'g'), 10)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;

-- the order as the website / notifications need it
create or replace function public.order_json(o public.orders)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'no', o.bill_no,
    'date', o.created_at,
    'status', o.status,
    'payment_status', o.payment_status,
    'subtotal', o.subtotal, 'packing', o.packing, 'total', o.total,
    'customer', jsonb_build_object(
      'name', o.cust_name, 'mobile', o.cust_mobile, 'email', o.cust_email, 'pin', o.cust_pin,
      'addr', o.cust_addr, 'city', o.cust_city, 'district', o.cust_district, 'state', o.cust_state),
    'payment', jsonb_build_object('utr', o.utr, 'method', 'UPI'),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'pid', i.pid, 'code', i.code, 'name', i.name, 'rate', i.rate, 'qty', i.qty, 'amt', i.amount) order by i.id)
        from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note', e.note) order by e.id)
        from public.order_events e where e.order_id = o.id), '[]'::jsonb)
  )
$$;

-- ---------- create an order (prices are re-checked here, so a customer cannot change them) ----------
create or replace function public.create_order(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c        jsonb := p->'customer';
  mob      text  := public.norm_mobile(c->>'mobile');
  n_items  integer;
  n_found  integer;
  sub      numeric(12,2);
  pack     numeric(12,2);
  tot      numeric(12,2);
  client_t numeric;
  o        public.orders;
begin
  if coalesce(length(trim(c->>'name')), 0) < 2 then raise exception 'INVALID: name'; end if;
  if mob !~ '^[6-9][0-9]{9}$' then raise exception 'INVALID: mobile'; end if;
  if coalesce(c->>'pin', '') !~ '^[0-9]{6}$' then raise exception 'INVALID: pincode'; end if;
  if coalesce(length(trim(c->>'city')), 0) < 2 then raise exception 'INVALID: city'; end if;
  if coalesce(length(trim(c->>'district')), 0) < 2 then raise exception 'INVALID: district'; end if;
  if coalesce(length(p->>'screenshot_path'), 0) = 0 then raise exception 'INVALID: payment screenshot'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0
     or jsonb_array_length(p->'items') > 250 then raise exception 'INVALID: items'; end if;

  -- merge duplicate products, validate quantities
  create temp table if not exists _cart (pid integer, qty integer) on commit drop;
  delete from _cart;
  insert into _cart (pid, qty)
  select (x->>'pid')::integer, sum((x->>'qty')::integer)
  from jsonb_array_elements(p->'items') x
  group by 1;
  if exists (select 1 from _cart where qty is null or qty < 1 or qty > 100000) then
    raise exception 'INVALID: quantity';
  end if;

  select count(*) into n_items from _cart;
  select count(*), coalesce(sum(round(cr.qty * pr.rate, 2)), 0)
    into n_found, sub
  from _cart cr join public.products pr on pr.pid = cr.pid and pr.active;
  if n_found <> n_items then raise exception 'INVALID: unknown product'; end if;

  pack := round(sub * 0.03, 2);
  tot  := sub + pack;
  if tot < 5000 then raise exception 'MIN_ORDER: total % is below 5000', tot; end if;

  client_t := nullif(p->>'client_total', '')::numeric;
  if client_t is not null and abs(client_t - tot) > 1 then
    raise exception 'PRICE_MISMATCH: expected %', tot;
  end if;

  if (select count(*) from public.orders where cust_mobile = mob and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'TOO_MANY: please wait a few minutes';
  end if;

  insert into public.orders (bill_no, cust_name, cust_mobile, cust_email, cust_pin, cust_addr, cust_city,
                             cust_district, cust_state, subtotal, packing, total, utr, screenshot_path)
  values (public.next_bill_no(), trim(c->>'name'), mob, nullif(trim(c->>'email'), ''), c->>'pin',
          nullif(trim(c->>'addr'), ''), trim(c->>'city'), trim(c->>'district'), nullif(trim(c->>'state'), ''),
          sub, pack, tot, nullif(trim(p->>'utr'), ''), p->>'screenshot_path')
  returning * into o;

  insert into public.order_items (order_id, pid, code, name, rate, qty, amount)
  select o.id, pr.pid, pr.code, pr.name, pr.rate, cr.qty, round(cr.qty * pr.rate, 2)
  from _cart cr join public.products pr on pr.pid = cr.pid
  order by pr.pid;

  insert into public.order_events (order_id, status, note) values (o.id, 'placed', 'Order placed with payment screenshot');

  return public.order_json(o);
end $$;

-- ---------- customer lookup: bill number + mobile, with a simple brute-force limit ----------
create or replace function public.get_order(p_no text, p_mobile text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  no_ text := upper(trim(coalesce(p_no, '')));
  o   public.orders;
begin
  delete from public.lookup_failures where at < now() - interval '1 day';
  if (select count(*) from public.lookup_failures where bill_no = no_ and at > now() - interval '1 hour') >= 10 then
    raise exception 'RATE_LIMIT: too many attempts, try again later';
  end if;
  select * into o from public.orders where bill_no = no_ and cust_mobile = public.norm_mobile(p_mobile);
  if not found then
    insert into public.lookup_failures (bill_no) values (no_);
    return null;
  end if;
  return public.order_json(o);
end $$;

-- ---------- admin actions (called only by the admin Edge Function) ----------
create or replace function public.set_order_status(p_no text, p_status text, p_by uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where bill_no = upper(trim(p_no)) for update;
  if not found then raise exception 'NOT_FOUND: order'; end if;
  if p_status = o.status then raise exception 'NO_CHANGE: already %', p_status; end if;
  if not (
       (o.status = 'placed'       and p_status in ('packed', 'cancelled'))
    or (o.status = 'packed'       and p_status in ('transporting', 'cancelled'))
    or (o.status = 'transporting' and p_status in ('arrived', 'cancelled'))
  ) then
    raise exception 'BAD_TRANSITION: % -> %', o.status, p_status;
  end if;
  update public.orders set status = p_status where id = o.id returning * into o;
  insert into public.order_events (order_id, status, note, by_user) values (o.id, p_status, p_note, p_by);
  return public.order_json(o);
end $$;

create or replace function public.set_payment_status(p_no text, p_ps text, p_by uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if p_ps not in ('verified', 'rejected') then raise exception 'INVALID: payment status'; end if;
  update public.orders set payment_status = p_ps where bill_no = upper(trim(p_no)) returning * into o;
  if not found then raise exception 'NOT_FOUND: order'; end if;
  insert into public.order_events (order_id, status, note, by_user)
  values (o.id, 'payment_' || p_ps, p_note, p_by);
  return public.order_json(o);
end $$;

-- ---------- lock everything down ----------
alter table public.products        enable row level security;
alter table public.bill_counters    enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.order_events     enable row level security;
alter table public.notifications    enable row level security;
alter table public.admins           enable row level security;
alter table public.lookup_failures  enable row level security;

-- admins (logged-in staff listed in public.admins) may read; nobody else gets any policy
drop policy if exists admin_read_orders on public.orders;
create policy admin_read_orders        on public.orders        for select to authenticated using (public.is_admin());
drop policy if exists admin_read_items on public.order_items;
create policy admin_read_items         on public.order_items   for select to authenticated using (public.is_admin());
drop policy if exists admin_read_events on public.order_events;
create policy admin_read_events        on public.order_events  for select to authenticated using (public.is_admin());
drop policy if exists admin_read_notifs on public.notifications;
create policy admin_read_notifs        on public.notifications for select to authenticated using (public.is_admin());
drop policy if exists admin_read_products on public.products;
create policy admin_read_products      on public.products      for select to authenticated using (public.is_admin());
drop policy if exists admin_read_self on public.admins;
create policy admin_read_self          on public.admins        for select to authenticated using (user_id = auth.uid());

-- the SQL functions are for the Edge Functions (service role) only
revoke all on function public.create_order(jsonb)                          from public, anon, authenticated;
revoke all on function public.get_order(text, text)                        from public, anon, authenticated;
revoke all on function public.set_order_status(text, text, uuid, text)     from public, anon, authenticated;
revoke all on function public.set_payment_status(text, text, uuid, text)   from public, anon, authenticated;
revoke all on function public.next_bill_no(timestamptz)                    from public, anon, authenticated;
revoke all on function public.order_json(public.orders)                    from public, anon, authenticated;
grant execute on function public.create_order(jsonb)                       to service_role;
grant execute on function public.get_order(text, text)                     to service_role;
grant execute on function public.set_order_status(text, text, uuid, text)  to service_role;
grant execute on function public.set_payment_status(text, text, uuid, text) to service_role;
grant execute on function public.is_admin()                                to authenticated;

-- ---------- private storage for payment screenshots ----------
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

drop policy if exists admin_read_proofs on storage.objects;
create policy admin_read_proofs on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());
