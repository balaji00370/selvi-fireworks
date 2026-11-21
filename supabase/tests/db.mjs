// Test helper: a real Postgres (WASM) with just enough of Supabase's auth/storage schemas stubbed
// to run the migrations unchanged.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mig = n => readFileSync(join(here, '..', 'migrations', n), 'utf8');

export async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
  `);
  await db.exec(mig('001_schema.sql'));
  await db.exec(mig('002_seed_products.sql'));
  await db.exec(mig('003_customers.sql'));
  await db.exec(mig('004_catalogue.sql'));
  return db;
}

export const customer = (over = {}) => ({
  name: 'Balaji S S', mobile: '+91 86101 63060', email: '', pin: '625501',
  addr: '', city: 'Vadipatti', district: 'Madurai', state: 'TamilNadu', ...over
});

export async function createOrder(db, payload) {
  const r = await db.query('select public.create_order($1::jsonb) as o', [JSON.stringify(payload)]);
  return r.rows[0].o;
}
