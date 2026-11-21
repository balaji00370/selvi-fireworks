/* Payment page: order list, UPI QR / app buttons, payment screenshot, then create the order + bill. */
(function () {
  'use strict';
  var O = window.SelviOrders;
  var wrap = document.getElementById('pay-wrap');
  var empty = document.getElementById('pay-empty');
  var pending = O.getPending();
  if (!pending || !pending.items || !pending.items.length) {
    if (wrap) wrap.hidden = true;
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  wrap.hidden = false;

  var $ = function (id) { return document.getElementById(id); };
  var c = pending.customer || {};

  /* ---------- order list ---------- */
  $('pay-rows').innerHTML = pending.items.map(function (it, i) {
    return '<tr><td>' + (i + 1) + '</td><td><div class="po-name">' + O.esc(it.name) + '</div><div class="po-code">Code: ' + O.esc(it.code) +
      '</div></td><td class="r">' + O.money(it.rate) + '</td><td class="r">' + it.qty + '</td><td class="r">' + O.money(it.amt) + '</td></tr>';
  }).join('');
  $('pay-sub').textContent = O.money(pending.subtotal);
  $('pay-pack').textContent = O.money(pending.packing);
  $('pay-total').textContent = O.money(pending.total);
  $('pay-count').textContent = pending.items.length + ' product' + (pending.items.length === 1 ? '' : 's');
  $('pay-cust').innerHTML = '<strong>' + O.esc(c.name) + '</strong> &middot; ' + O.esc(c.mobile) + '<br>' +
    O.esc([c.addr, c.city, c.district, c.state].filter(Boolean).join(', ') + (c.pin ? ' - ' + c.pin : ''));

  /* ---------- UPI ---------- */
  var amount = (Math.round(pending.total * 100) / 100).toFixed(2);
  var q = 'pa=' + encodeURIComponent(O.UPI.id) + '&pn=' + encodeURIComponent(O.UPI.name) +
          '&am=' + amount + '&cu=INR&tn=' + encodeURIComponent('Selvi Fireworks Order');
  var link = 'upi://pay?' + q;
  $('upi-id').textContent = O.UPI.id;
  $('pay-amount').textContent = O.money(pending.total);

  if (window.QRCode) {
    new QRCode($('qr'), { text: link, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
  } else {
    $('qr').textContent = 'QR could not load. Use the UPI ID above.';
  }

  $('app-any').href = link;
  $('app-gpay').href = 'tez://upi/pay?' + q;
  $('app-phonepe').href = 'phonepe://pay?' + q;
  $('app-paytm').href = 'paytmmp://pay?' + q;
  var touch = (navigator.maxTouchPoints || 0) > 0 && window.innerWidth < 900;
  $('apps').hidden = !touch;
  $('qr-hint').textContent = touch ? 'or scan this QR from another phone' : 'Scan with any UPI app (GPay, PhonePe, Paytm, BHIM)';

  $('copy-upi').addEventListener('click', function () {
    var b = this, done = function () { b.textContent = 'Copied ✓'; setTimeout(function () { b.textContent = 'Copy'; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(O.UPI.id).then(done, done);
    else { var t = document.createElement('textarea'); t.value = O.UPI.id; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); done(); }
  });


  /* the QR turns into "Amount paid successfully" once the customer confirms payment */
  function showPaid(order) {
    var w = $('qr-wrap');
    w.innerHTML = '<div class="paid-box" role="status">' +
      '<svg class="paid-tick" viewBox="0 0 52 52" aria-hidden="true"><circle class="paid-ring" cx="26" cy="26" r="24" fill="none"/><path class="paid-check" fill="none" d="M14 27l8 8 16-17"/></svg>' +
      '<div class="paid-title">Amount paid successfully</div>' +
      '<div class="paid-amt">' + O.money(order.total) + '</div>' +
      '<div class="paid-sub">Paid by UPI to ' + O.esc(O.UPI.name) + '</div>' +
      '<div class="paid-sub">Your bill number is <strong>' + O.esc(order.no) + '</strong></div>' +
      '<div class="paid-sub">Opening your order\u2026</div></div>';
    ['apps', 'copy-upi'].forEach(function (id) { var el = $(id); if (el) el.hidden = true; });
    var row = document.querySelector('.upi-row'); if (row) row.hidden = true;
    var steps = document.querySelectorAll('.pay-steps span'); // step 3 done, step 4 active
    if (steps.length === 4) { steps[2].className = 'done'; steps[3].className = 'on'; }
    w.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- payment screenshot ---------- */
  var file = $('shot-file'), preview = $('shot-preview'), err = $('pay-error'), submit = $('pay-submit');
  var shotData = '';

  function showErr(m) { err.textContent = m || ''; err.hidden = !m; }

  function compress(f, cb) {
    var r = new FileReader();
    r.onerror = function () { cb(null); };
    r.onload = function () {
      var img = new Image();
      img.onerror = function () { cb(null); };
      img.onload = function () {
        var max = 1000, s = Math.min(1, max / Math.max(img.width, img.height));
        var cv = document.createElement('canvas');
        cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cb(cv.toDataURL('image/jpeg', 0.72));
      };
      img.src = r.result;
    };
    r.readAsDataURL(f);
  }

  file.addEventListener('change', function () {
    showErr('');
    var f = file.files && file.files[0];
    if (!f) { shotData = ''; preview.hidden = true; return; }
    if (!/^image\//.test(f.type)) { showErr('Please choose an image (JPG or PNG) of your payment screen.'); file.value = ''; return; }
    compress(f, function (d) {
      if (!d) { showErr('We could not read that image. Please try another screenshot.'); return; }
      shotData = d;
      preview.hidden = false;
      preview.querySelector('img').src = d;
      $('shot-name').textContent = f.name;
    });
  });
  $('shot-remove').addEventListener('click', function () { file.value = ''; shotData = ''; preview.hidden = true; });

  if (!O.remote) { var lb = document.querySelector('#shot-drop b'); if (lb) lb.innerHTML = lb.innerHTML.replace(' *', ' (optional in test mode)'); }
  submit.addEventListener('click', function () {
    showErr('');
    if (!shotData && O.remote) { showErr('Please upload your payment screenshot to continue.'); $('shot-drop').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    submit.disabled = true; submit.textContent = 'Creating your bill\u2026';
    var payment = { method: 'UPI', upi: O.UPI.id, amount: Number(amount), utr: $('utr').value.trim(), screenshot: shotData, at: new Date().toISOString() };
    O.submit(pending, payment).then(function (order) {
      O.clearPending();
      showPaid(order);
      setTimeout(function () { location.href = 'vieworders.html?order=' + encodeURIComponent(order.no) + '&new=1'; }, 2600);
    }, function (e) {
      submit.disabled = false; submit.textContent = 'Confirm payment & get bill';
      showErr(e && e.message ? e.message : 'Something went wrong. Please try again.');
    });
  });
})();
