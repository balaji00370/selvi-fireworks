import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, post, orderBody, FULL_ENV } from './pgdeps.mjs';

const ENV = { ...FULL_ENV, MSG91_TPL_OTP: 'tplOTP', WA_TPL_OTP: 'login_code' };
const j = r => r.json();
const acct = (h, body, token) => h.account(post('account', body, token ? { 'x-customer-token': token } : {}));
const codeFromSms = fetchFn => fetchFn.calls.filter(c => c.url.includes('msg91')).pop().body.recipients[0].var1;

async function login(ctx, mobile = '8610163060', name = 'Balaji S S') {
  const r = await acct(ctx.h, { action: 'request_otp', mode: 'signup', mobile, name });
  assert.equal(r.status, 200);
  const code = codeFromSms(ctx.fetchFn);
  const v = await acct(ctx.h, { action: 'verify_otp', mobile, code, name, email: 'b@x.com' });
  return { r, v: await j(v), code };
}

test('sign up with OTP: code sent by SMS + WhatsApp, account and session created', async () => {
  const ctx = await setup(ENV);
  const { v, code } = await login(ctx);
  assert.match(code, /^\d{6}$/);
  assert.ok(ctx.fetchFn.calls.some(c => c.url.includes('graph.facebook') && c.body.template.name === 'login_code'));
  assert.equal(v.ok, true);
  assert.equal(v.customer.mobile, '8610163060');
  assert.equal(v.customer.name, 'Balaji S S');
  assert.match(v.token, /^[0-9a-f]{64}$/);
  const me = await j(await acct(ctx.h, { action: 'me' }, v.token));
  assert.equal(me.customer.email, 'b@x.com');
  // the code itself is never written to the log or database
  assert.ok(!JSON.stringify(ctx.deps.logs).includes(code));
  const rows = (await ctx.db.query('select * from otp_codes')).rows;
  assert.equal(rows.length, 0);                                // used code is deleted
});

test('login needs an existing account; wrong code, expiry and brute force are blocked', async () => {
  const ctx = await setup(ENV);
  const none = await acct(ctx.h, { action: 'request_otp', mode: 'login', mobile: '8610163060' });
  assert.equal(none.status, 404);
  assert.match((await j(none)).message, /sign up/i);
  await login(ctx);
  // log in again with the same number
  ctx.fetchFn.calls.length = 0;
  await ctx.db.exec(`update otp_codes set sent_at = now() - interval '1 minute'`);   // skip the 30 s wait
  assert.equal((await acct(ctx.h, { action: 'request_otp', mode: 'login', mobile: '8610163060' })).status, 200);
  const bad = async c => (await acct(ctx.h, { action: 'verify_otp', mobile: '8610163060', code: c }));
  assert.equal((await bad('000000')).status, 400);
  for (let i = 0; i < 4; i++) await bad('111111');
  assert.equal((await bad(codeFromSms(ctx.fetchFn))).status, 429);          // 5 wrong tries: even the right code is locked
  // expired code
  await ctx.db.exec(`update otp_codes set sent_at = now() - interval '1 minute', attempts = 0`);
  await acct(ctx.h, { action: 'request_otp', mode: 'login', mobile: '8610163060' });
  const good = codeFromSms(ctx.fetchFn);
  await ctx.db.exec(`update otp_codes set expires_at = now() - interval '1 second'`);
  assert.match((await j(await bad(good))).message, /expired/i);
});

test('OTP requests are limited: 30 seconds apart, 5 per hour', async () => {
  const ctx = await setup(ENV);
  const ask = () => acct(ctx.h, { action: 'request_otp', mode: 'signup', mobile: '9159017999', name: 'Ravi' });
  assert.equal((await ask()).status, 200);
  assert.equal((await ask()).status, 429);                                   // too soon
  for (let i = 0; i < 4; i++) { await ctx.db.exec(`update otp_codes set sent_at = now() - interval '1 minute'`); assert.equal((await ask()).status, 200); }
  await ctx.db.exec(`update otp_codes set sent_at = now() - interval '1 minute'`);
  const r = await ask();
  assert.equal(r.status, 429);
  assert.match((await j(r)).message, /hour/);
});

test('sign up needs a name; bad mobile numbers are rejected', async () => {
  const ctx = await setup(ENV);
  assert.equal((await acct(ctx.h, { action: 'request_otp', mode: 'signup', mobile: '8610163060', name: '' })).status, 400);
  assert.equal((await acct(ctx.h, { action: 'request_otp', mode: 'signup', mobile: '12345', name: 'Ravi' })).status, 400);
  assert.equal((await acct(ctx.h, { action: 'verify_otp', mobile: '8610163060', code: '12' })).status, 400);
});

test('if no SMS/WhatsApp is set up the code is not sent (and not leaked) unless dev mode is on', async () => {
  const off = await setup({ SITE_URL: 'x' });
  const r = await acct(off.h, { action: 'request_otp', mode: 'signup', mobile: '8610163060', name: 'Ravi' });
  assert.equal(r.status, 502);
  assert.ok(!('dev_code' in (await j(r))));
  const dev = await setup({ SITE_URL: 'x', OTP_DEV_RETURN: '1' });
  const d = await j(await acct(dev.h, { action: 'request_otp', mode: 'signup', mobile: '8610163060', name: 'Ravi' }));
  assert.match(d.dev_code, /^\d{6}$/);
});

test('my orders: every order placed with the verified mobile, on any device', async () => {
  const ctx = await setup(ENV);
  await ctx.h.submitOrder(post('s', orderBody()));
  await ctx.h.submitOrder(post('s', orderBody({ customer: { ...orderBody().customer, mobile: '9159017999' } })));   // someone else's
  const { v } = await login(ctx);
  const o = await j(await acct(ctx.h, { action: 'orders' }, v.token));
  assert.equal(o.orders.length, 1);
  assert.equal(o.orders[0].customer.mobile, '8610163060');
  assert.equal((await acct(ctx.h, { action: 'orders' })).status, 401);
  assert.equal((await acct(ctx.h, { action: 'orders' }, 'f'.repeat(64))).status, 401);
});

test('profile update and logout', async () => {
  const ctx = await setup(ENV);
  const { v } = await login(ctx);
  const u = await j(await acct(ctx.h, { action: 'update_profile', name: 'Balaji Selvam', email: 'new@x.com' }, v.token));
  assert.equal(u.customer.name, 'Balaji Selvam');
  assert.equal((await acct(ctx.h, { action: 'update_profile', name: 'A', email: '' }, v.token)).status, 400);
  assert.equal((await acct(ctx.h, { action: 'update_profile', name: 'Balaji', email: 'not-an-email' }, v.token)).status, 400);
  assert.equal((await acct(ctx.h, { action: 'logout' }, v.token)).status, 200);
  assert.equal((await acct(ctx.h, { action: 'me' }, v.token)).status, 401);
});
