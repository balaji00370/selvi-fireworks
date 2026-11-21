/* Customer account helpers (login state, profile page, "my orders", Book Now prefill).
   Login is by mobile number + OTP and is optional: guests can still order. */
(function (w) {
  'use strict';
  var O = w.SelviOrders;
  var KEY_T = 'selvi-customer-token', KEY_P = 'selvi-customer';

  function rd(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function wr(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

  var A = {
    token: function () { return rd(KEY_T) || ''; },
    profile: function () { try { return JSON.parse(rd(KEY_P) || 'null'); } catch (e) { return null; } },
    loggedIn: function () { return !!A.token(); },
    save: function (token, customer) { wr(KEY_T, token); wr(KEY_P, JSON.stringify(customer)); },
    clear: function () { wr(KEY_T, null); wr(KEY_P, null); },
    api: function (action, body) {
      if (!O.remote) {
        return new Promise(function (ok, bad) { try { ok(LOCAL_API[action](body || {})); } catch (e) { bad(e); } });
      }
      return O.call('account', Object.assign({ action: action }, body || {}), null, { 'x-customer-token': A.token() });
    },
    logout: function () {
      var done = function () { A.clear(); };
      return A.api('logout').then(done, done);
    }
  };
  w.SelviAccount = A;

  /* ---- test mode (no Supabase yet): accounts live in this browser and the OTP is shown on screen ---- */
  function lread(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function lwrite(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lerr(msg, status) { var e = new Error(msg); e.status = status; return e; }
  function mob10(m) { return String(m || '').replace(/\D/g, '').slice(-10); }
  function localUser() {
    var t = A.token(); if (!t) return null;
    var m = lread('selvi-local-sessions', {})[t]; if (!m) return null;
    var c = lread('selvi-local-customers', {})[m]; return c ? { name: c.name, mobile: m, email: c.email || '' } : null;
  }
  var LOCAL_API = {
    request_otp: function (b) {
      var m = mob10(b.mobile);
      if (!/^[6-9]\d{9}$/.test(m)) throw lerr('Enter a valid 10-digit mobile number.', 400);
      var has = !!lread('selvi-local-customers', {})[m];
      if (b.mode === 'login' && !has) throw lerr('No account found for this number. Please sign up first.', 404);
      if (b.mode === 'signup' && String(b.name || '').trim().length < 2) throw lerr('Please enter your name.', 400);
      var code = String(Math.floor(100000 + Math.random() * 900000));
      lwrite('selvi-local-otp', { mobile: m, code: code, exp: Date.now() + 600000, tries: 0 });
      return { ok: true, dev_code: code };
    },
    verify_otp: function (b) {
      var m = mob10(b.mobile), o = lread('selvi-local-otp', null);
      if (!o || o.mobile !== m || o.exp < Date.now()) throw lerr('The code has expired. Please ask for a new one.', 400);
      if (o.tries >= 5) throw lerr('Too many wrong codes. Please ask for a new code.', 429);
      if (String(b.code) !== o.code) { o.tries++; lwrite('selvi-local-otp', o); throw lerr('Wrong code. Please check and try again.', 400); }
      try { localStorage.removeItem('selvi-local-otp'); } catch (e) {}
      var cs = lread('selvi-local-customers', {});
      if (!cs[m]) {
        if (String(b.name || '').trim().length < 2) throw lerr('Please enter your name to create the account.', 400);
        cs[m] = { name: String(b.name).trim(), email: String(b.email || '').trim() };
        lwrite('selvi-local-customers', cs);
      }
      var token = 'local-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      var ss = lread('selvi-local-sessions', {}); ss[token] = m; lwrite('selvi-local-sessions', ss);
      return { ok: true, token: token, customer: { name: cs[m].name, mobile: m, email: cs[m].email || '' } };
    },
    me: function () { var u = localUser(); if (!u) throw lerr('Please log in again.', 401); return { ok: true, customer: u }; },
    orders: function () {
      var u = localUser(); if (!u) throw lerr('Please log in again.', 401);
      return { ok: true, orders: O.all().filter(function (x) { return O.digits(x.customer.mobile) === u.mobile; }) };
    },
    update_profile: function (b) {
      var u = localUser(); if (!u) throw lerr('Please log in again.', 401);
      if (String(b.name || '').trim().length < 2) throw lerr('Please enter your name.', 400);
      var cs = lread('selvi-local-customers', {}); cs[u.mobile] = { name: String(b.name).trim(), email: String(b.email || '').trim() };
      lwrite('selvi-local-customers', cs);
      return { ok: true, customer: localUser() };
    },
    logout: function () { var ss = lread('selvi-local-sessions', {}); delete ss[A.token()]; lwrite('selvi-local-sessions', ss); return { ok: true }; }
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---- Book Now: fill the customer details from the account (never overwrite what is typed) ---- */
  var p = A.profile();
  if (p && $('cust-name')) {
    [['cust-name', p.name], ['cust-mobile', p.mobile], ['cust-email', p.email]].forEach(function (x) {
      var el = $(x[0]); if (el && !el.value && x[1]) el.value = x[1];
    });
    var mob = $('cust-mobile');
    if (mob) { mob.value = p.mobile; mob.readOnly = true; mob.title = 'Your verified login number'; }
  }

  /* ---- account.html ---- */
  var box = $('acc-wrap');
  if (!box) return;
  if (!A.loggedIn()) { location.replace('login.html?next=account.html'); return; }

  var form = $('acc-form'), msg = $('acc-msg');
  function say(t, bad) { msg.textContent = t || ''; msg.hidden = !t; msg.className = 'adm-msg' + (bad ? ' bad' : ''); }
  function fill(c) {
    $('acc-name').value = c.name || ''; $('acc-email').value = c.email || '';
    $('acc-mobile').textContent = '+91 ' + c.mobile;
    $('acc-hello').textContent = 'Hello, ' + String(c.name || '').split(/\s+/)[0] + '!';
    box.hidden = false;
  }
  var cached = A.profile(); if (cached) fill(cached);
  A.api('me').then(function (j) { A.save(A.token(), j.customer); fill(j.customer); }, function (e) {
    if (e.status === 401) { A.clear(); location.replace('login.html?next=account.html'); }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault(); say('Saving…');
    A.api('update_profile', { name: $('acc-name').value, email: $('acc-email').value }).then(function (j) {
      A.save(A.token(), j.customer); fill(j.customer); say('Saved ✓');
    }, function (err) { say(err.message, true); });
  });
  $('acc-logout').addEventListener('click', function () { A.logout().then(function () { location.href = 'index.html'; }); });
})(window);
