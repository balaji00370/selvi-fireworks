/* Shop data from the admin panel (online mode only; test mode keeps the page as it is).
   - Settings: packing %, minimum order, booking on/off, UPI id, bank details.
   - Book Now: categories and products (rate, packing, order, active) are rebuilt from the database.
   The last settings are remembered in this browser so the Payment page uses them straight away. */
(function (w) {
  'use strict';
  var O = w.SelviOrders; if (!O) return;
  var KEY = 'selvi-settings', cfg = w.SELVI_CONFIG || {};
  var R = w.SELVI_RULES = { pack: 3, min: 5000, open: true };
  var S = {};
  try { S = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  var num = function (v, d) { var n = parseFloat(v); return isFinite(n) && n >= 0 ? n : d; };

  function apply(s) {
    R.pack = num(s['PACKING-PERCENTAGE'], 3);
    R.min = num(s['MIN-ORDER-VALUE'], 5000);
    R.open = String(s.ORDER_ENABLE_FLAG == null ? 'TRUE' : s.ORDER_ENABLE_FLAG).toUpperCase() === 'TRUE';
    if (s.ORDER_UPI_ID) O.UPI.id = s.ORDER_UPI_ID;
    if (s.ORDER_UPI_NAME) O.UPI.name = s.ORDER_UPI_NAME;
  }
  function fill(s) {
    document.querySelectorAll('[data-rule]').forEach(function (el) {
      var k = el.getAttribute('data-rule');
      el.textContent = k === 'pack' ? String(R.pack) : R.min.toLocaleString('en-IN');
    });
    document.querySelectorAll('[data-setting]').forEach(function (el) {
      var v = s[el.getAttribute('data-setting')]; if (v) el.textContent = v;
    });
    var bar = document.getElementById('booking-off');
    if (bar) bar.hidden = R.open;
    if (typeof w.updateTotals === 'function') { try { w.updateTotals(); } catch (e) {} }
  }
  var LOCAL = null;   // test mode: the test admin keeps its data in this browser
  if (!O.remote) { try { LOCAL = JSON.parse(localStorage.getItem('selvi-local-admin-db') || 'null'); } catch (e) {} if (!LOCAL) return; }
  if (LOCAL) { var ls = {}; LOCAL.settings.forEach(function (r) { ls[r.key] = r.value; }); S = ls; }
  apply(S);
  document.addEventListener('DOMContentLoaded', function () { fill(S); });
  if (LOCAL) { document.addEventListener('DOMContentLoaded', function () { build(); }); }

  var base = O.remote ? cfg.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/' : '', H = O.remote ? { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey } : {};
  function get(path) {
    if (LOCAL) {
      var t = path.split('?')[0], rows = LOCAL[t] || [];
      if (t !== 'settings') rows = rows.filter(function (r) { return r.active; });
      if (t !== 'settings') rows = rows.slice().sort(function (a, b) { return (a.rank || 0) - (b.rank || 0); });
      return Promise.resolve(rows);
    }
    return fetch(base + path, { headers: H }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  if (!LOCAL) get('settings?select=key,value').then(function (rows) {
    var s = {}; rows.forEach(function (r) { s[r.key] = r.value; });
    S = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
    apply(s);
    if (document.readyState !== 'loading') fill(s); else document.addEventListener('DOMContentLoaded', function () { fill(s); });
  }).catch(function () {});

  /* ---------- Book Now price list ---------- */
  var esc = O.esc;
  function slug(t) { return 'cat-' + String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function row(p) {
    var img = 'assets/images/products/prod_' + p.pid + '.jpg', rate = Number(p.rate).toFixed(2);
    var open = esc('openLightbox(' + [img, p.name, p.code, rate, String(p.pid)].map(function (x) { return JSON.stringify(x); }).join(',') + ')');
    return '<tr id="row-' + p.pid + '"><td class="prod-cell"><div class="prod-flex">' +
      '<div class="prod-thumb-box" onclick="' + open + '" title="Click to view image"><img src="' + img + '" alt="' + esc(p.name) + '" class="prod-thumb-img" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>' +
      '<div class="prod-info"><div class="prod-name" onclick="' + open + '">' + esc(p.name) + '</div><div class="prod-code-sub">Code: ' + esc(p.code) + '</div></div></div></td>' +
      '<td class="prod-rate">&#8377; ' + rate + '</td>' +
      '<td><input type="number" class="qty-input" inputmode="numeric" min="0" data-rate="' + Number(p.rate) + '" data-pid="' + p.pid + '" data-pname="' + esc(p.name) + '" placeholder="0" oninput="updateTotals()"></td>' +
      '<td class="prod-amt" id="amt-' + p.pid + '"></td></tr>';
  }
  function build() {
    var list = document.getElementById('price-list'); if (!list) return;
    var tpl = list.querySelector('.price-section'); if (!tpl) return;
    Promise.all([get('categories?select=*&active=eq.true&order=rank'), get('products?select=*&active=eq.true&order=rank')]).then(function (a) {
      var cats = a[0], prods = a[1];
      if (!cats.length || !prods.length) return;
      var keep = {};   // remember quantities already typed
      document.querySelectorAll('.qty-input').forEach(function (i) { if (i.value) keep[i.dataset.pid] = i.value; });
      var frag = document.createDocumentFragment(), links = [];
      cats.forEach(function (c) {
        var mine = prods.filter(function (p) { return p.category_id === c.id; }).sort(function (x, y) { return (x.rank - y.rank) || (x.pid - y.pid); });
        if (!mine.length) return;
        var sec = tpl.cloneNode(true), id = slug(c.name);
        sec.id = id;
        var spans = sec.querySelectorAll('.price-cat-header > span');
        if (spans[0]) spans[0].textContent = c.name;
        var cnt = sec.querySelector('.cat-count'); if (cnt) cnt.textContent = '(' + mine.length + ')';
        sec.querySelector('tbody').innerHTML = mine.map(row).join('');
        frag.appendChild(sec);
        links.push('<a class="cat-nav-btn" href="#' + id + '">' + esc(c.name) + '</a>');
      });
      if (!frag.childNodes.length) return;
      list.querySelectorAll('.price-section').forEach(function (s) { s.remove(); });
      list.appendChild(frag);
      var nav = document.querySelector('.cat-nav-inner');
      if (nav) {
        var last = nav.querySelector('a[href="#checkout-landscape"]');
        nav.innerHTML = links.join(''); if (last) nav.appendChild(last);
      }
      document.querySelectorAll('.qty-input').forEach(function (i) { if (keep[i.dataset.pid]) i.value = keep[i.dataset.pid]; });
      if (typeof w.updateTotals === 'function') w.updateTotals();
    }).catch(function () {});
  }
  if (!LOCAL) { if (document.readyState !== 'loading') build(); else document.addEventListener('DOMContentLoaded', build); }
})(window);
