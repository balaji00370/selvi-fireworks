/* Admin page: log in, see orders, check payment screenshots, move orders Packed -> Transporting -> Arrived.
   Reads orders through Supabase (Row Level Security lets only people listed in the `admins` table see them);
   changes go through the admin-update Edge Function, which also sends the customer's messages. */
(function () {
  'use strict';
  var O = window.SelviOrders;
  var cfg = window.SELVI_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var esc = O.esc, money = O.money;

  if ((!O.remote && !window.SELVI_LOCAL_ADMIN) || !window.supabase) {
    $('adm-setup').hidden = false; $('adm-login').hidden = true; return;
  }
  var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.anonKey);
  var orders = [], filter = 'all', query = '', openNo = null, token = '';
  var NEXT = { placed: 'packed', packed: 'transporting', transporting: 'arrived' };
  var LABEL = { placed: 'Order placed', packed: 'Packed', transporting: 'Transporting', arrived: 'Arrive Soon', cancelled: 'Cancelled' };
  var PAY = { pending: 'Payment pending', submitted: 'Payment pending', verified: 'Paid ✓', rejected: 'Not received' };
  var unpaid = function (o) { return o.payment_status !== 'verified' && o.status !== 'cancelled'; };

  /* on phones every table row becomes a card: copy each column title onto its cells */
  window.SelviLabelize = function (root) {
    root.querySelectorAll('table.stack').forEach(function (t) {
      var heads = [].map.call(t.querySelectorAll('thead th'), function (h) { return h.textContent.trim(); });
      t.querySelectorAll('tbody tr').forEach(function (tr) {
        [].forEach.call(tr.children, function (td, i) { if (heads[i]) td.setAttribute('data-label', heads[i]); });
      });
    });
  };
  function say(el, msg, bad) { el.textContent = msg || ''; el.hidden = !msg; el.className = 'adm-msg' + (bad ? ' bad' : ''); }

  /* ---------- login ---------- */
  $('adm-login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var m = $('adm-login-msg'); say(m, 'Signing in…');
    sb.auth.signInWithPassword({ email: $('adm-email').value.trim(), password: $('adm-pass').value }).then(function (r) {
      if (r.error) { say(m, 'Wrong email or password.', true); return; }
      start(r.data.session);
    });
  });
  $('adm-logout').addEventListener('click', function () { sb.auth.signOut().then(function () { location.reload(); }); });

  function start(session) {
    token = session.access_token;
    sb.from('admins').select('user_id').then(function (r) {
      if (r.error || !r.data || !r.data.length) {
        sb.auth.signOut();
        say($('adm-login-msg'), 'This login is not an admin account. Ask the site owner to add you.', true);
        $('adm-login').hidden = false; $('adm-app').hidden = true; return;
      }
      $('adm-login').hidden = true; $('adm-app').hidden = false;
      $('adm-user').textContent = session.user.email;
      load();
      setInterval(load, 60000);
      window.SELVI_ADMIN_SB = sb;
      window.dispatchEvent(new CustomEvent('selvi-admin-ready', { detail: { sb: sb } }));
    });
  }

  sb.auth.getSession().then(function (r) { if (r.data && r.data.session) start(r.data.session); });
  sb.auth.onAuthStateChange(function (_e, s) { if (s) token = s.access_token; });

  /* ---------- list ---------- */
  function load() {
    return sb.from('orders').select('*, order_items(*), order_events(*), notifications(*)')
      .order('created_at', { ascending: false }).limit(300).then(function (r) {
        if (r.error) { say($('adm-msg'), 'Could not load orders: ' + r.error.message, true); return; }
        orders = r.data || []; render();
      });
  }

  function visible() {
    var q = query.toLowerCase();
    return orders.filter(function (o) {
      if (filter === 'pay' && !unpaid(o)) return false;
      if (filter !== 'all' && filter !== 'pay' && o.status !== filter) return false;
      if (!q) return true;
      return (o.bill_no + ' ' + o.cust_name + ' ' + o.cust_mobile + ' ' + o.cust_city).toLowerCase().indexOf(q) !== -1;
    });
  }

  function render() {
    var counts = { all: orders.length, pay: 0, placed: 0, packed: 0, transporting: 0, arrived: 0 };
    orders.forEach(function (o) { if (unpaid(o)) counts.pay++; if (counts[o.status] != null) counts[o.status]++; });
    $('adm-filters').innerHTML = [['all', 'All'], ['pay', 'Payment pending'], ['placed', 'New'], ['packed', 'Packed'], ['transporting', 'Transporting'], ['arrived', 'Arrive Soon']]
      .map(function (f) { return '<button type="button" class="' + (filter === f[0] ? 'on' : '') + '" data-f="' + f[0] + '">' + f[1] + ' <b>' + (counts[f[0]] || 0) + '</b></button>'; }).join('');
    var rows = visible().map(function (o) {
      return '<tr data-no="' + esc(o.bill_no) + '" class="' + (o.bill_no === openNo ? 'sel' : '') + '"><td><b>' + esc(o.bill_no) + '</b></td><td>' + O.dateStr(o.created_at) + '</td><td>' +
        esc(o.cust_name) + '<small>' + esc(o.cust_mobile) + '</small></td><td>' + esc(o.cust_city) + '</td><td class="r">' + money(o.total) + '</td>' +
        '<td class="adm-pay">' + (o.payment_status === 'verified' ? '<span class="chip pay-verified">Paid</span>' : '<span class="adm-paytext">' + (o.payment_status === 'rejected' ? 'Not received' : 'Pending') + '</span>') + '</td><td><button type="button" class="btn btn-outline btn-sm adm-view">View order details</button></td><td><span class="chip st-' + o.status + '">' + LABEL[o.status] + '</span></td></tr>';
    }).join('');
    $('adm-rows').innerHTML = rows || '<tr><td colspan="8" class="adm-none">No orders here.</td></tr>';
    window.SelviLabelize($('adm-filters').parentNode);
    if (openNo) detail(openNo);
  }

  $('adm-filters').addEventListener('click', function (e) { var b = e.target.closest('button[data-f]'); if (b) { filter = b.getAttribute('data-f'); render(); } });
  $('adm-search').addEventListener('input', function () { query = this.value; render(); });
  $('adm-refresh').addEventListener('click', load);
  $('adm-rows').addEventListener('click', function (e) { if (e.target.closest('.adm-pay')) return; var tr = e.target.closest('tr[data-no]'); if (tr) { openNo = tr.getAttribute('data-no'); render(); $('adm-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });

  function evLabel(st) {
    if (LABEL[st]) return LABEL[st];
    if (st === 'payment_verified') return 'Payment received';
    if (st === 'payment_rejected') return 'Payment not received';
    if (st.indexOf('undo_') === 0) return 'Undone: ' + (st === 'undo_payment' ? 'Paid' : (LABEL[st.slice(5)] || st.slice(5)));
    return st.replace('_', ' ');
  }

  /* ---------- one order ---------- */
  function detail(no) {
    var o = orders.filter(function (x) { return x.bill_no === no; })[0];
    var box = $('adm-detail');
    if (!o) { box.hidden = true; return; }
    box.hidden = false;
    var items = (o.order_items || []).slice().sort(function (a, b) { return a.id - b.id; }).map(function (i) {
      return '<tr><td>' + esc(i.name) + '<small>Code ' + esc(i.code) + '</small></td><td class="r">' + i.qty + '</td><td class="r">' + money(i.rate) + '</td><td class="r">' + money(i.amount) + '</td></tr>';
    }).join('');
    var events = (o.order_events || []).slice().sort(function (a, b) { return a.id - b.id; }).map(function (e) {
      return '<li><b>' + esc(evLabel(e.status)) + '</b> · ' + new Date(e.at).toLocaleString('en-IN') + (e.note ? ' · ' + esc(e.note) : '') + '</li>';
    }).join('');
    var notes = (o.notifications || []).slice().sort(function (a, b) { return a.id - b.id; }).map(function (n) {
      return '<li class="n-' + n.status + '"><b>' + esc(n.audience) + '</b> ' + esc(n.channel) + ' · ' + esc(n.template) + ' · ' + esc(n.status) + (n.error ? ' <small>' + esc(n.error) + '</small>' : '') + '</li>';
    }).join('') || '<li>No messages yet.</li>';
    var next = NEXT[o.status];
    var addr = [o.cust_addr, o.cust_city, o.cust_district, o.cust_state].filter(Boolean).join(', ') + (o.cust_pin ? ' - ' + o.cust_pin : '');
    var paid = o.payment_status === 'verified';
    var photo = O.fileUrl(o.packed_photo), lr = O.fileUrl(o.lr_copy);
    var isPdf = function (u) { return /^data:application\/pdf/.test(u) || /\.pdf($|\?)/i.test(u); };
    // Order placed -> Paid -> Packed -> Transporting -> Arrive soon
    var evAt = function (k) { var t = ''; (o.order_events || []).forEach(function (e) { if (e.status === k) t = O.dateStr(e.at); }); return t; };
    var rank = { placed: 0, packed: 2, transporting: 3, arrived: 4 }[o.status];
    var steps = [['Order placed', true, evAt('placed') || O.dateStr(o.created_at)], ['Paid', paid, evAt('payment_verified')],
      ['Packed', rank >= 2, evAt('packed')], ['Transporting', rank >= 3, evAt('transporting')], ['Arrive soon', rank >= 4, evAt('arrived')]];
    var firstOpen = -1; steps.forEach(function (st, i) { if (!st[1] && firstOpen < 0) firstOpen = i; });
    var stepper = o.status === 'cancelled' ? '<p class="adm-cancelled">This order was cancelled.</p>' :
      '<ol class="adm-steps">' + steps.map(function (st, i) {
        return '<li class="' + (st[1] ? 'done' : i === firstOpen ? 'now' : '') + '"><span>' + (st[1] ? '&#10003;' : i + 1) + '</span><b>' + st[0] + '</b><small>' + (st[1] ? (st[2] || '') : '') + '</small></li>';
      }).join('') + '</ol>';
    // what the admin must add for the next step
    var need = '';
    if (o.status === 'placed' && !paid) {
      need = '<p class="adm-hint bad">Step 1: mark the payment as received. After that you can add the packing photo and pack the order.</p>';
    } else if (next === 'packed') {
      need = '<div class="adm-need"><label class="adm-file" for="adm-file"><span>&#128247; Take packing photo</span>' +
        '<input id="adm-file" type="file" accept="image/*" capture="environment"></label>' +
        '<div class="adm-preview" id="adm-preview" hidden></div>' +
        '</div>';
    } else if (next === 'transporting') {
      need = '<div class="adm-need"><label class="adm-file" for="adm-file"><span>&#128206; Upload LR copy</span>' +
        '<input id="adm-file" type="file" accept="image/*,application/pdf"></label>' +
        '<div class="adm-preview" id="adm-preview" hidden></div></div>';
    }
    var files = (photo || lr) ? '<h3>Dispatch files</h3><div class="adm-files">' +
      (photo ? '<div><small>Packing photo</small><a href="' + photo + '" target="_blank" rel="noopener"><img alt="Packing photo" src="' + photo + '"></a></div>' : '') +
      (lr ? '<div><small>LR copy</small>' + (isPdf(lr) ? '<a class="btn btn-outline btn-sm" href="' + lr + '" target="_blank" rel="noopener">Open LR copy (PDF)</a>' : '<a href="' + lr + '" target="_blank" rel="noopener"><img alt="LR copy" src="' + lr + '"></a>') + '</div>' : '') + '</div>' : '';
    var mainBtn;
    if (o.status === 'placed' && !paid) {
      mainBtn = '<button type="button" class="main" data-pay="verified">✓ Mark as Paid</button>' +
        '<button type="button" class="bad" data-pay="rejected"' + (o.payment_status === 'rejected' ? ' disabled' : '') + '>✗ Payment not received</button>';
    } else if (next) {
      mainBtn = '<button type="button" class="main" id="adm-next" data-st="' + next + '"' + ((next === 'packed' || next === 'transporting') ? ' disabled' : '') + '>Mark as ' + LABEL[next] + '</button>';
    } else {
      mainBtn = '<span class="adm-none">' + (o.status === 'arrived' ? 'Delivered. Remember to call the customer.' : 'Order cancelled.') + '</span>';
    }
    var cancelBtn = (o.status !== 'arrived' && o.status !== 'cancelled') ? '<button type="button" class="bad" data-st="cancelled">Cancel order</button>' : '';
    var undoLabel = { arrived: 'Arrive Soon, back to Transporting', transporting: 'Transporting, back to Packed', packed: 'Packed, back to Order placed', cancelled: 'Cancel, bring the order back' }[o.status] ||
      ((o.status === 'placed' && (paid || o.payment_status === 'rejected')) ? 'Paid, back to unpaid' : '');
    var undoHtml = undoLabel ? '<p><button type="button" class="adm-undo" id="adm-undo" data-label="' + esc(undoLabel) + '">&#8617; Undo: ' + esc(undoLabel) + '</button></p>' : '';
    box.innerHTML =
      '<div class="adm-d-head"><div><h2>' + esc(o.bill_no) + '</h2><span class="chip st-' + o.status + '">' + LABEL[o.status] + '</span> <span class="chip pay-' + o.payment_status + '">' + PAY[o.payment_status] + '</span></div>' +
      '<button type="button" class="adm-x" id="adm-close" aria-label="Close">&times;</button></div>' + stepper +
      '<div class="adm-cols"><div>' +
      '<h3>Customer</h3><p><b>' + esc(o.cust_name) + '</b><br><a href="tel:+91' + esc(o.cust_mobile) + '">+91 ' + esc(o.cust_mobile) + '</a>' + (o.cust_email ? '<br>' + esc(o.cust_email) : '') + '<br>' + esc(addr) + '</p>' +
      '<h3>Payment</h3><p>Total to receive: <b>' + money(o.total) + '</b>' + (o.utr ? '<br>UPI reference: ' + esc(o.utr) : '') + '<br>' +
      (paid ? 'Payment received &#10003;' : 'The customer pays using the QR / UPI ID on the bill. Mark it as received once it reaches the bank account.') + '</p>' +
      '<div id="adm-proof" class="adm-proof">Loading screenshot…</div>' +
      '<h3>History</h3><ul class="adm-list">' + events + '</ul><h3>Messages sent</h3><ul class="adm-list">' + notes + '</ul>' +
      '</div><div>' +
      '<h3>Dispatch</h3>' + need + '<div class="adm-actions">' + mainBtn + cancelBtn + '</div>' + undoHtml +
      '<p class="adm-hint">Each step also sends the customer a WhatsApp, SMS and email.</p>' + files +
      '<h3>Items</h3><table class="adm-items"><tbody>' + items + '</tbody></table>' +
      '<p class="adm-tot">Sub total ' + money(o.subtotal) + ' · Packing ' + money(o.packing) + ' · <b>Total ' + money(o.total) + '</b></p>' +
      '<p><button type="button" class="btn btn-outline btn-sm" id="adm-viewbill">View bill</button></p>' +
      '</div></div><p id="adm-d-msg" class="adm-msg" hidden></p>';
    // the chosen photo / LR copy (kept while the list refreshes)
    var key = o.bill_no + ':' + next, fin = $('adm-file'), pv = $('adm-preview'), go = $('adm-next');
    var enable = function () {
      var f = picked[key]; if (!pv || !go) return;
      pv.hidden = !f; pv.innerHTML = f ? (/^data:application\/pdf/.test(f) ? '<span>&#128206; LR copy PDF added &#10003;</span>' : '<img alt="Selected file" src="' + f + '">') : '';
      go.disabled = !f || (next === 'packed' && !paid);
    };
    if (fin) {
      fin.addEventListener('change', function () {
        var f = fin.files && fin.files[0]; if (!f) return;
        readUpload(f, next === 'transporting').then(function (d) { picked[key] = d; say($('adm-d-msg'), ''); enable(); }, function (e) { say($('adm-d-msg'), e.message, true); });
      });
      enable();
    }
    $('adm-close').addEventListener('click', function () { openNo = null; box.hidden = true; render(); });
    $('adm-viewbill').addEventListener('click', function () { showBill(o); });
    box.querySelectorAll('[data-st]').forEach(function (b) {
      b.addEventListener('click', function () {
        var st = b.getAttribute('data-st');
        var go = function () {
          var body = { action: 'set_status', no: o.bill_no, status: st };
          if (st === 'packed' || st === 'transporting') body.file = picked[o.bill_no + ':' + st];
          act(body).then(function (ok) { if (ok) delete picked[o.bill_no + ':' + st]; });
        };
        if (st !== 'cancelled') return go();
        window.SelviDialog.ask({ icon: '&#9888;', title: 'Cancel this order?', text: 'Order ' + o.bill_no + ' will be cancelled and the customer will be told.', ok: 'Yes, cancel order', cancel: 'Keep order' })
          .then(function (yes) { if (yes) go(); });
      });
    });
    var un = $('adm-undo');
    if (un) un.addEventListener('click', function () {
      window.SelviDialog.ask({ icon: '&#8617;', title: 'Undo this step?', text: un.getAttribute('data-label') + '. Order ' + o.bill_no + ' goes back one step.', ok: 'Yes, undo', cancel: 'No, keep it' })
        .then(function (yes) { if (yes) act({ action: 'undo', no: o.bill_no }); });
    });
    box.querySelectorAll('[data-pay]').forEach(function (b) {
      b.addEventListener('click', function () {
        var ps = b.getAttribute('data-pay');
        var go = function () { act({ action: 'set_payment', no: o.bill_no, payment_status: ps }); };
        if (ps !== 'rejected') return go();
        window.SelviDialog.ask({ icon: '&#9888;', title: 'Payment not received?', text: 'The customer will be told that we have not received the payment for ' + o.bill_no + '.', ok: 'Yes, tell the customer', cancel: 'Cancel' })
          .then(function (yes) { if (yes) go(); });
      });
    });
    if (o.screenshot_path) {
      sb.storage.from('payment-proofs').createSignedUrl(o.screenshot_path, 600).then(function (r) {
        var p = $('adm-proof'); if (!p) return;
        p.innerHTML = r.data && r.data.signedUrl
          ? '<a href="' + r.data.signedUrl + '" target="_blank" rel="noopener"><img alt="Payment screenshot" src="' + r.data.signedUrl + '"></a><small>Tap to enlarge</small>'
          : 'Screenshot could not be loaded.';
      });
    } else { var pp = $('adm-proof'); if (pp) pp.remove(); }
  }


  /* ---------- bill on the same page (overlay) ---------- */
  function toBill(o) {
    return {
      no: o.bill_no, date: o.created_at, status: o.status,
      customer: { name: o.cust_name, mobile: o.cust_mobile, email: o.cust_email, pin: o.cust_pin, addr: o.cust_addr, city: o.cust_city, district: o.cust_district, state: o.cust_state },
      items: (o.order_items || []).slice().sort(function (a, b) { return a.id - b.id; }).map(function (i) { return { code: i.code, name: i.name, rate: i.rate, qty: i.qty, amt: i.amount }; }),
      subtotal: o.subtotal, packing: o.packing, total: o.total, payment: { method: 'UPI', utr: o.utr || '' }, payment_status: o.payment_status
    };
  }
  function showBill(o) {
    var old = $('adm-bill'); if (old) old.remove();
    var m = document.createElement('div'); m.id = 'adm-bill'; m.className = 'bill-modal';
    m.innerHTML = '<div class="bill-modal-in"><div class="bill-modal-bar no-print"><h2>Bill ' + esc(o.bill_no) + '</h2><div>' +
      '<button type="button" class="btn btn-outline btn-sm" id="bm-back">&larr; Back to orders</button> ' +
      '<button type="button" class="btn btn-outline btn-sm" id="bm-print">Print bill</button> ' +
      '<button type="button" class="btn btn-primary btn-sm" id="bm-pdf">Download PDF</button></div></div>' +
      '<div class="bill-sheet" id="bm-sheet"></div></div>';
    document.body.appendChild(m);
    document.body.classList.add('bill-open');
    $('bm-sheet').innerHTML = O.billHtml(toBill(o));
    O.renderBillQr($('bm-sheet'));
    var close = function () { m.remove(); document.body.classList.remove('bill-open'); document.removeEventListener('keydown', onKey); };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    $('bm-back').addEventListener('click', close);
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    $('bm-print').addEventListener('click', function () {   // the bill alone, in a new tab, with the print window
      window.open('bill.html?no=' + encodeURIComponent(o.bill_no) + '&m=' + encodeURIComponent(o.cust_mobile) + '&admin=1&print=1', '_blank', 'noopener');
    });
    $('bm-pdf').addEventListener('click', function () { window.SelviBillPdf.download($('bm-sheet'), o.bill_no, $('bm-pdf'), function () { window.print(); }); });
    m.scrollTop = 0;
  }

  /* a chosen photo is shrunk to about 1200 px; a PDF is kept as it is (up to 2 MB) */
  var picked = {};
  function readUpload(file, allowPdf) {
    return new Promise(function (ok, bad) {
      var r = new FileReader();
      r.onerror = function () { bad(new Error('Could not read that file.')); };
      if (file.type === 'application/pdf') {
        if (!allowPdf) return bad(new Error('Please choose a photo.'));
        if (file.size > 2000000) return bad(new Error('That PDF is too big (limit 2 MB). Please upload a photo instead.'));
        r.onload = function () { ok(r.result); }; return r.readAsDataURL(file);
      }
      if (!/^image\//.test(file.type)) return bad(new Error('Please choose a photo' + (allowPdf ? ' or a PDF.' : '.')));
      r.onload = function () {
        var img = new Image();
        img.onerror = function () { bad(new Error('Could not read that photo.')); };
        img.onload = function () {
          var sc = Math.min(1, 1200 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
          cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          ok(cv.toDataURL('image/jpeg', 0.75));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  }

  function act(body) {
    var m = $('adm-d-msg'); say(m, 'Saving…');
    return sb.auth.getSession().then(function (r) {
      var t = r.data && r.data.session ? r.data.session.access_token : token;
      if (window.SELVI_LOCAL_ADMIN) return window.SELVI_LOCAL_ADMIN.act(body);
      return O.call('admin-update', body, t);
    }).then(function () { say(m, 'Saved.'); return load().then(function () { return true; }); }, function (e) { say(m, e.message || 'Could not save.', true); return false; });
  }
})();
