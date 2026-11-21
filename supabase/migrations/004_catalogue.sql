-- 004: admin-managed catalogue (brand, category, product details) and settings.
-- Customers read these publicly; only admins (public.admins) can change them.

create table if not exists public.brands (
  id      serial primary key,
  name    text not null unique,
  details text not null default '',
  rank    integer not null default 10,
  active  boolean not null default true
);
create table if not exists public.categories (
  id       serial primary key,
  name     text not null unique,
  details  text not null default '',
  brand_id integer references public.brands(id),
  rank     integer not null default 10,
  active   boolean not null default true
);
create table if not exists public.settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists packing     text not null default '1 Pkt';
alter table public.products add column if not exists list_price  numeric(10,2);
alter table public.products add column if not exists rank        integer not null default 0;
alter table public.products add column if not exists category_id integer references public.categories(id);
create sequence if not exists public.products_pid_seq start 1000;
alter table public.products alter column pid set default nextval('public.products_pid_seq');

-- first run: build brand / categories from the existing price list
insert into public.brands (name, details) values ('Selvi Fireworks', 'Selvi Fireworks') on conflict (name) do nothing;
insert into public.categories (name, details, brand_id, rank)
select category, category, (select id from public.brands where name = 'Selvi Fireworks'), (row_number() over (order by min(pid)))::int * 10
from public.products where category is not null group by category
on conflict (name) do nothing;
update public.products p set category_id = c.id from public.categories c where c.name = p.category and p.category_id is null;
update public.products set list_price = rate where list_price is null;
update public.products set rank = sub.r from (select pid, (row_number() over (partition by category_id order by pid))::int * 10 as r from public.products) sub
  where sub.pid = public.products.pid and public.products.rank = 0;

-- settings (the values the site and the order form use)
insert into public.settings (key, value) values
  ('PACKING-PERCENTAGE', '3'), ('GST-PERCENTAGE', '0'), ('DISCOUNT-PERCENTAGE', '0'),
  ('MIN-ORDER-VALUE', '5000'), ('ORDER_ENABLE_FLAG', 'TRUE'),
  ('ORDER_UPI_ID', 'gokulelangovan7999-1@okaxis'), ('ORDER_UPI_NAME', 'Selvi Fireworks'),
  ('BANK1_NAME', 'Gokul E'), ('BANK1_BANK', 'BANK OF BARODA'), ('BANK1_BRANCH', 'SIVAKASI'),
  ('BANK1_ADDR', 'SIVAKASI'), ('BANK1_STATE', 'Tamilnadu'), ('BANK1_NUMBER', '33090100008319'), ('BANK1_IFSC', 'BARB0SIVAKA'),
  ('ADMIN_NO', '9159017999'), ('ADMIN_TXT', '+91-91590-17999'),
  ('CONTACT_TOP_NO', '9159017999'), ('CONTACT_TOP_TXT', '+91-91590-17999'),
  ('COMPANY_CITY', 'Selvi Fireworks, Sivakasi'), ('ORDER-EMAIL', 'jjselvifireworks@gmail.com')
on conflict (key) do nothing;

create or replace function public.setting_num(k text, d numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value, '')::numeric from public.settings where key = k), d)
$$;

-- orders now follow the settings (packing %, minimum value, on/off switch)
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

-- ---------- access ----------
alter table public.brands     enable row level security;
alter table public.categories enable row level security;
alter table public.settings   enable row level security;

drop policy if exists pub_read_brands on public.brands;
create policy pub_read_brands on public.brands for select to anon, authenticated using (active or public.is_admin());
drop policy if exists pub_read_categories on public.categories;
create policy pub_read_categories on public.categories for select to anon, authenticated using (active or public.is_admin());
drop policy if exists pub_read_settings on public.settings;
create policy pub_read_settings on public.settings for select to anon, authenticated using (true);
drop policy if exists pub_read_products on public.products;
create policy pub_read_products on public.products for select to anon using (active);

drop policy if exists admin_write_brands on public.brands;
create policy admin_write_brands on public.brands for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_write_categories on public.categories;
create policy admin_write_categories on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_write_settings on public.settings;
create policy admin_write_settings on public.settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_write_products on public.products;
create policy admin_write_products on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.brands, public.categories, public.settings, public.products to anon, authenticated;
grant insert, update, delete on public.brands, public.categories, public.settings, public.products to authenticated;
grant usage, select on all sequences in schema public to authenticated;
