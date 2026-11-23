/* Admin: Products, Categories, Brands, Settings and Password (the "control panel" sections of the old admin).
   Admins change the data in Supabase; the website reads the same tables, so changes show on the site. */
(function () {
  'use strict';
  var O = window.SelviOrders, $ = function (id) { return document.getElementById(id); }, esc = O.esc;
  var sb = null, ready = false;
  var cache = { brands: [], categories: [] };

  function say(msg, bad) { var m = $('mm-msg'); m.textContent = msg || ''; m.hidden = !msg; m.className = 'adm-msg' + (bad ? ' bad' : ''); }
  function fail(e) {
    var t = (e && e.message) || 'Could not save.';
    if (/foreign key|violates/i.test(t)) t = 'This item is already used (by orders or products). Please make it Inactive instead of deleting it.';
    if (/row-level security|permission/i.test(t)) t = 'You do not have permission. Log in with an admin account.';
    if (/duplicate key/i.test(t)) t = 'That name or code already exists.';
    say(t, true);
  }

  /* ---------- section switcher ---------- */
  var SECTIONS = ['orders', 'products', 'categories', 'brands', 'settings', 'password'];
  function show(name) {
    if (SECTIONS.indexOf(name) < 0) name = 'orders';
    SECTIONS.forEach(function (s) { $('v-' + s).hidden = s !== name; });
    document.querySelectorAll('#adm-tabs button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-v') === name); });
    say('');
    if (name !== 'orders' && ready) VIEWS[name]();
    try { history.replaceState(null, '', '#' + name); } catch (e) {}
  }
  $('adm-tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (b) show(b.getAttribute('data-v')); });

  /* ---------- a small generic editor (table + add/edit form) ---------- */
  function Editor(cfg) {
    var rows = [], editing = null, pend = {}, draft = null;   // draft = what is typed in the open form
    var box = $(cfg.box);
    function val(r, f) { return f.get ? f.get(r) : r[f.k]; }
    function load() {
      return Promise.all([cfg.beforeLoad ? cfg.beforeLoad() : null,
        sb.from(cfg.table).select('*').order(cfg.order[0], { ascending: true }).order(cfg.order[1] || cfg.order[0], { ascending: true }).limit(1000)
      ]).then(function (a) {
        if (a[1].error) { fail(a[1].error); return; }
        rows = a[1].data || []; draw();
      });
    }
    function snap(fe) { var o = {}; [].forEach.call(fe.elements, function (el) { if (el.name) o[el.name] = el.value; }); return o; }
    function draw() {
      var liveForm = box.querySelector('form.mm-form'); if (liveForm && editing !== null) draft = snap(liveForm);   // keep what was typed
      var q = (box.querySelector('.mm-q') || {}).value || '', ex = cfg.extraFilter ? cfg.extraFilter(box) : null;
      var shown = rows.filter(function (r) {
        if (ex && !ex(r)) return false;
        return !q || JSON.stringify(r).toLowerCase().indexOf(q.toLowerCase()) >= 0;
      });
      var head = '<div class="mm-bar"><input class="adm-search mm-q" type="search" placeholder="Search" value="' + esc(q) + '">' +
        (cfg.filterHtml ? cfg.filterHtml() : '') +
        '<button type="button" class="btn btn-primary btn-sm" data-add>+ Add ' + cfg.noun + '</button></div>' +
        '<div id="' + cfg.box + '-form"></div>';
      var th = cfg.cols.map(function (c) { return '<th' + (c.r ? ' class="r"' : '') + '>' + c.h + '</th>'; }).join('') + '<th>Active</th><th></th>';
      var body = shown.map(function (r) {
        return '<tr data-id="' + r[cfg.id] + '">' + cfg.cols.map(function (c) { return '<td' + (c.r ? ' class="r"' : '') + '>' + (c.html ? c.html(r) : esc(c.show ? c.show(r) : r[c.k])) + '</td>'; }).join('') +
          '<td><input type="checkbox" data-act ' + (r.active ? 'checked' : '') + ' aria-label="Active"></td>' +
          '<td class="mm-btns"><button type="button" class="btn btn-outline btn-sm" data-edit>Edit</button> <button type="button" class="btn btn-outline btn-sm bad" data-del>Delete</button></td></tr>';
      }).join('') || '<tr><td colspan="' + (cfg.cols.length + 2) + '" class="adm-none">Nothing here yet.</td></tr>';
      box.innerHTML = head + '<div class="adm-tablewrap"><table class="adm-table stack"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
        '<p class="adm-hint">' + shown.length + ' of ' + rows.length + ' shown. ' + (cfg.hint || '') + '</p>';
      if (window.SelviLabelize) window.SelviLabelize(box);
      if (editing !== null) form(editing, true);
    }
    /* shrink a chosen photo to about 900 px (WebP) before saving it */
    function shrink(file) {
      return new Promise(function (ok, bad) {
        if (!/^image\//.test(file.type)) return bad(new Error('Please choose a photo (JPG, PNG or WebP).'));
        var r = new FileReader();
        r.onerror = function () { bad(new Error('Could not read that photo.')); };
        r.onload = function () {
          var img = new Image();
          img.onerror = function () { bad(new Error('Could not read that photo.')); };
          img.onload = function () {
            var sc = Math.min(1, 900 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
            cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
            var cx = cv.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
            cv.toBlob(function (b) { ok({ blob: b, url: cv.toDataURL('image/webp', 0.82) }); }, 'image/webp', 0.82);
          };
          img.src = r.result;
        };
        r.readAsDataURL(file);
      });
    }
    function form(id, keep) {
      editing = id;
      if (!keep) { pend = {}; draft = null; }
      var r = id === 0 ? (cfg.blank ? cfg.blank() : {}) : rows.filter(function (x) { return x[cfg.id] === id; })[0] || {};
      var fields = cfg.fields.map(function (f) {
        var v = r[f.k] == null ? '' : r[f.k], inp;
        if (keep && draft && draft[f.k] !== undefined) v = draft[f.k];   // continue where it was left
        if (f.img) {
          var cur = pend[f.k] ? pend[f.k].url : (pend[f.k] === null ? '' : (v ? O.productImg({ image_path: v, pid: r.pid }) : (id !== 0 ? O.productImg(r) : '')));
          return '<div class="mm-imgfield"><label>' + f.l + '</label><div class="mm-imgbox" data-box="' + f.k + '">' +
            '<img data-prev="' + f.k + '" alt="Product photo" src="' + esc(cur) + '" onerror="this.style.display=\'none\'">' +
            '<span class="mm-noimg">No photo yet</span></div>' +
            '<label class="adm-file" for="mm-file-' + f.k + '"><span>&#128247; ' + (cur ? 'Change photo' : 'Add photo') + '</span>' +
            '<input id="mm-file-' + f.k + '" type="file" accept="image/*" data-file="' + f.k + '"></label>' +
            '<button type="button" class="btn btn-outline btn-sm" data-rmimg="' + f.k + '">Remove photo</button>' +
            '<input type="hidden" name="' + f.k + '" value="' + esc(v) + '"></div>';
        }
        if (f.opts) inp = '<select name="' + f.k + '">' + f.opts().map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
        else inp = '<input name="' + f.k + '" type="' + (f.t || 'text') + '"' + (f.step ? ' step="' + f.step + '"' : '') + ' value="' + esc(v) + '"' + (f.req ? ' required' : '') + '>';
        return '<div><label>' + f.l + (f.req ? ' *' : '') + '</label>' + inp + '</div>';
      }).join('');
      $(cfg.box + '-form').innerHTML = '<form class="panel mm-form" novalidate><div class="panel-head"><span>' + (id === 0 ? 'Add ' : 'Edit ') + cfg.noun + '</span></div>' +
        '<div class="panel-body"><div class="mm-grid">' + fields + '</div>' +
        '<div class="adm-actions"><button type="submit" class="main">Save</button><button type="button" data-cancel>Cancel</button></div></div></form>';
      $(cfg.box + '-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function save(f) {
      var data = {}, uploads = [];
      cfg.fields.forEach(function (x) {
        var v = f.elements[x.k].value;
        if (x.img) {
          if (pend[x.k]) {   // a new photo was chosen: keep it in the browser (test mode) or upload it
            var pf = pend[x.k];
            if (window.SELVI_LOCAL_ADMIN) { v = pf.url; }
            else {
              var path = 'p-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.webp';
              uploads.push(sb.storage.from('product-images').upload(path, pf.blob, { contentType: 'image/webp' }).then(function (r) { if (r.error) throw r.error; }));
              v = path;
            }
          }
          data[x.k] = v || null; return;
        }
        if (x.t === 'number' || x.num) v = v === '' ? null : Number(v);
        if (x.int && v != null) v = Math.round(v);
        data[x.k] = v;
      });
      var bad = cfg.check ? cfg.check(data) : '';
      if (bad) { say(bad, true); return; }
      say('Saving…');
      Promise.all(uploads).then(function () {
        var req = editing === 0 ? sb.from(cfg.table).insert(data) : sb.from(cfg.table).update(data).eq(cfg.id, editing);
        return req.then(function (r) {
          if (r.error) { fail(r.error); return; }
          editing = null; pend = {}; draft = null; say('Saved ✓'); load();
        });
      }).catch(fail);
    }
    box.addEventListener('click', function (e) {
      var t = e.target, tr = t.closest('tr[data-id]'), id = tr ? Number(tr.getAttribute('data-id')) : 0;
      if (t.closest('[data-add]')) { form(0); }
      else if (t.closest('[data-edit]')) { form(id); }
      else if (t.closest('[data-rmimg]')) {
        var rk = t.closest('[data-rmimg]').getAttribute('data-rmimg');
        pend[rk] = null; var hid = box.querySelector('input[name="' + rk + '"]'); if (hid) hid.value = '';
        var pv2 = box.querySelector('[data-prev="' + rk + '"]'); if (pv2) pv2.style.display = 'none';
        var nb2 = box.querySelector('[data-box="' + rk + '"]'); if (nb2) nb2.classList.remove('has');
        say('The photo will be removed when you press Save.');
      }
      else if (t.closest('[data-cancel]')) { editing = null; draft = null; pend = {}; $(cfg.box + '-form').innerHTML = ''; }
      else if (t.closest('[data-del]')) {
        var r = rows.filter(function (x) { return x[cfg.id] === id; })[0];
        window.SelviDialog.ask({ icon: '&#128465;', title: 'Delete "' + (r[cfg.title] || id) + '"?', text: 'If it is already used by orders or products, make it Inactive instead of deleting it.', ok: 'Yes, delete', cancel: 'Keep it' })
          .then(function (yes) {
            if (!yes) return;
            sb.from(cfg.table).delete().eq(cfg.id, id).then(function (x) { if (x.error) fail(x.error); else { say('Deleted.'); load(); } });
          });
      }
    });
    box.addEventListener('change', function (e) {
      var t = e.target, tr = t.closest('tr[data-id]');
      if (t.hasAttribute('data-file')) {
        var k = t.getAttribute('data-file'), file = t.files && t.files[0]; if (!file) return;
        shrink(file).then(function (d) {
          pend[k] = d; say('');
          var pv = box.querySelector('[data-prev="' + k + '"]'); if (pv) { pv.src = d.url; pv.style.display = 'block'; }
          var nb = box.querySelector('[data-box="' + k + '"]'); if (nb) nb.classList.add('has');
        }, function (err) { say(err.message, true); });
        return;
      }
      if (t.hasAttribute('data-act') && tr) {
        sb.from(cfg.table).update({ active: t.checked }).eq(cfg.id, Number(tr.getAttribute('data-id'))).then(function (r) { if (r.error) { fail(r.error); load(); } else { say('Saved ✓'); var x = rows.filter(function (y) { return y[cfg.id] === Number(tr.getAttribute('data-id')); })[0]; if (x) x.active = t.checked; } });
      } else if (t.hasAttribute('data-filter')) draw();
    });
    box.addEventListener('input', function (e) {
      if (e.target.classList.contains('mm-q')) { draw(); return; }
      var fe = e.target.closest && e.target.closest('form.mm-form'); if (fe) draft = snap(fe);
    });
    box.addEventListener('change', function (e) { var fe = e.target.closest && e.target.closest('form.mm-form'); if (fe) draft = snap(fe); });
    box.addEventListener('submit', function (e) { e.preventDefault(); save(e.target); });
    return { load: load, rows: function () { return rows; } };
  }

  var brandOpts = function () { return [['', '— none —']].concat(cache.brands.map(function (b) { return [b.id, b.name]; })); };
  var catOpts = function () { return [['', '— none —']].concat(cache.categories.map(function (c) { return [c.id, c.name]; })); };
  var nameOf = function (list, id) { var x = list.filter(function (y) { return y.id === id; })[0]; return x ? x.name : ''; };
  var loadLists = function () {
    return Promise.all([sb.from('brands').select('*').order('rank'), sb.from('categories').select('*').order('rank')]).then(function (a) {
      cache.brands = a[0].data || []; cache.categories = a[1].data || [];
    });
  };

  var brands = Editor({
    box: 'v-brands', table: 'brands', id: 'id', title: 'name', noun: 'brand', order: ['rank', 'name'],
    cols: [{ h: 'Name', k: 'name' }, { h: 'Details', k: 'details' }, { h: 'Rank', k: 'rank', r: 1 }],
    fields: [{ k: 'name', l: 'Name', req: 1 }, { k: 'details', l: 'Details' }, { k: 'rank', l: 'Rank (order on the site)', t: 'number', int: 1 }],
    blank: function () { return { rank: 10 }; }, check: function (d) { return d.name.trim() ? '' : 'Please enter a name.'; }
  });
  var cats = Editor({
    box: 'v-categories', table: 'categories', id: 'id', title: 'name', noun: 'category', order: ['rank', 'name'],
    beforeLoad: loadLists,
    cols: [{ h: 'Name', k: 'name' }, { h: 'Details', k: 'details' }, { h: 'Brand', show: function (r) { return nameOf(cache.brands, r.brand_id); } }, { h: 'Rank', k: 'rank', r: 1 }],
    fields: [{ k: 'name', l: 'Name', req: 1 }, { k: 'details', l: 'Details' }, { k: 'brand_id', l: 'Brand', opts: brandOpts, num: 1 }, { k: 'rank', l: 'Rank (order on the site)', t: 'number', int: 1 }],
    blank: function () { return { rank: 10, brand_id: cache.brands[0] && cache.brands[0].id }; },
    check: function (d) { return d.name.trim() ? '' : 'Please enter a name.'; }
  });
  var prods = Editor({
    box: 'v-products', table: 'products', id: 'pid', title: 'name', noun: 'product', order: ['category_id', 'rank'],
    beforeLoad: loadLists,
    hint: 'To change a product that is already sold, edit it here. To retire it, untick Active. Do not rename a product into a different one: make the old one Inactive and add a new product.',
    filterHtml: function () {
      return '<select data-filter class="mm-cat"><option value="">All categories</option>' + cache.categories.map(function (c) { return '<option value="' + c.id + '"' + (String(prodCat) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>';
    },
    extraFilter: function (box) { var s = box.querySelector('.mm-cat'); prodCat = s ? s.value : prodCat; return function (r) { return !prodCat || String(r.category_id) === String(prodCat); }; },
    cols: [{ h: 'Photo', html: function (r) { return '<img class="mm-thumb" src="' + esc(O.productImg(r)) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'; } }, { h: 'Rank', k: 'rank', r: 1 }, { h: 'Code', k: 'code' }, { h: 'Name', k: 'name' }, { h: 'Category', show: function (r) { return nameOf(cache.categories, r.category_id); } },
      { h: 'Packing', k: 'packing' }, { h: 'List price', r: 1, show: function (r) { return Number(r.list_price == null ? r.rate : r.list_price).toFixed(2); } }, { h: 'Rate', r: 1, show: function (r) { return Number(r.rate).toFixed(2); } }],
    fields: [{ k: 'code', l: 'Code', req: 1 }, { k: 'name', l: 'Name', req: 1 }, { k: 'category_id', l: 'Category', opts: catOpts, num: 1 }, { k: 'packing', l: 'Packing' },
      { k: 'list_price', l: 'List price (₹)', t: 'number', step: '0.01' }, { k: 'rate', l: 'Rate (₹)', t: 'number', step: '0.01', req: 1 }, { k: 'rank', l: 'Rank (order in category)', t: 'number', int: 1 }, { k: 'image_path', l: 'Photo', img: 1 }],
    blank: function () { return { packing: '1 Pkt', rank: 0, category_id: prodCat ? Number(prodCat) : null }; },
    check: function (d) {
      if (!String(d.code).trim() || !String(d.name).trim()) return 'Code and name are required.';
      if (d.rate == null || d.rate < 0) return 'Please enter the rate.';
      if (d.list_price == null) d.list_price = d.rate;
      d.packing = d.packing || '1 Pkt'; d.rank = d.rank || 0; return '';
    }
  });
  var prodCat = '';

  /* ---------- settings ---------- */
  var HELP = {
    'PACKING-PERCENTAGE': 'Packing charge added to every order (%)', 'GST-PERCENTAGE': 'GST (%) — 0 if prices already include it', 'DISCOUNT-PERCENTAGE': 'Discount (%)',
    'MIN-ORDER-VALUE': 'Smallest order total allowed (₹)', 'ORDER_ENABLE_FLAG': 'TRUE = customers can book online, FALSE = booking switched off',
    'ORDER_UPI_ID': 'UPI ID customers pay to', 'ORDER_UPI_NAME': 'Name shown with the UPI payment', 'ORDER-EMAIL': 'Email that receives order alerts',
    'ADMIN_NO': 'Staff phone number (digits only)', 'ADMIN_TXT': 'Staff phone as shown', 'CONTACT_TOP_NO': 'Phone number at the top of the site (digits)', 'CONTACT_TOP_TXT': 'Phone number at the top as shown',
    'COMPANY_CITY': 'Company name and city', 'BANK1_NAME': 'Bank account holder', 'BANK1_BANK': 'Bank name', 'BANK1_BRANCH': 'Branch', 'BANK1_ADDR': 'Branch address', 'BANK1_STATE': 'State', 'BANK1_NUMBER': 'Account number', 'BANK1_IFSC': 'IFSC code'
  };
  function settings() {
    var typed = {};   // values typed but not saved yet stay when the tab is opened again
    $('v-settings').querySelectorAll('tr[data-k]').forEach(function (tr) { var i = tr.querySelector('.mm-sv'); if (i && i.value !== i.defaultValue) typed[tr.getAttribute('data-k')] = i.value; });
    sb.from('settings').select('*').order('key').then(function (r) {
      if (r.error) { fail(r.error); return; }
      $('v-settings').innerHTML = '<div class="adm-tablewrap"><table class="adm-table"><thead><tr><th>Setting</th><th>Value</th><th></th></tr></thead><tbody>' +
        r.data.map(function (s) {
          return '<tr data-k="' + esc(s.key) + '"><td><b>' + esc(s.key) + '</b><small>' + esc(HELP[s.key] || '') + '</small></td><td><input class="mm-sv" value="' + esc(s.value) + '"></td>' +
            '<td><button type="button" class="btn btn-outline btn-sm" data-save>Save</button></td></tr>';
        }).join('') + '</tbody></table></div><p class="adm-hint">Packing %, minimum order and the on/off switch are used for every new order straight away.</p>';
      Object.keys(typed).forEach(function (k) { var tr = $('v-settings').querySelector('tr[data-k="' + k + '"]'); if (tr) tr.querySelector('.mm-sv').value = typed[k]; });
    });
  }
  $('v-settings').addEventListener('click', function (e) {
    var b = e.target.closest('[data-save]'); if (!b) return;
    var tr = b.closest('tr'), k = tr.getAttribute('data-k'), v = tr.querySelector('.mm-sv').value.trim();
    if (/PERCENTAGE|MIN-ORDER/.test(k) && !(Number(v) >= 0 && v !== '')) { say('Please enter a number for ' + k + '.', true); return; }
    if (k === 'ORDER_ENABLE_FLAG' && !/^(TRUE|FALSE)$/i.test(v)) { say('Type TRUE or FALSE.', true); return; }
    sb.from('settings').update({ value: k === 'ORDER_ENABLE_FLAG' ? v.toUpperCase() : v, updated_at: new Date().toISOString() }).eq('key', k).then(function (r) { if (r.error) fail(r.error); else say(k + ' saved ✓'); });
  });

  /* ---------- password ---------- */
  function password() {
    if ($('pw-form')) return;   // already open: keep what is typed
    sb.auth.getSession().then(function (r) {
      var em = r.data && r.data.session ? r.data.session.user.email : '';
      $('v-password').innerHTML = '<form class="panel mm-form" id="pw-form" novalidate><div class="panel-head"><span>Change password</span><small>' + esc(em) + '</small></div><div class="panel-body"><div class="mm-grid">' +
        '<div><label>Current password</label><input name="cur" type="password" autocomplete="current-password" required></div>' +
        '<div><label>New password (8+ characters)</label><input name="n1" type="password" autocomplete="new-password" required></div>' +
        '<div><label>Confirm new password</label><input name="n2" type="password" autocomplete="new-password" required></div></div>' +
        '<div class="adm-actions"><button type="submit" class="main">Change password</button></div></div></form>';
      $('pw-form').addEventListener('submit', function (ev) {
        ev.preventDefault(); var f = ev.target;
        if (f.n1.value.length < 8) { say('The new password needs at least 8 characters.', true); return; }
        if (f.n1.value !== f.n2.value) { say('The two new passwords do not match.', true); return; }
        say('Checking…');
        sb.auth.signInWithPassword({ email: em, password: f.cur.value }).then(function (x) {
          if (x.error) { say('Current password is wrong.', true); return; }
          return sb.auth.updateUser({ password: f.n1.value }).then(function (y) { if (y.error) say(y.error.message, true); else { say('Password changed ✓'); f.reset(); } });
        });
      });
    });
  }

  var VIEWS = { products: function () { prods.load(); }, categories: function () { cats.load(); }, brands: function () { brands.load(); }, settings: settings, password: password };

  function init(client) {
    if (ready) return;
    sb = client; ready = true;
    var h = (location.hash || '').replace('#', ''); show(SECTIONS.indexOf(h) >= 0 ? h : 'orders');
  }
  window.addEventListener('selvi-admin-ready', function (e) { init(e.detail.sb); });
  if (window.SELVI_ADMIN_SB) init(window.SELVI_ADMIN_SB);   // login finished before this script loaded
})();
