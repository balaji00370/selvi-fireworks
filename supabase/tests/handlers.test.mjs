import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, post, orderBody, PNG, FULL_ENV } from './pgdeps.mjs';
import { messageFor, parseImageDataUrl, mapDbError, normMobile, corsHeaders } from '../functions/_shared/logic.ts';

const j = async r => r.json();

test('submit-order: stores screenshot, creates the order, messages customer and owner', async () => {
  const { h, deps, fetchFn, flush } = await setup();
  const r = await h.submitOrder(post('submit-order', orderBody()));
  const b = await j(r);
  await flush();
  assert.equal(r.status, 200);
  assert.equal(b.ok, true);
  assert.match(b.order.no, /^SF\d{2}001$/);
  assert.equal(b.order.total, 5227.25);
  assert.equal(deps.proofs.size, 1);
  const urls = fetchFn.calls.map(c => c.url);
  assert.ok(urls.some(u => u.includes('graph.facebook.com/v20.0/1234567890/messages')), 'WhatsApp sent');
  assert.ok(urls.some(u => u.includes('control.msg91.com')), 'SMS sent');
  assert.equal(urls.filter(u => u.includes('resend')).length, 2, 'email to customer + owner');
  const wa = fetchFn.calls.find(c => c.url.includes('graph.facebook'));
  assert.equal(wa.body.to, '918610163060');
  assert.equal(wa.body.template.name, 'order_received');
  assert.deepEqual(wa.body.template.components[0].parameters.map(p => p.text), ['Balaji', b.order.no, '₹5,227.25', `https://www.selvifireworks.com/vieworders.html?order=${b.order.no}`]);
  const sms = fetchFn.calls.find(c => c.url.includes('msg91'));
  assert.equal(sms.body.template_id, 'tplP');
  assert.equal(sms.body.recipients[0].var2, b.order.no);
  assert.equal(sms.body.recipients[0].var4, undefined, 'no long link in SMS variables');
  assert.equal(sms.headers.authkey, 'sms_key');
  assert.ok(deps.logs.every(l => l.status === 'sent'));
  assert.equal(deps.logs.length, 4);
});

test('submit-order: no email address means no customer email', async () => {
  const { h, fetchFn, flush } = await setup();
  await h.submitOrder(post('submit-order', orderBody({ customer: { ...orderBody().customer, email: '' } })));
  await flush();
  assert.equal(fetchFn.calls.filter(c => c.url.includes('resend')).length, 1);   // owner only
});

test('submit-order: unconfigured providers are skipped, not fatal', async () => {
  const { h, deps, flush } = await setup({ SITE_URL: 'https://x.test' });
  const r = await h.submitOrder(post('submit-order', orderBody()));
  await flush();
  assert.equal(r.status, 200);
  assert.ok(deps.logs.length >= 3);
  assert.ok(deps.logs.every(l => l.status === 'skipped'));
});

test('submit-order: a failing or crashing provider never breaks the order', async () => {
  const { h, deps, flush } = await setup(FULL_ENV, { 'graph.facebook': 'fail', 'msg91': 'throw' });
  const r = await h.submitOrder(post('submit-order', orderBody()));
  await flush();
  assert.equal(r.status, 200);
  const by = ch => deps.logs.filter(l => l.channel === ch).map(l => l.status);
  assert.deepEqual(by('whatsapp'), ['failed']);
  assert.deepEqual(by('sms'), ['failed']);
  assert.deepEqual(by('email'), ['sent', 'sent']);
  assert.match(deps.logs.find(l => l.channel === 'sms').error, /network down/);
});

test('submit-order: validation and error mapping', async () => {
  const { h, deps } = await setup();
  const call = async b => { const r = await h.submitOrder(post('submit-order', b)); return [r.status, (await j(r)).error]; };
  assert.deepEqual(await call(orderBody({ screenshot: '' })), [400, 'INVALID']);
  assert.deepEqual(await call(orderBody({ screenshot: 'data:text/html;base64,PGI+' })), [400, 'INVALID']);
  assert.deepEqual(await call(orderBody({ items: [] })), [400, 'INVALID']);
  assert.deepEqual(await call(orderBody({ items: [{ pid: 1, qty: 'x' }] })), [400, 'INVALID']);
  assert.deepEqual(await call(orderBody({ client_total: 10 })), [409, 'PRICE_MISMATCH']);
  assert.deepEqual(await call(orderBody({ items: [{ pid: 131, qty: 2 }], client_total: 1493.5 })), [422, 'MIN_ORDER']);
  assert.deepEqual(await call(orderBody({ customer: { ...orderBody().customer, mobile: '123' } })), [400, 'INVALID']);
  assert.equal(deps.proofs.size, 0, 'screenshots of rejected orders are deleted');
  const bad = await h.submitOrder(new Request('http://x/', { method: 'POST', body: 'not json' }));
  assert.equal(bad.status, 400);
  assert.equal((await h.submitOrder(new Request('http://x/', { method: 'GET' }))).status, 405);
});

test('CORS preflight', async () => {
  const { h } = await setup();
  const r = await h.submitOrder(new Request('http://x/', { method: 'OPTIONS', headers: { origin: 'https://www.selvifireworks.com' } }));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(corsHeaders('https://a.com', 'https://a.com,https://b.com')['Access-Control-Allow-Origin'], 'https://a.com');
  assert.equal(corsHeaders('https://evil.com', 'https://a.com')['Access-Control-Allow-Origin'], 'https://a.com');
});

