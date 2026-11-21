/* Selvi Fireworks — shared order helpers (payment, bill, view orders).
   NOTE: orders are kept in this browser's localStorage. There is no server yet, so orders,
   bill numbers and dispatch status are only visible on the device that placed the order.
   Every storage call goes through this file so it can later be swapped for a real backend. */
(function (w) {
  'use strict';

  var UPI = { id: 'gokulelangovan7999-1@okaxis', name: 'Selvi Fireworks' };
  var CONTACT = { phone: '+91-86101-63060', city: 'Sivakasi' };   // TEST number; restore the official one before launch
  var KEY_PENDING = 'selvi-pending-order', KEY_ORDERS = 'selvi-orders';
  var STAGES = [
    { key: 'placed',       label: 'Order placed',  icon: '📋', note: 'We received your order and payment screenshot.' },
    { key: 'packed',       label: 'Packed',        icon: '📦', note: 'Your crackers are packed at our Sivakasi factory.' },
    { key: 'transporting', label: 'Transporting',  icon: '🚚', note: 'Your parcel is on its way to the transport office.' },
    { key: 'arrived',      label: 'Arrived',       icon: '✅',       note: 'Your parcel has arrived. Our team will call you.' }
  ];

  function read(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function dateStr(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
  }
  function digits(s) { return String(s || '').replace(/\D/g, '').slice(-10); }

  /* bill number: SF + 2-digit year + 3-digit running number, restarting every year (SF26001, SF27001 ...) */
  function nextBillNo(date) {
    var yy = String(date.getFullYear()).slice(-2), key = 'selvi-seq-' + yy;
    var n = (parseInt(localStorage.getItem(key), 10) || 0) + 1;
    try { localStorage.setItem(key, String(n)); } catch (e) {}
    return 'SF' + yy + (n < 10 ? '00' + n : n < 100 ? '0' + n : String(n));
  }

  var Orders = {
    UPI: UPI, CONTACT: CONTACT, STAGES: STAGES, esc: esc, money: money, dateStr: dateStr, digits: digits,

    setPending: function (o) { return write(KEY_PENDING, o); },
    getPending: function () { return read(KEY_PENDING, null); },
    clearPending: function () { try { localStorage.removeItem(KEY_PENDING); } catch (e) {} },

    all: function () { return read(KEY_ORDERS, []); },
    get: function (no) {
      no = String(no || '').trim().toUpperCase();
      return Orders.all().filter(function (o) { return o.no === no; })[0] || null;
    },
    find: function (no, mobile) {
      var o = Orders.get(no);
      return o && digits(o.customer.mobile) === digits(mobile) ? o : null;
    },
    /* returns the saved order, or null if the browser storage is full */
    create: function (pending, payment) {
      var now = new Date(), list = Orders.all();
      var order = {
        no: nextBillNo(now), date: now.toISOString(),
        customer: pending.customer, items: pending.items,
        subtotal: pending.subtotal, packing: pending.packing, total: pending.total,
        payment: payment, status: 'placed',
        history: [{ status: 'placed', at: now.toISOString() }]
      };
      list.unshift(order);
      return write(KEY_ORDERS, list) ? order : null;
    },
    setStatus: function (no, status) {
      var list = Orders.all(), hit = false;
      list.forEach(function (o) {
        if (o.no === no) { o.status = status; o.history.push({ status: status, at: new Date().toISOString() }); hit = true; }
      });
      if (hit) write(KEY_ORDERS, list);
      return hit;
    },
    stageIndex: function (status) {
      for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === status) return i;
      return 0;
    },

    /* the printable bill (same layout as the sample bill: customer, order, product details, totals) */
    billHtml: function (o) {
      var c = o.customer || {};
      var addr = [c.name, c.addr, [c.city, c.district].filter(Boolean).join(', ') + (c.pin ? ' - ' + c.pin : ''), c.state]
        .filter(function (x) { return x && String(x).trim() !== ''; });
      var rows = o.items.map(function (it, i) {
        return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + esc(it.code) + '</td><td>' + esc(it.name) +
          '</td><td class="r">' + money(it.rate) + '</td><td class="r">' + it.qty + '</td><td class="r">' + money(it.amt) + '</td></tr>';
      }).join('');
      var items = o.items.reduce(function (s, it) { return s + it.qty; }, 0);
      return '' +
        '<div class="bill-top"><strong>Selvi Fireworks, Sivakasi</strong><span>NEED HELP? CALL: <a href="tel:' + CONTACT.phone.replace(/[^+\d]/g, '') + '">' + esc(CONTACT.phone) + '</a> [24 x 7]</span></div>' +
        '<div class="bill-head">CUSTOMER DETAILS</div>' +
        '<div class="bill-body">' + addr.map(function (l) { return '<div>' + esc(l) + '</div>'; }).join('') +
        (c.email ? '<div>' + esc(c.email) + '</div>' : '') + '<div>' + esc(c.mobile) + '</div></div>' +
        '<div class="bill-head">ORDER DETAILS</div>' +
        '<div class="bill-body"><table class="kv">' +
        '<tr><td>Bill / Order No</td><td><strong>' + esc(o.no) + '</strong></td></tr>' +
        '<tr><td>Order Date</td><td>' + dateStr(o.date) + '</td></tr>' +
        '<tr><td>No. of Products</td><td>' + o.items.length + '</td></tr>' +
        '<tr><td>No. of Items</td><td>' + items + '</td></tr>' +
        '<tr><td>Payment</td><td>UPI (' + esc(UPI.id) + ')' + (o.payment && o.payment.utr ? ' &middot; Ref ' + esc(o.payment.utr) : '') + '</td></tr>' +
        '<tr><td>Net Amount</td><td>' + money(o.total) + '</td></tr></table></div>' +
        '<div class="bill-head">PRODUCT DETAILS</div>' +
        '<table class="bill-items"><thead><tr><th>Sl No</th><th>Code</th><th>Product</th><th>Rate per Unit</th><th>No. of Units</th><th>Amount</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="bill-totals"><div><span>Total</span><span>' + money(o.subtotal) + '</span></div>' +
        '<div><span>ADD : PACKING @ 3.00 %</span><span>' + money(o.packing) + '</span></div>' +
        '<div class="grand"><span>GRAND TOTAL</span><span>' + money(o.total) + '</span></div></div>' +
        '<p class="bill-eoe">E.&amp;O.E.</p>';
    }
  };

  /* ===== Online mode (Supabase) =====
     When assets/js/config.js has a Supabase URL + anon key, orders are saved on the server and the same
     page code uses the async functions below. Without it, everything keeps working in this browser only. */
  var cfg = w.SELVI_CONFIG || {};
  Orders.remote = !!(cfg.supabaseUrl && cfg.anonKey);
  var KEY_REFS = 'selvi-order-refs';       // online mode: which orders this device placed {no, mobile}

  function call(fn, body, token, extra) {
    return fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/functions/v1/' + fn, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: 'Bearer ' + (token || cfg.anonKey) }, extra || {}),
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, message: 'Unexpected reply from the server.' }; }).then(function (j) {
        if (!r.ok || !j.ok) { var e = new Error(j.message || 'Something went wrong. Please try again.'); e.code = j.error; e.status = r.status; throw e; }
        return j;
      });
    }, function () { throw new Error('Could not reach the server. Please check your internet connection and try again.'); });
  }
  Orders.call = call;

  function addRef(no, mobile) {
    var refs = read(KEY_REFS, []).filter(function (r) { return r.no !== no; });
    refs.unshift({ no: no, mobile: digits(mobile) });
    write(KEY_REFS, refs.slice(0, 30));
  }
  Orders.refMobile = function (no) {
    no = String(no || '').toUpperCase();
    var r = read(KEY_REFS, []).filter(function (x) { return x.no === no; })[0];
    return r ? r.mobile : '';
  };

  /* place the order: resolves with the saved order (bill number etc.) */
  Orders.submit = function (pending, payment) {
    if (!Orders.remote) {
      var o = Orders.create(pending, payment);
      return o ? Promise.resolve(o) : Promise.reject(new Error('Your browser storage is full, so the order could not be saved.'));
    }
    return call('submit-order', {
      items: pending.items.map(function (i) { return { pid: parseInt(i.pid, 10), qty: i.qty }; }),
      customer: pending.customer, utr: payment.utr || '', screenshot: payment.screenshot, client_total: pending.total
    }, null, { 'x-customer-token': (function () { try { return localStorage.getItem('selvi-customer-token') || ''; } catch (e) { return ''; } })() }).then(function (j) { addRef(j.order.no, j.order.customer.mobile); return j.order; });
  };

  /* look an order up by bill number + mobile */
  Orders.fetch = function (no, mobile) {
    if (!Orders.remote) return Promise.resolve(Orders.find(no, mobile));
    return call('get-order', { no: no, mobile: mobile }).then(function (j) { addRef(j.order.no, mobile); return j.order; },
      function (e) { if (e.code === 'NOT_FOUND') return null; throw e; });
  };

  /* the orders this device has placed */
  Orders.myOrders = function () {
    if (!Orders.remote) return Promise.resolve(Orders.all());
    var local = Promise.all(read(KEY_REFS, []).map(function (r) {
      return call('get-order', { no: r.no, mobile: r.mobile }).then(function (j) { return j.order; }, function () { return null; });
    })).then(function (list) { return list.filter(Boolean); });
    var token = ''; try { token = localStorage.getItem('selvi-customer-token') || ''; } catch (e) {}
    if (!token) return local;
    // logged in: every order placed with the account's verified mobile number, on any device
    var acct = call('account', { action: 'orders' }, null, { 'x-customer-token': token }).then(function (j) { return j.orders || []; }, function () { return []; });
    return Promise.all([acct, local]).then(function (r) {
      var seen = {}, all = r[0].concat(r[1]).filter(function (x) { if (seen[x.no]) return false; seen[x.no] = 1; return true; });
      return all.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    });
  };

  w.SelviOrders = Orders;
})(window);
