import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, customer, createOrder } from './db.mjs';

const good = (over = {}) => ({
  customer: customer(), items: [{ pid: 131, qty: 7 }], utr: '412345678901',
  screenshot_path: 'proofs/abc.jpg', client_total: 5227.25, ...over
});
const rejects = async (p, re) => assert.rejects(p, e => re.test(e.message));

test('seed has the full price list', async () => {
  const db = await freshDb();
  const r = await db.query('select count(*)::int n from products');
  assert.equal(r.rows[0].n, 153);
  const h = await db.query('select rate::float r, code from products where pid = 131');
  assert.equal(h.rows[0].r, 725);
});

test('creates an order with server-side totals and first bill number', async () => {
  const db = await freshDb();
  const o = await createOrder(db, good());
  assert.equal(o.no.startsWith('SF'), true);
  assert.match(o.no, /^SF\d{2}001$/);
  assert.equal(Number(o.subtotal), 5075);
  assert.equal(Number(o.packing), 152.25);
  assert.equal(Number(o.total), 5227.25);
  assert.equal(o.customer.mobile, '8610163060');           // normalised
  assert.equal(o.status, 'placed');
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].name, 'Happy Diwali- 36 Items');
  assert.equal(o.history.length, 1);
});

test('bill numbers count up, go past 999 without losing digits, and restart each year', async () => {
  const db = await freshDb();
  const n = async d => (await db.query('select next_bill_no($1::timestamptz) b', [d])).rows[0].b;
  assert.equal(await n('2026-03-01T10:00:00+05:30'), 'SF26001');
  assert.equal(await n('2026-11-01T10:00:00+05:30'), 'SF26002');
  await db.exec(`update bill_counters set last = 998 where yy = '26'`);
  assert.equal(await n('2026-12-01T10:00:00+05:30'), 'SF26999');
  assert.equal(await n('2026-12-02T10:00:00+05:30'), 'SF261000');
  assert.equal(await n('2026-12-03T10:00:00+05:30'), 'SF261001');
  // IST: 31 Dec 2026 20:00 UTC is already 1 Jan 2027 in India
  assert.equal(await n('2026-12-31T20:00:00Z'), 'SF27001');
  assert.equal(await n('2027-06-01T10:00:00+05:30'), 'SF27002');
});

test('rejects tampered prices, unknown products and small orders', async () => {
  const db = await freshDb();
  await rejects(createOrder(db, good({ client_total: 100 })), /PRICE_MISMATCH/);
  await rejects(createOrder(db, good({ items: [{ pid: 99999, qty: 5 }] })), /unknown product/);
  await rejects(createOrder(db, good({ items: [{ pid: 131, qty: 2 }], client_total: 1493.5 })), /MIN_ORDER/);
  await rejects(createOrder(db, good({ items: [{ pid: 131, qty: 0 }] })), /quantity/);
  await rejects(createOrder(db, good({ items: [] })), /items/);
});

test('validates customer details and the payment screenshot', async () => {
  const db = await freshDb();
  await rejects(createOrder(db, good({ customer: customer({ name: 'A' }) })), /name/);
  await rejects(createOrder(db, good({ customer: customer({ mobile: '12345' }) })), /mobile/);
  await rejects(createOrder(db, good({ customer: customer({ mobile: '5123456789' }) })), /mobile/);
  await rejects(createOrder(db, good({ customer: customer({ pin: '62' }) })), /pincode/);
  await rejects(createOrder(db, good({ customer: customer({ city: '' }) })), /city/);
  const noShot = await createOrder(db, good({ screenshot_path: '' }));          // no screenshot is fine now
  assert.equal(noShot.payment_status, 'pending');
  // optional fields may be empty
  const o = await createOrder(db, good({ customer: customer({ email: '', addr: '', state: '' }) }));
  assert.equal(o.customer.email, null);
});

test('merges duplicate lines and stores each product once', async () => {
  const db = await freshDb();
  const o = await createOrder(db, good({ items: [{ pid: 131, qty: 3 }, { pid: 131, qty: 4 }] }));
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].qty, 7);
});

test('stops one mobile number flooding orders', async () => {
  const db = await freshDb();
  for (let i = 0; i < 5; i++) await createOrder(db, good());
  await rejects(createOrder(db, good()), /TOO_MANY/);
});

test('customer lookup needs the right mobile and is rate limited', async () => {
  const db = await freshDb();
  const o = await createOrder(db, good());
  const get = async (no, m) => (await db.query('select get_order($1,$2) o', [no, m])).rows[0].o;
  assert.equal((await get(o.no.toLowerCase(), '86101 63060')).no, o.no);
  assert.equal(await get(o.no, '9999999999'), null);
  for (let i = 0; i < 9; i++) await get(o.no, '9000000000');      // 10 misses now
  await rejects(get(o.no, '8610163060'), /RATE_LIMIT/);            // even the right mobile is blocked
});

test('status moves forward only, with history', async () => {
  const db = await freshDb();
  const o = await createOrder(db, good());
  const set = async (s, note, file) => (await db.query('select set_order_status($1,$2,null,$3,$4) o', [o.no, s, note || null, file || null])).rows[0].o;
  await rejects(set('arrived'), /BAD_TRANSITION/);
  await rejects(set('packed'), /packing photo/);
  assert.equal((await set('packed', null, 'SF/p.jpg')).status, 'packed');
  await rejects(set('packed'), /NO_CHANGE/);
  await rejects(set('transporting'), /LR copy/);
  assert.equal((await set('transporting', null, 'SF/lr.pdf')).status, 'transporting');
  const done = await set('arrived', 'Arrived at Madurai transport');
  assert.equal(done.status, 'arrived');
  assert.deepEqual(done.history.map(h => h.status), ['placed', 'packed', 'transporting', 'arrived']);
  await rejects(set('cancelled'), /BAD_TRANSITION/);
  await rejects(db.query(`select set_order_status('SF99999','packed',null,null)`), /NOT_FOUND/);
});

test('payment can be verified or rejected', async () => {
  const db = await freshDb();
  const o = await createOrder(db, good());
  const r = (await db.query(`select set_payment_status($1,'verified',null,'checked in bank') o`, [o.no])).rows[0].o;
  assert.equal(r.payment_status, 'verified');
  await rejects(db.query(`select set_payment_status($1,'maybe',null,null)`, [o.no]), /INVALID/);
});

test('row level security: anon sees nothing, a listed admin sees orders', async () => {
  const db = await freshDb();
  await createOrder(db, good());
  const asRole = async (role, sub, sql) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.sub', '${sub || ''}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
  };
  await db.exec('grant select on all tables in schema public to anon, authenticated; grant usage on schema public to anon, authenticated');
  assert.equal((await asRole('anon', '', 'select * from orders')).length, 0);
  const u = (await db.query(`insert into auth.users (email) values ('owner@selvi.test') returning id`)).rows[0].id;
  const other = (await db.query(`insert into auth.users (email) values ('stranger@x.test') returning id`)).rows[0].id;
  assert.equal((await asRole('authenticated', u, 'select * from orders')).length, 0);       // logged in but not an admin
  await db.query('insert into admins (user_id) values ($1)', [u]);
  assert.equal((await asRole('authenticated', u, 'select * from orders')).length, 1);
  assert.equal((await asRole('authenticated', other, 'select * from orders')).length, 0);
  // the SQL functions cannot be called by the public roles
  await db.exec('set role anon');
  await assert.rejects(db.query(`select create_order('{}'::jsonb)`), /permission denied/i);
  await db.exec('reset role');
});
