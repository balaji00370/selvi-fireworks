import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, post, orderBody, FULL_ENV } from './pgdeps.mjs';

const ENV = { ...FULL_ENV, MSG91_TPL_OTP: 'tplOTP', REQUIRE_LOGIN: '1' };
const j = r => r.json();

test('ordering needs a login, and the order uses the verified mobile number', async () => {
  const ctx = await setup(ENV);
  const guest = await ctx.h.submitOrder(post('s', orderBody()));
  assert.equal(guest.status, 401);
  assert.equal(ctx.deps.proofs.size, 0, 'nothing is stored for a rejected order');
  const bad = await ctx.h.submitOrder(post('s', orderBody(), { 'x-customer-token': 'f'.repeat(64) }));
  assert.equal(bad.status, 401);

  await ctx.h.account(post('a', { action: 'request_otp', mode: 'signup', mobile: '9159017999', name: 'Ravi' }));
  const code = ctx.fetchFn.calls.filter(c => c.url.includes('msg91')).pop().body.recipients[0].var1;
  const v = await j(await ctx.h.account(post('a', { action: 'verify_otp', mobile: '9159017999', code, name: 'Ravi' })));
  // the form says another mobile, but the account's number wins
  const ok = await ctx.h.submitOrder(post('s', orderBody(), { 'x-customer-token': v.token }));
  assert.equal(ok.status, 200);
  assert.equal((await j(ok)).order.customer.mobile, '9159017999');
  const mine = await j(await ctx.h.account(post('a', { action: 'orders' }, { 'x-customer-token': v.token })));
  assert.equal(mine.orders.length, 1);
});
