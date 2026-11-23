-- 005: orders no longer need a payment screenshot (the bill carries the UPI QR);
-- packing photo + LR copy are saved when the admin moves an order to Packed / Transporting;
-- customer login also checks the name.

alter table public.orders add column if not exists packed_photo text;
alter table public.orders add column if not exists lr_copy      text;
alter table public.orders add column if not exists prev_status  text;   -- status before a cancel (so a cancel can be undone)

alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders add constraint orders_payment_status_check
  check (payment_status in ('pending','submitted','verified','rejected'));
alter table public.orders alter column payment_status set default 'pending';

-- public bucket for packing photos / LR copies (random file names; not sensitive)
insert into storage.buckets (id, name, public) values ('dispatch-files', 'dispatch-files', true)
on conflict (id) do nothing;

create or replace function public.order_json(o public.orders)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'no', o.bill_no,
    'date', o.created_at,
    'status', o.status,
    'payment_status', o.payment_status,
    'packed_photo', o.packed_photo, 'lr_copy', o.lr_copy,
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
  pct      numeric := public.setting_num('PACKING-PERCENTAGE', 3);
  minv     numeric := public.setting_num('MIN-ORDER-VALUE', 5000);
begin
  if upper(coalesce((select value from public.settings where key = 'ORDER_ENABLE_FLAG'), 'TRUE')) <> 'TRUE' then
    raise exception 'INVALID: online booking is switched off right now';
  end if;
  if coalesce(length(trim(c->>'name')), 0) < 2 then raise exception 'INVALID: name'; end if;
  if mob !~ '^[6-9][0-9]{9}$' then raise exception 'INVALID: mobile'; end if;
  if coalesce(c->>'pin', '') !~ '^[0-9]{6}$' then raise exception 'INVALID: pincode'; end if;
  if coalesce(length(trim(c->>'city')), 0) < 2 then raise exception 'INVALID: city'; end if;
  if coalesce(length(trim(c->>'district')), 0) < 2 then raise exception 'INVALID: district'; end if;
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

  pack := round(sub * pct / 100, 2);
  tot  := sub + pack;
  if tot < minv then raise exception 'MIN_ORDER: total % is below %', tot, minv; end if;

  client_t := nullif(p->>'client_total', '')::numeric;
  if client_t is not null and abs(client_t - tot) > 1 then
    raise exception 'PRICE_MISMATCH: expected %', tot;
  end if;

  if (select count(*) from public.orders where cust_mobile = mob and created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'TOO_MANY: please wait a few minutes';
  end if;

  insert into public.orders (bill_no, cust_name, cust_mobile, cust_email, cust_pin, cust_addr, cust_city,
                             cust_district, cust_state, subtotal, packing, total, utr, screenshot_path, payment_status)
  values (public.next_bill_no(), trim(c->>'name'), mob, nullif(trim(c->>'email'), ''), c->>'pin',
          nullif(trim(c->>'addr'), ''), trim(c->>'city'), trim(c->>'district'), nullif(trim(c->>'state'), ''),
          sub, pack, tot, nullif(trim(p->>'utr'), ''), nullif(p->>'screenshot_path', ''),
          case when coalesce(p->>'screenshot_path', '') <> '' then 'submitted' else 'pending' end)
  returning * into o;

  insert into public.order_items (order_id, pid, code, name, rate, qty, amount)
  select o.id, pr.pid, pr.code, pr.name, pr.rate, cr.qty, round(cr.qty * pr.rate, 2)
  from _cart cr join public.products pr on pr.pid = cr.pid
  order by pr.pid;

  insert into public.order_events (order_id, status, note) values (o.id, 'placed', 'Order placed');

  return public.order_json(o);
end $$;

-- dispatch: Packed needs the packing photo, Transporting needs the LR copy
drop function if exists public.set_order_status(text, text, uuid, text);
create or replace function public.set_order_status(p_no text, p_status text, p_by uuid, p_note text default null, p_file text default null)
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
  if p_status = 'packed' and coalesce(p_file, '') = '' then raise exception 'INVALID: Please add the packing photo.'; end if;
  if p_status = 'transporting' and coalesce(p_file, '') = '' then raise exception 'INVALID: Please upload the LR copy.'; end if;
  update public.orders set status = p_status,
         prev_status  = case when p_status = 'cancelled' then o.status else prev_status end,
         packed_photo = case when p_status = 'packed' then p_file else packed_photo end,
         lr_copy      = case when p_status = 'transporting' then p_file else lr_copy end
   where id = o.id returning * into o;
  insert into public.order_events (order_id, status, note, by_user) values (o.id, p_status, p_note, p_by);
  return public.order_json(o);
end $$;
revoke all on function public.set_order_status(text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_order_status(text, text, uuid, text, text) to service_role;

-- login asks for the name as well as the mobile number
drop function if exists public.store_otp(text, text, text);
create or replace function public.store_otp(p_mobile text, p_hash text, p_mode text, p_name text default null)
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
  if p_mode = 'login' and lower(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g')) <>
     (select lower(regexp_replace(trim(name), '\s+', ' ', 'g')) from public.customers where mobile = mob) then
    raise exception 'NO_ACCOUNT: The name and mobile number do not match. Please check them.';
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
revoke all on function public.store_otp(text, text, text, text) from public, anon, authenticated;
grant execute on function public.store_otp(text, text, text, text) to service_role;

-- undo the last step (admin made a mistake): Arrived -> Transporting -> Packed -> Order placed -> payment back to pending;
-- a cancelled order goes back to where it was
create or replace function public.undo_order_step(p_no text, p_by uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  old_s text;
  new_s text;
begin
  select * into o from public.orders where bill_no = upper(trim(p_no)) for update;
  if not found then raise exception 'NOT_FOUND: order'; end if;
  old_s := o.status;
  if old_s = 'cancelled' then new_s := coalesce(o.prev_status, 'placed');
  elsif old_s = 'arrived' then new_s := 'transporting';
  elsif old_s = 'transporting' then new_s := 'packed';
  elsif old_s = 'packed' then new_s := 'placed';
  elsif o.payment_status in ('verified', 'rejected') then
    update public.orders set payment_status = 'pending' where id = o.id returning * into o;
    insert into public.order_events (order_id, status, note, by_user) values (o.id, 'undo_payment', p_note, p_by);
    return public.order_json(o);
  else
    raise exception 'NO_CHANGE: There is nothing to undo.';
  end if;
  update public.orders set status = new_s,
         lr_copy      = case when old_s = 'transporting' then null else lr_copy end,
         packed_photo = case when old_s = 'packed' then null else packed_photo end
   where id = o.id returning * into o;
  insert into public.order_events (order_id, status, note, by_user) values (o.id, 'undo_' || old_s, p_note, p_by);
  return public.order_json(o);
end $$;
revoke all on function public.undo_order_step(text, uuid, text) from public, anon, authenticated;
grant execute on function public.undo_order_step(text, uuid, text) to service_role;

-- product photos (admin uploads from the Products form; public bucket, random file names)
alter table public.products add column if not exists image_path text;
insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true)
on conflict (id) do nothing;
drop policy if exists admin_write_product_images on storage.objects;
create policy admin_write_product_images on storage.objects for all to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
