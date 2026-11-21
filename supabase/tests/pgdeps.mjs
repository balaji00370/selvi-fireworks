// Test doubles: a database that is really Postgres (pglite) and a recording fake for fetch().
import { freshDb } from './db.mjs';
import { makeHandlers } from '../functions/_shared/handlers.ts';
import { makeNotifier } from '../functions/_shared/notify.ts';

export const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export function pgDeps(db) {
  const proofs = new Map(), logs = [];
  const q = async (sql, args) => (await db.query(sql, args)).rows[0];
  return {
    proofs, logs, admins: new Map(),
    async uploadProof(p, bytes, mime) { proofs.set(p, { bytes, mime }); },
    async deleteProof(p) { proofs.delete(p); },
    async createOrder(payload) { return (await q('select public.create_order($1::jsonb) o', [JSON.stringify(payload)])).o; },
    async getOrder(no, m) { return (await q('select public.get_order($1,$2) o', [no, m])).o; },
    async setStatus(no, s, by, note) { return (await q('select public.set_order_status($1,$2,null,$3) o', [no, s, note])).o; },
    async setPayment(no, ps, by, note) { return (await q('select public.set_payment_status($1,$2,null,$3) o', [no, ps, note])).o; },
    async verifyAdmin(jwt) { return jwt === 'admin-token' ? { id: '00000000-0000-0000-0000-000000000001' } : null; },
    async storeOtp(m, h, mode) { return (await q('select public.store_otp($1,$2,$3) o', [m, h, mode])).o; },
    async verifyOtp(m, h, name, email, th) { return (await q('select public.verify_otp($1,$2,$3,$4,$5) o', [m, h, name, email, th])).o; },
    async sessionCustomer(th) { return (await q('select public.session_customer($1) o', [th])).o; },
    async customerOrders(th) { return (await q('select public.customer_orders($1) o', [th])).o; },
    async updateCustomer(th, n, e) { return (await q('select public.update_customer($1,$2,$3) o', [th, n, e])).o; },
    async endSession(th) { await db.query('select public.end_session($1)', [th]); },
    async logNotification(n) { logs.push(n); }
  };
}

export function fakeFetch(plan = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, headers: opts && opts.headers, body });
    const forced = Object.keys(plan).find(k => url.includes(k));
    if (forced && plan[forced] === 'fail') return new Response(JSON.stringify({ error: 'boom' }), { status: 400 });
    if (forced && plan[forced] === 'throw') throw new Error('network down');
    const reply = url.includes('resend') ? { id: 'em_1' } : url.includes('graph.facebook') ? { messages: [{ id: 'wamid.1' }] } : { type: 'success', message: 'sms_1' };
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  fn.calls = calls;
  return fn;
}

export const FULL_ENV = {
  RESEND_API_KEY: 're_test', MAIL_FROM: 'Selvi <orders@selvi.test>', ADMIN_EMAIL: 'owner@selvi.test',
  WHATSAPP_TOKEN: 'wa_tok', WHATSAPP_PHONE_ID: '1234567890',
  WA_TPL_PLACED: 'order_received', WA_TPL_PACKED: 'order_packed', WA_TPL_TRANSPORTING: 'order_transporting', WA_TPL_ARRIVED: 'order_arrived',
  MSG91_AUTH_KEY: 'sms_key', MSG91_TPL_PLACED: 'tplP', MSG91_TPL_PACKED: 'tplK', MSG91_TPL_TRANSPORTING: 'tplT', MSG91_TPL_ARRIVED: 'tplA',
  SITE_URL: 'https://www.selvifireworks.com', BUSINESS_PHONE: '+91-91590-17999'
};

export async function setup(env = FULL_ENV, plan = {}) {
  const db = await freshDb();
  const deps = pgDeps(db);
  const fetchFn = fakeFetch(plan);
  const notifier = makeNotifier({ env: k => env[k], fetchFn, db: deps });
  const tasks = [];
  const h = makeHandlers({ db: deps, notifier, allowedOrigin: '*', pepper: 'test-pepper', devOtp: env.OTP_DEV_RETURN === '1', requireLogin: env.REQUIRE_LOGIN === '1', background: t => { tasks.push(t); return t; } });
  const flush = async () => { await Promise.all(tasks.splice(0)); };
  return { db, deps, fetchFn, h, flush };
}

export const post = (url, body, headers = {}) =>
  new Request('http://localhost/' + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

export const orderBody = (over = {}) => ({
  customer: { name: 'Balaji S S', mobile: '8610163060', email: 'balaji@example.com', pin: '625501', addr: '', city: 'Vadipatti', district: 'Madurai', state: 'TamilNadu' },
  items: [{ pid: 131, qty: 7 }], utr: '4123', screenshot: PNG, client_total: 5227.25, ...over
});
