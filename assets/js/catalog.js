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

  function loadSettings() {
    return get('settings?select=key,value').then(function (rows) {
      var s = {}; rows.forEach(function (r) { s[r.key] = r.value; });
      S = s; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
      apply(s);
      if (document.readyState !== 'loading') fill(s); else document.addEventListener('DOMContentLoaded', function () { fill(s); });
    }).catch(function () {});
  }
  if (!LOCAL) loadSettings();

  /* ---------- Book Now price list ---------- */
  var esc = O.esc;
  function slug(t) { return 'cat-' + String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function row(p) {
    var img = O.productImg(p), rate = Number(p.rate).toFixed(2);
    var open = esc('openLightbox(' + [img, p.name, p.code, rate, String(p.pid)].map(function (x) { return JSON.stringify(x); }).join(',') + ')');
    return '<tr id="row-' + p.pid + '"><td class="prod-cell"><div class="prod-flex">' +
      '<div class="prod-thumb-box" onclick="' + open + '" title="Click to view image"><img src="' + img + '" alt="' + esc(p.name) + '" class="prod-thumb-img" loading="lazy" onerror="this.parentElement.style.display=\'none\'"></div>' +
      '<div class="prod-info"><div class="prod-name" onclick="' + open + '">' + esc(p.name) + '</div><div class="prod-code-sub">Code: ' + esc(p.code) + '</div></div></div></td>' +
      '<td class="prod-rate">&#8377; ' + rate + '</td>' +
      '<td><input type="number" class="qty-input" inputmode="numeric" min="0" data-rate="' + Number(p.rate) + '" data-pid="' + p.pid + '" data-pname="' + esc(p.name) + '" placeholder="0" oninput="updateTotals()"></td>' +
      '<td class="prod-amt" id="amt-' + p.pid + '"></td></tr>';
  }
  var lastSig = '';
  function build() {
    var list = document.getElementById('price-list'); if (!list) return;
    var tpl = list.querySelector('.price-section'); if (!tpl) return;
    Promise.all([get('categories?select=*&active=eq.true&order=rank'), get('products?select=*&active=eq.true&order=rank')]).then(function (a) {
      var cats = a[0], prods = a[1];
      if (!cats.length || !prods.length) return;
      var sig = JSON.stringify([cats, prods]); if (sig === lastSig) return; lastSig = sig;   // nothing changed: leave the page alone
      var act = document.activeElement, focusPid = act && act.classList && act.classList.contains('qty-input') ? act.dataset.pid : null;
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
      if (focusPid) { var fe = document.querySelector('.qty-input[data-pid="' + focusPid + '"]'); if (fe) fe.focus(); }
      if (typeof w.updateTotals === 'function') w.updateTotals();
    }).catch(function () {});
  }
  if (!LOCAL) { if (document.readyState !== 'loading') build(); else document.addEventListener('DOMContentLoaded', build); }

  /* ---------- Products page (products.html): products added in the admin get their own tab + cards ---------- */
  var lastSigP = '';
  function buildProductsPage() {
    var grid = document.getElementById('products-grid'), tabs = document.querySelector('.filter-tabs');
    if (!grid || !tabs) return;
    Promise.all([get('categories?select=*&active=eq.true&order=rank'), get('products?select=*&active=eq.true&order=rank')]).then(function (a) {
      var cats = a[0], prods = a[1].filter(function (p) { return p.pid >= 1000; });   // products created in the admin
      var sig = JSON.stringify([cats.map(function (c) { return [c.id, c.name]; }), prods]);
      if (sig === lastSigP) return; lastSigP = sig;
      var active = tabs.querySelector('.filter-btn.active'), current = active ? active.getAttribute('data-filter') : 'all';
      document.querySelectorAll('.live-card, .live-tab').forEach(function (e) { e.remove(); });
      var byCat = {}; prods.forEach(function (p) { (byCat[p.category_id] = byCat[p.category_id] || []).push(p); });
      var onTab = function (e) {
        var btn = e.currentTarget, cat = btn.getAttribute('data-filter');
        tabs.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        showCategory(cat);
      };
      var showCategory = function (cat) {
        document.querySelectorAll('.product-card').forEach(function (card) {
          card.classList.toggle('hidden', !(cat === 'all' || card.getAttribute('data-category') === cat));
        });
      };
      tabs.querySelectorAll('.filter-btn:not(.live-tab)').forEach(function (b) { if (!b.__live) { b.__live = 1; b.addEventListener('click', onTab); } });
      var made = {};
      cats.forEach(function (c) {
        var mine = byCat[c.id]; if (!mine) return;
        var key = 'live-' + c.id; made[key] = 1;
        var btn = document.createElement('button'); btn.className = 'filter-btn live-tab'; btn.setAttribute('data-filter', key);
        btn.textContent = '✨ ' + c.name; btn.addEventListener('click', onTab); tabs.appendChild(btn);
        mine.sort(function (x, y) { return (x.rank - y.rank) || (x.pid - y.pid); }).forEach(function (p) {
          grid.insertAdjacentHTML('beforeend', '<div class="product-card live-card" data-category="' + key + '"><div class="product-photo"><img src="' + esc(O.productImg(p)) + '" alt="' + esc(p.name) + '" loading="lazy" width="234" height="280" onerror="this.parentNode.classList.add(\'no-img\')"><span class="product-icon">🎆</span></div>' +
            '<div class="product-name">' + esc(p.name) + '</div><div class="product-category-tag">' + esc(c.name) + '</div>' +
            '<div class="product-desc">Code ' + esc(p.code) + ' &middot; ' + esc(p.packing || '1 Pkt') + ' &middot; &#8377; ' + Number(p.rate).toFixed(2) + '</div>' +
            '<a href="booknow.html" class="btn btn-outline btn-sm" style="margin-top:8px;">Book Now</a></div>');
        });
      });
      if (/^live-/.test(current) && !made[current]) { var all = tabs.querySelector('[data-filter="all"]'); if (all) all.click(); }
      else showCategory(current);
    }).catch(function () {});
  }
  if (document.getElementById('products-grid')) {
    if (document.readyState !== 'loading') buildProductsPage(); else document.addEventListener('DOMContentLoaded', buildProductsPage);
  }

  /* ---------- Gallery page: photos of products added in the admin ---------- */
  var lastSigG = '';
  function buildGalleryPage() {
    var grid = document.getElementById('gallery-grid'), row = document.querySelector('.gallery-filter');
    if (!grid || !row || !w.SelviGallery) return;
    Promise.all([get('categories?select=*&active=eq.true&order=rank'), get('products?select=*&active=eq.true&order=rank')]).then(function (a) {
      var cats = a[0], prods = a[1].filter(function (p) { return p.pid >= 1000 && p.image_path; });   // new products that have a photo
      var sig = JSON.stringify([cats.map(function (c) { return [c.id, c.name]; }), prods]);
      if (sig === lastSigG) return; lastSigG = sig;
      document.querySelectorAll('.live-tile, .live-chip').forEach(function (e) { e.remove(); });
      var byCat = {}; prods.forEach(function (p) { (byCat[p.category_id] = byCat[p.category_id] || []).push(p); });
      cats.forEach(function (c) {
        var mine = byCat[c.id]; if (!mine) return;
        var key = 'live-' + c.id;
        var chip = document.createElement('button'); chip.type = 'button'; chip.className = 'gallery-filter-btn live-chip';
        chip.setAttribute('data-filter', key); chip.setAttribute('aria-pressed', 'false'); chip.innerHTML = esc(c.name) + ' <span class="n">' + mine.length + '</span>';
        row.appendChild(chip);
        mine.sort(function (x, y) { return (x.rank - y.rank) || (x.pid - y.pid); }).forEach(function (p) {
          var url = O.productImg(p), t = document.createElement('button');
          t.type = 'button'; t.className = 'photo-tile live-tile';
          t.setAttribute('data-cat', key); t.setAttribute('data-catname', c.name); t.setAttribute('data-name', p.name); t.setAttribute('data-photo-count', '1');
          t.__photos = [url];
          t.innerHTML = '<span class="photo-frame"><img src="' + esc(url) + '" width="468" height="560" alt="' + esc(p.name) + ' \u2013 Selvi Fireworks, Sivakasi" decoding="async"></span>' +
            '<span class="photo-meta"><span class="photo-name">' + esc(p.name) + '</span><span class="photo-cat">' + esc(c.name) + '</span></span>';
          grid.appendChild(t);
        });
      });
      w.SelviGallery.refresh();
    }).catch(function () {});
  }
  if (document.getElementById('gallery-grid')) {
    if (document.readyState !== 'loading') buildGalleryPage(); else document.addEventListener('DOMContentLoaded', buildGalleryPage);
  }

  /* ---------- live updates: a change in the admin shows here without reloading the page ---------- */
  if (LOCAL) {
    // test mode: the admin (another tab of this browser) saved its data
    w.addEventListener('storage', function (e) {
      if (e.key !== 'selvi-local-admin-db' || !e.newValue) return;
      try { LOCAL = JSON.parse(e.newValue); } catch (x) { return; }
      var ls = {}; LOCAL.settings.forEach(function (r) { ls[r.key] = r.value; });
      S = ls; apply(S); fill(S); build(); buildProductsPage(); buildGalleryPage();
    });
  } else if (document.getElementById('price-list') || document.getElementById('products-grid') || document.getElementById('gallery-grid')) {
    // online: look for changes every 15 seconds while the page is open, and when the customer comes back to it
    var refresh = function () { if (!document.hidden) { loadSettings(); build(); buildProductsPage(); buildGalleryPage(); } };
    setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
  }
})(window);
