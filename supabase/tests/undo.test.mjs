import test from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, customer, createOrder } from './db.mjs';

const good = () => ({ customer: customer(), items: [{ pid: 131, qty: 7 }], screenshot_path: '', client_total: 5227.25 });
const one = async (db, sql, args) => (await db.query(sql, args)).rows[0].o;

test('undo walks back one step at a time and clears the files', async () => {
  const db = await freshDb();
  const o = await createOrder(db, good());
  const set = (s, f) => one(db, 'select set_order_status($1,$2,null,null,$3) o', [o.no, s, f || null]);
  const undo = () => one(db, 'select undo_order_step($1,null,null) o', [o.no]);
  await assert.rejects(undo(), e => /nothing to undo/i.test(e.message));
  await db.query("select set_payment_status($1,'verified',null,null)", [o.no]);
  await set('packed', 'SF/p.jpg'); await set('transporting', 'SF/lr.pdf'); await set('arrived');
  let r = await undo(); assert.equal(r.status, 'transporting');                 // arrived undone
  r = await undo(); assert.equal(r.status, 'packed'); assert.equal(r.lr_copy, null);   // transporting undone, LR cleared
  r = await undo(); assert.equal(r.status, 'placed'); assert.equal(r.packed_photo, null);
  r = await undo(); assert.equal(r.payment_status, 'pending');                  // paid undone
  await assert.rejects(undo(), e => /nothing to undo/i.test(e.message));
  r = await set('packed', 'SF/p2.jpg').catch(e => e);                           // still allowed to go forward again
  assert.equal(r.status, 'packed');
  assert.ok(r.history.some(h => h.status === 'undo_transporting'));
});

test('a cancelled order can be brought back to where it was', async () => {
  const db = await freshDb();
  const o = await createOrder(db, good());
  await one(db, 'select set_order_status($1,$2,null,null,$3) o', [o.no, 'packed', 'SF/p.jpg']);
  const c = await one(db, "select set_order_status($1,'cancelled',null,null,null) o", [o.no]);
  assert.equal(c.status, 'cancelled');
  const back = await one(db, 'select undo_order_step($1,null,null) o', [o.no]);
  assert.equal(back.status, 'packed');
});
