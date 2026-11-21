/* login.html: sign up / log in with a mobile number and a 6-digit code (OTP). */
(function () {
  'use strict';
  var O = window.SelviOrders, A = window.SelviAccount;
  var $ = function (id) { return document.getElementById(id); };
  if (!$('lg-wrap')) return;

  if (!O.remote) $('lg-testnote').hidden = false;
  var params = new URLSearchParams(location.search);
  var next = params.get('next') || '';
  if (!/^[a-z0-9_\-]+\.html(\?[\w=&%\-]*)?$/i.test(next)) next = 'account.html';   // only pages of this site

  var mode = params.get('mode') === 'signup' ? 'signup' : 'login';
  var mobile = '', timer = null;

  function say(t, bad) { var m = $('lg-msg'); m.textContent = t || ''; m.hidden = !t; m.className = 'adm-msg' + (bad ? ' bad' : ''); }

  function setMode(m) {
    mode = m;
    $('tab-login').classList.toggle('on', m === 'login');
    $('tab-signup').classList.toggle('on', m === 'signup');
    $('lg-signup-only').hidden = m !== 'signup'; $('lg-email-wrap').hidden = m !== 'signup';
    $('lg-title').textContent = m === 'login' ? 'Welcome back' : 'Create your account';
    $('lg-send').textContent = 'Send OTP';
    say('');
  }
  $('tab-login').addEventListener('click', function () { setMode('login'); });
  $('tab-signup').addEventListener('click', function () { setMode('signup'); });
  setMode(mode);

  // already logged in? go straight on
  if (A.loggedIn()) { A.api('me').then(function () { location.replace(next); }, function () { A.clear(); }); }

  function countdown(sec) {
    var b = $('lg-resend'); b.disabled = true;
    clearInterval(timer);
    timer = setInterval(function () {
      sec--; b.textContent = sec > 0 ? 'Resend code in ' + sec + 's' : 'Resend code';
      if (sec <= 0) { clearInterval(timer); b.disabled = false; }
    }, 1000);
    b.textContent = 'Resend code in ' + sec + 's';
  }

  function sendCode(btn) {
    if (btn) btn.disabled = true;
    return A.api('request_otp', { mobile: mobile, mode: mode, name: $('lg-name').value }).then(function (j) {
      if (btn) btn.disabled = false;
      $('step-1').hidden = true; $('step-2').hidden = false;
      $('lg-sent').textContent = 'We sent a 6-digit code to +91 ' + mobile + '.';
      $('lg-dev').hidden = !j.dev_code; if (j.dev_code) $('lg-dev').textContent = 'Test mode code: ' + j.dev_code;
      $('lg-code').value = ''; $('lg-code').focus();
      countdown(30); say('');
    }, function (e) { if (btn) btn.disabled = false; say(e.message, true); });
  }

  $('step-1').addEventListener('submit', function (e) {
    e.preventDefault();
    mobile = $('lg-mobile').value.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(mobile)) { say('Enter a valid 10-digit mobile number.', true); return; }
    if (mode === 'signup' && $('lg-name').value.trim().length < 2) { say('Please enter your name.', true); return; }
    say('Sending code…'); sendCode($('lg-send'));
  });

  $('lg-resend').addEventListener('click', function () { say('Sending code…'); sendCode(null); });
  $('lg-change').addEventListener('click', function () { $('step-2').hidden = true; $('step-1').hidden = false; clearInterval(timer); say(''); });

  $('step-2').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('lg-code').value.replace(/\D/g, '');
    if (code.length !== 6) { say('Enter the 6-digit code.', true); return; }
    var btn = $('lg-verify'); btn.disabled = true; say('Checking…');
    A.api('verify_otp', { mobile: mobile, code: code, name: $('lg-name').value, email: $('lg-email').value }).then(function (j) {
      A.save(j.token, j.customer);
      say('Logged in ✓');
      location.replace(next);
    }, function (err) { btn.disabled = false; say(err.message, true); });
  });

  $('lg-code').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
})();
