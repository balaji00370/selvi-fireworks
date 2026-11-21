/* Admin TEST MODE (no Supabase yet): a pretend backend that keeps everything in this browser,
   so the admin screens can be tried out. Sample login: admin@selvi.test / admin123.
   Products and categories are copied from the Book Now page the first time. Not used once config.js has Supabase. */
(function (w) {
  'use strict';
  var O = w.SelviOrders;
  if (!O || O.remote) return;
  var K_DB = 'selvi-local-admin-db', K_SES = 'selvi-local-admin-session', K_PW = 'selvi-local-admin-pw', K_PAY = 'selvi-local-paystatus';
  var rd = function (k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
  var wr = function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  var DEFAULT_SETTINGS = { 'PACKING-PERCENTAGE': '3', 'GST-PERCENTAGE': '0', 'DISCOUNT-PERCENTAGE': '0', 'MIN-ORDER-VALUE': '5000', ORDER_ENABLE_FLAG: 'TRUE',
    ORDER_UPI_ID: 'gokulelangovan7999-1@okaxis', ORDER_UPI_NAME: 'Selvi Fireworks', BANK1_NAME: 'Gokul E', BANK1_BANK: 'BANK OF BARODA', BANK1_BRANCH: 'SIVAKASI',
    BANK1_ADDR: 'SIVAKASI', BANK1_STATE: 'Tamilnadu', BANK1_NUMBER: '33090100008319', BANK1_IFSC: 'BARB0SIVAKA', ADMIN_NO: '9159017999', ADMIN_TXT: '+91-91590-17999',
    CONTACT_TOP_NO: '9159017999', CONTACT_TOP_TXT: '+91-91590-17999', COMPANY_CITY: 'Selvi Fireworks, Sivakasi', 'ORDER-EMAIL': 'jjselvifireworks@gmail.com' };

  var DB = rd(K_DB, null), ready;
  function seed() {
    if (DB) return Promise.resolve();
    return fetch('booknow.html').then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var brands = [{ id: 1, name: 'Selvi Fireworks', details: 'Selvi Fireworks', rank: 10, active: true }], cats = [], prods = [];
      doc.querySelectorAll('#price-list .price-section').forEach(function (sec, i) {
        var h = sec.querySelector('.price-cat-header > span'), cid = i + 1;
        cats.push({ id: cid, name: h ? h.textContent.trim() : 'Category ' + cid, details: h ? h.textContent.trim() : '', brand_id: 1, rank: (i + 1) * 10, active: true });
        sec.querySelectorAll('tbody tr').forEach(function (tr, j) {
          var inp = tr.querySelector('.qty-input'); if (!inp) return;
          var code = tr.querySelector('.prod-code-sub');
          prods.push({ pid: Number(inp.dataset.pid), code: code ? code.textContent.replace(/^\s*Code:\s*/i, '').trim() : inp.dataset.pid, name: inp.dataset.pname,
            rate: Number(inp.dataset.rate), list_price: Number(inp.dataset.rate), packing: '1 Pkt', rank: (j + 1) * 10, category_id: cid, active: true });
        });
      });
      DB = { brands: brands, categories: cats, products: prods, settings: Object.keys(DEFAULT_SETTINGS).map(function (k) { return { key: k, value: DEFAULT_SETTINGS[k] }; }) };
      wr(K_DB, DB);
    });
  }
  ready = seed();

  var PK = { products: 'pid', settings: 'key' };
  function ordersView() {
    var pay = rd(K_PAY, {});
    return O.all().map(function (o) {
      var c = o.customer || {};
      return { bill_no: o.no, created_at: o.date, cust_name: c.name, cust_mobile: O.digits(c.mobile), cust_email: c.email, cust_pin: c.pin, cust_addr: c.addr, cust_city: c.city,
        cust_district: c.district, cust_state: c.state, subtotal: o.subtotal, packing: o.packing, total: o.total, utr: o.payment && o.payment.utr,
        status: o.status, payment_status: pay[o.no] || 'submitted', screenshot_path: o.payment && o.payment.screenshot ? o.no : null,
        order_items: o.items.map(function (it, i) { return { id: i + 1, code: it.code, name: it.name, rate: it.rate, qty: it.qty, amount: it.amt }; }),
        order_events: (o.history || []).map(function (e, i) { return { id: i + 1, status: e.status, at: e.at, note: '' }; }), notifications: [] };
    });
  }

  function chain(table) {
    var q = { op: 'select', filt: null, payload: null, ords: [] };
    q.select = function () { return q; }; q.limit = function () { return q; };
    q.order = function (k) { q.ords.push(k); return q; };
    q.insert = function (d) { q.op = 'insert'; q.payload = d; return q; };
    q.update = function (d) { q.op = 'update'; q.payload = d; return q; };
    q.delete = function () { q.op = 'delete'; return q; };
    q.eq = function (k, v) { q.filt = [k, v]; return q; };
    q.then = function (ok, bad) {
      return ready.then(function () {
        if (table === 'admins') return { data: rd(K_SES, null) ? [{ user_id: 'local' }] : [], error: null };
        if (table === 'orders') return { data: ordersView(), error: null };
        var rows = DB[table], pk = PK[table] || 'id', res = { error: null };
        if (q.op === 'select') {
          var r = rows.slice();
          r.sort(function (a, b) { for (var i = 0; i < q.ords.length; i++) { var k = q.ords[i], x = a[k], y = b[k]; if (x === y) continue; return (x == null ? -1 : y == null ? 1 : x > y ? 1 : -1); } return 0; });
          res.data = r;
        } else if (q.op === 'insert') {
          var n = Object.assign({}, q.payload);
          if (n[pk] == null) n[pk] = rows.reduce(function (m, x) { return Math.max(m, Number(x[pk]) || 0); }, table === 'products' ? 999 : 0) + 1;
          if (n.active == null && table !== 'settings') n.active = true;
          if (rows.some(function (x) { return (table !== 'settings' && x.name != null && n.name != null && x.name === n.name && table !== 'products') || (table === 'products' && x.code === n.code); })) res.error = { message: 'duplicate key value' };
          else rows.push(n);
        } else if (q.op === 'update') {
          rows.forEach(function (x) { if (x[q.filt[0]] === q.filt[1]) Object.assign(x, q.payload); });
        } else {
          var used = (table === 'products' && O.all().some(function (o) { return o.items.some(function (i) { return String(i.pid) === String(q.filt[1]); }); })) ||
            (table === 'categories' && DB.products.some(function (p) { return p.category_id === q.filt[1]; })) ||
            (table === 'brands' && DB.categories.some(function (c) { return c.brand_id === q.filt[1]; }));
          if (used) res.error = { message: 'violates foreign key constraint' }; else DB[table] = rows.filter(function (x) { return x[q.filt[0]] !== q.filt[1]; });
        }
        if (!res.error && q.op !== 'select') wr(K_DB, DB);
        return res;
      }).then(ok, bad);
    };
    return q;
  }

  var listeners = [];
  var client = {
    auth: {
      signInWithPassword: function (c) {
        var pw = rd(K_PW, 'admin123');
        if (!/@/.test(c.email || '') || c.password !== pw) return Promise.resolve({ error: { message: 'bad login' } });
        var s = { access_token: 'local-admin', user: { email: c.email } }; wr(K_SES, s);
        return Promise.resolve({ data: { session: s }, error: null });
      },
      getSession: function () { return Promise.resolve({ data: { session: rd(K_SES, null) } }); },
      onAuthStateChange: function (f) { listeners.push(f); },
      signOut: function () { try { localStorage.removeItem(K_SES); } catch (e) {} return Promise.resolve({}); },
      updateUser: function (p) { wr(K_PW, p.password); return Promise.resolve({ error: null }); }
    },
    from: chain,
    storage: { from: function () { return { createSignedUrl: function (no) {
      var o = O.get(no); var u = o && o.payment && o.payment.screenshot;
      return Promise.resolve({ data: { signedUrl: u || '' } });
    } }; } }
  };
  w.supabase = { createClient: function () { return client; } };
  w.SELVI_LOCAL_ADMIN = {
    act: function (b) {
      if (b.action === 'set_status') { if (!O.setStatus(b.no, b.status)) return Promise.reject(new Error('Order not found.')); }
      else if (b.action === 'set_payment') { var p = rd(K_PAY, {}); p[b.no] = b.payment_status; wr(K_PAY, p); }
      return Promise.resolve({ ok: true });
    }
  };
})(window);