test('get-order: needs the right mobile', async () => {
  const { h } = await setup();
  const { order } = await j(await h.submitOrder(post('submit-order', orderBody())));
  const ok = await h.getOrder(post('get-order', { no: order.no.toLowerCase(), mobile: '+91 86101 63060' }));
  assert.equal(ok.status, 200);
  const okBody = await j(ok);
  assert.equal(okBody.order.customer.name, 'Balaji S S');
  const no = await h.getOrder(post('get-order', { no: order.no, mobile: '9999999999' }));
  assert.equal(no.status, 404);
  assert.equal((await h.getOrder(post('get-order', {}))).status, 400);
  const text = JSON.stringify(okBody);
  assert.ok(!text.includes('proofs/'), 'the screenshot path is never sent to customers');
});

test('get-order: blocks guessing after 10 wrong tries', async () => {
  const { h } = await setup();
  const { order } = await j(await h.submitOrder(post('submit-order', orderBody())));
  let last;
  for (let i = 0; i < 11; i++) last = await h.getOrder(post('get-order', { no: order.no, mobile: '90000000' + (10 + i) }));
  assert.equal(last.status, 429);
});

test('admin-update: needs an admin login', async () => {
  const { h } = await setup();
  const { order } = await j(await h.submitOrder(post('submit-order', orderBody())));
  const body = { action: 'set_status', no: order.no, status: 'packed' };
  assert.equal((await h.adminUpdate(post('admin-update', body))).status, 401);
  assert.equal((await h.adminUpdate(post('admin-update', body, { authorization: 'Bearer wrong' }))).status, 401);
});

test('admin-update: full dispatch journey sends a message at every step', async () => {
  const { h, fetchFn, deps, flush } = await setup();
  const { order } = await j(await h.submitOrder(post('submit-order', orderBody())));
  await flush();
  const auth = { authorization: 'Bearer admin-token' };
  const step = async status => { const r = await h.adminUpdate(post('admin-update', { action: 'set_status', no: order.no, status, note: 'n' }, auth)); return [r.status, (await j(r)).order?.status]; };
  fetchFn.calls.length = 0;
  assert.deepEqual(await step('arrived'), [409, undefined]);          // cannot skip steps
  assert.deepEqual(await step('packed'), [200, 'packed']);
  await flush();
  assert.ok(fetchFn.calls.some(c => c.body?.template?.name === 'order_packed'));
  assert.deepEqual(await step('transporting'), [200, 'transporting']);
  await flush();
  assert.ok(fetchFn.calls.some(c => c.body?.template?.name === 'order_transporting'));
  fetchFn.calls.length = 0;
  assert.deepEqual(await step('arrived'), [200, 'arrived']);
  await flush();
  assert.ok(fetchFn.calls.some(c => c.body?.template?.name === 'order_arrived'));
  const toOwner = fetchFn.calls.find(c => c.url.includes('resend') && c.body.to[0] === 'owner@selvi.test');
  assert.match(toOwner.body.subject, /CALL CUSTOMER/);
  assert.match(toOwner.body.html, /8610163060/);
  assert.deepEqual((await j(await h.getOrder(post('g', { no: order.no, mobile: '8610163060' })))).order.history.map(x => x.status),
    ['placed', 'packed', 'transporting', 'arrived']);
  assert.ok(deps.logs.some(l => l.template === 'arrived' && l.audience === 'admin'));
});

test('admin-update: payment rejected tells the customer', async () => {
  const { h, fetchFn, flush } = await setup({ ...FULL_ENV, WA_TPL_PAYMENT_REJECTED: 'payment_failed' });
  const { order } = await j(await h.submitOrder(post('submit-order', orderBody())));
  await flush();
  fetchFn.calls.length = 0;
  const r = await h.adminUpdate(post('x', { action: 'set_payment', no: order.no, payment_status: 'rejected' }, { authorization: 'Bearer admin-token' }));
  assert.equal(r.status, 200);
  assert.equal((await j(r)).order.payment_status, 'rejected');
  await flush();
  assert.ok(fetchFn.calls.some(c => c.body?.template?.name === 'payment_failed'));
  const v = await h.adminUpdate(post('x', { action: 'set_payment', no: order.no, payment_status: 'verified' }, { authorization: 'Bearer admin-token' }));
  assert.equal((await j(v)).order.payment_status, 'verified');
  assert.equal((await h.adminUpdate(post('x', { action: 'nope', no: order.no }, { authorization: 'Bearer admin-token' }))).status, 400);
});

test('logic helpers', () => {
  assert.equal(normMobile('+91 86101-63060'), '8610163060');
  assert.equal(parseImageDataUrl(PNG).mime, 'image/png');
  assert.equal(parseImageDataUrl('data:image/svg+xml;base64,AAAA'), null);
  assert.equal(parseImageDataUrl('data:image/png;base64,' + 'A'.repeat(2100000)), null);
  assert.equal(mapDbError('MIN_ORDER: total 10 is below 5000').status, 422);
  assert.equal(mapDbError('permission denied for table orders').status, 500);
  const m = messageFor('placed', { no: 'SF26001', total: 5227.25, customer: { name: 'Balaji S S' }, items: [{ name: 'A <b>', qty: 1, amt: 5 }] }, { siteUrl: 'https://x.test/', businessPhone: '1' });
  assert.match(m.html, /A &lt;b&gt;/);                       // customer text is escaped in the email
  assert.match(m.text, /https:\/\/x.test\/vieworders.html\?order=SF26001/);
});
