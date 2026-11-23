// The three public entry points, written against small interfaces (deps) so that the same code runs
// on Supabase (index.ts files) and in the local tests.
import { corsHeaders, parseImageDataUrl, parseFileDataUrl, validateSubmitBody, mapDbError, normMobile, sha256Hex, randomDigits, randomToken } from './logic.ts';

export function makeHandlers(deps: any) {
  const { db, notifier } = deps;
  const background = deps.background || ((p: Promise<any>) => p);

  function reply(req: Request, status: number, body: any): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(req.headers.get('origin'), deps.allowedOrigin || '*') }
    });
  }
  const fail = (req: Request, e: any) => {
    const m = mapDbError((e && e.message) || String(e));
    if (m.status >= 500) console.error('function error:', e && e.message ? e.message : e);
    return reply(req, m.status, { ok: false, error: m.code, message: m.message });
  };

  async function json(req: Request): Promise<any> {
    try { return await req.json(); } catch (_e) { return null; }
  }

  function guard(fn: (req: Request) => Promise<Response>) {
    return async (req: Request): Promise<Response> => {
      if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req.headers.get('origin'), deps.allowedOrigin || '*') });
      if (req.method !== 'POST') return reply(req, 405, { ok: false, error: 'METHOD', message: 'Use POST' });
      try { return await fn(req); } catch (e) { return fail(req, e); }
    };
  }

  /** customer: place an order together with the payment screenshot */
  const submitOrder = guard(async (req) => {
    const body = await json(req);
    const bad = validateSubmitBody(body);
    if (bad) return reply(req, 400, { ok: false, error: 'INVALID', message: bad });
    if (deps.requireLogin) {
      const t = (req.headers.get('x-customer-token') || '').trim();
      const cust = t ? await db.sessionCustomer(await sha256Hex(t)) : null;
      if (!cust) return reply(req, 401, { ok: false, error: 'UNAUTHORIZED', message: 'Please log in to place an order.' });
      body.customer = { ...body.customer, mobile: cust.mobile };   // the order belongs to the verified mobile number
    }
    // a payment screenshot is optional now (the bill carries the UPI QR); keep it if one is sent
    let path = '';
    if (body.screenshot) {
      const img = parseImageDataUrl(body.screenshot);
      if (!img) return reply(req, 400, { ok: false, error: 'INVALID', message: 'The screenshot must be a JPG, PNG or WebP image under 1.5 MB.' });
      const d = (deps.now ? deps.now() : new Date());
      path = `proofs/${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${img.ext}`;
      await db.uploadProof(path, img.bytes, img.mime);
    }
    let order: any;
    try {
      order = await db.createOrder({
        customer: body.customer, items: body.items.map((i: any) => ({ pid: i.pid, qty: i.qty })),
        utr: body.utr || '', screenshot_path: path, client_total: body.client_total
      });
    } catch (e) {
      if (path) await db.deleteProof(path).catch(() => {});
      throw e;
    }
    background(Promise.all([notifier.toCustomer(order, 'placed'), notifier.toAdmin(order, 'new_order')]));
    return reply(req, 200, { ok: true, order });
  });

  /** customer: look up an order with bill number + mobile */
  const getOrder = guard(async (req) => {
    const b = await json(req);
    if (!b || !b.no || !b.mobile) return reply(req, 400, { ok: false, error: 'INVALID', message: 'Enter the bill number and mobile number.' });
    const order = await db.getOrder(String(b.no), String(b.mobile));
    if (!order) return reply(req, 404, { ok: false, error: 'NOT_FOUND', message: 'We could not find an order with that bill number and mobile number.' });
    return reply(req, 200, { ok: true, order });
  });

  /** admin: change dispatch status or payment status (and tell the customer) */
  const adminUpdate = guard(async (req) => {
    const auth = req.headers.get('authorization') || '';
    const jwt = /^Bearer\s+(.+)$/i.exec(auth);
    const user = jwt ? await db.verifyAdmin(jwt[1]) : null;
    if (!user) return reply(req, 401, { ok: false, error: 'UNAUTHORIZED', message: 'Please log in as an admin.' });
    const b = await json(req);
    if (!b || !b.no) return reply(req, 400, { ok: false, error: 'INVALID', message: 'Missing order number.' });

    if (b.action === 'set_status') {
      // Packed needs the packing photo, Transporting needs the LR copy
      let filePath: string | null = null;
      if (b.status === 'packed' || b.status === 'transporting') {
        const f = parseFileDataUrl(b.file);
        if (!f || (b.status === 'packed' && f.ext === 'pdf')) {
          return reply(req, 400, { ok: false, error: 'INVALID', message: b.status === 'packed' ? 'Please add the packing photo (JPG, PNG or WebP under 3 MB).' : 'Please upload the LR copy (photo or PDF under 3 MB).' });
        }
        filePath = `${String(b.no).toUpperCase()}/${b.status}-${crypto.randomUUID()}.${f.ext}`;
        await db.uploadDispatch(filePath, f.bytes, f.mime);
      }
      let order: any;
      try { order = await db.setStatus(b.no, b.status, user.id, b.note || null, filePath); }
      catch (e) { if (filePath) await db.deleteDispatch(filePath).catch(() => {}); throw e; }
      background((async () => {
        await notifier.toCustomer(order, b.status);
        if (b.status === 'arrived') await notifier.toAdmin(order, 'arrived');
      })());
      return reply(req, 200, { ok: true, order });
    }
    if (b.action === 'set_payment') {
      const order = await db.setPayment(b.no, b.payment_status, user.id, b.note || null);
      if (b.payment_status === 'rejected') background(notifier.toCustomer(order, 'payment_rejected'));
      return reply(req, 200, { ok: true, order });
    }
    if (b.action === 'undo') {
      const order = await db.undo(b.no, user.id, b.note || null);
      return reply(req, 200, { ok: true, order });
    }
    return reply(req, 400, { ok: false, error: 'INVALID', message: 'Unknown action.' });
  });

  /** customer accounts: mobile + OTP login, profile, "my orders" on any device */
  const account = guard(async (req) => {
    const b = await json(req);
    if (!b || !b.action) return reply(req, 400, { ok: false, error: 'INVALID', message: 'Unknown request.' });
    const pepper = deps.pepper || 'dev-pepper';
    const hashCode = (mobile: string, code: string) => sha256Hex(code + ':' + mobile + ':' + pepper);
    const needToken = async () => {
      const t = (req.headers.get('x-customer-token') || '').trim();
      const th = t ? await sha256Hex(t) : '';
      const c = th ? await db.sessionCustomer(th) : null;
      return c ? { th, customer: c } : null;
    };
    const unauthorized = () => reply(req, 401, { ok: false, error: 'UNAUTHORIZED', message: 'Please log in again.' });

    if (b.action === 'request_otp') {
      const mobile = normMobile(b.mobile);
      const mode = b.mode === 'signup' ? 'signup' : 'login';
      if (String(b.name || '').trim().length < 2) {
        return reply(req, 400, { ok: false, error: 'INVALID', message: 'Please enter your name.' });
      }
      const code = randomDigits(6);
      await db.storeOtp(mobile, await hashCode(mobile, code), mode, String(b.name || ''));
      const sent = await notifier.sendOtp(mobile, code);
      const ok = sent.some((r: any) => r.status === 'sent');
      if (!ok && !deps.devOtp) {
        return reply(req, 502, { ok: false, error: 'SEND_FAILED', message: 'We could not send the code right now. Please try again or call us.' });
      }
      return reply(req, 200, { ok: true, channels: sent.filter((r: any) => r.status === 'sent').length, ...(deps.devOtp && !ok ? { dev_code: code } : {}) });
    }
    if (b.action === 'verify_otp') {
      const mobile = normMobile(b.mobile);
      const code = String(b.code || '').replace(/\D/g, '');
      if (code.length !== 6) return reply(req, 400, { ok: false, error: 'INVALID', message: 'Enter the 6-digit code.' });
      const token = randomToken();
      const customer = await db.verifyOtp(mobile, await hashCode(mobile, code), String(b.name || ''), String(b.email || ''), await sha256Hex(token));
      if (customer && customer.error) throw new Error(customer.error);
      return reply(req, 200, { ok: true, token, customer });
    }
    if (b.action === 'me') {
      const s = await needToken(); if (!s) return unauthorized();
      return reply(req, 200, { ok: true, customer: s.customer });
    }
    if (b.action === 'orders') {
      const s = await needToken(); if (!s) return unauthorized();
      return reply(req, 200, { ok: true, orders: await db.customerOrders(s.th) });
    }
    if (b.action === 'update_profile') {
      const s = await needToken(); if (!s) return unauthorized();
      return reply(req, 200, { ok: true, customer: await db.updateCustomer(s.th, String(b.name || ''), String(b.email || '')) });
    }
    if (b.action === 'logout') {
      const s = await needToken();
      if (s) await db.endSession(s.th);
      return reply(req, 200, { ok: true });
    }
    return reply(req, 400, { ok: false, error: 'INVALID', message: 'Unknown action.' });
  });

  return { submitOrder, getOrder, adminUpdate, account };
}
