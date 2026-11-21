// Local stand-in for Supabase: runs the REAL Edge Function code against a real Postgres (pglite).
// Used to test the website's online mode in a browser without a Supabase account.
//   node supabase/tests/mock-server.mjs            (listens on http://localhost:8787)
import http from 'node:http';
import { setup, FULL_ENV } from './pgdeps.mjs';

const { h, deps, fetchFn, flush, db } = await setup({ ...FULL_ENV, OTP_DEV_RETURN: '1', REQUIRE_LOGIN: '1' });
const port = Number(process.env.PORT || 8787);

const routes = {
  '/functions/v1/submit-order': h.submitOrder,
  '/functions/v1/get-order': h.getOrder,
  '/functions/v1/admin-update': h.adminUpdate,
  '/functions/v1/account': h.account
};

function readBody(req) {
  return new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    // test-only inspection endpoints
    if (url.pathname === '/__debug/state') {
      const orders = (await db.query('select * from orders order by id')).rows;
      const notes = deps.logs;
      const msgs = fetchFn.calls.map(c => ({ url: c.url, body: c.body }));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ orders, notifications: notes, provider_calls: msgs, proofs: [...deps.proofs.keys()] }));
    }
    if (url.pathname === '/__debug/orders_full') {
      const rows = (await db.query(`select o.*, 
        coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from order_items i where i.order_id = o.id), '[]') as order_items,
        coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from order_events e where e.order_id = o.id), '[]') as order_events,
        '[]'::jsonb as notifications
        from orders o order by o.created_at desc`)).rows;
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify(rows));
    }
    const handler = routes[url.pathname];
    if (!handler) { res.writeHead(404); return res.end('not found'); }
    const body = req.method === 'POST' ? await readBody(req) : undefined;
    const r = await handler(new Request(url, { method: req.method, headers: req.headers, body }));
    await flush();
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: false, message: String(e.message) }));
  }
});
server.listen(port, () => console.log('mock backend ready on http://localhost:' + port));
