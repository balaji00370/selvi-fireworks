import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, customer, createOrder } from './db.mjs';

const as = (db, role, uid) => db.exec(`set role ${role}; select set_config('request.jwt.sub', '${uid || ''}', false)`);
const UID = '11111111-1111-1111-1111-111111111111';

test('categories and products are built from the price list', async () => {
  const db = await freshDb();
  assert.ok((await db.query('select count(*)::int n from categories')).rows[0].n >= 5);
  assert.equal((await db.query('select count(*)::int n from products where category_id is null')).rows[0].n, 0);
});

test('visitors can read but not change; admins can change', async () => {
  const db = await freshDb();
  await db.exec(`insert into auth.users (id, email) values ('${UID}', 'a@b.c'); insert into admins (user_id) values ('${UID}')`);
  await as(db, 'anon');
  assert.ok((await db.query('select count(*)::int n from products')).rows[0].n > 100);
  assert.equal((await db.query("select count(*)::int n from settings where key = 'ORDER_UPI_ID'")).rows[0].n, 1);
  await assert.rejects(db.query('update products set rate = 1 where pid = 1'));
  await db.exec('reset role');
  await as(db, 'authenticated', UID);
  await db.query("update products set rate = 20, list_price = 20, image_path = 'p-1.webp' where pid = 1");
  const np = await db.query("insert into products (code, name, rate, category_id) values ('X1', 'New item', 50, 1) returning pid");
  assert.ok(np.rows[0].pid >= 1000);
  await db.exec('reset role');
  await as(db, 'authenticated', '22222222-2222-2222-2222-222222222222');   // signed in but not an admin
  await db.query("update settings set value = '9' where key = 'PACKING-PERCENTAGE'");
  await db.exec('reset role');
  assert.equal((await db.query("select value from settings where key = 'PACKING-PERCENTAGE'")).rows[0].value, '3');
});

test('orders follow the settings: packing %, minimum value, on/off', async () => {
  const db = await freshDb();
  const body = (o = {}) => ({ customer: customer(), items: [{ pid: 131, qty: 7 }], screenshot_path: 'p/a.jpg', ...o });
  await db.exec("update settings set value = '5' where key = 'PACKING-PERCENTAGE'");
  const o = await createOrder(db, body());
  assert.equal(Number(o.packing), 253.75);
  await db.exec("update settings set value = '9000' where key = 'MIN-ORDER-VALUE'");
  await assert.rejects(createOrder(db, body()), e => /MIN_ORDER/.test(e.message));
  await db.exec("update settings set value = '100' where key = 'MIN-ORDER-VALUE'; update settings set value = 'FALSE' where key = 'ORDER_ENABLE_FLAG'");
  await assert.rejects(createOrder(db, body()), e => /switched off/.test(e.message));
});
