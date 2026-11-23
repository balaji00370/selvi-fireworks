/* Confirm-order page: shows the chosen products + details (they can edit the order), then creates the order and opens the bill.
   Payment is no longer taken here: the bill carries the UPI QR and UPI ID. */
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

  var err = $('pay-error'), submit = $('pay-submit');
  function showErr(m) { err.textContent = m || ''; err.hidden = !m; }

  submit.addEventListener('click', function () {
    showErr('');
    submit.disabled = true; submit.textContent = 'Creating your bill…';
    var payment = { method: 'UPI', utr: '', screenshot: '', at: new Date().toISOString() };
    O.submit(pending, payment).then(function (order) {
      O.clearPending();
      submit.textContent = 'Order confirmed ✓';
      location.href = 'bill.html?no=' + encodeURIComponent(order.no) + '&new=1';
    }, function (e) {
      submit.disabled = false; submit.textContent = 'Confirm order & get bill';
      showErr(e && e.message ? e.message : 'Something went wrong. Please try again.');
    });
  });
})();
