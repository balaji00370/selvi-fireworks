/* Bill page: shows the bill for ?no=SF26001. "Download PDF" saves a real PDF file; "Print bill" opens the print window.
   ?admin=1 (from the admin page): the back link goes to the admin orders. ?pdf=1 downloads the PDF straight away. */
(function () {
  'use strict';
  var O = window.SelviOrders;
  var params = new URLSearchParams(location.search);
  var no = (params.get('no') || '').toUpperCase();
  var sheet = document.getElementById('bill-sheet');
  var bar = document.getElementById('bill-actions');
  var miss = document.getElementById('bill-missing');
  var ask = document.getElementById('bill-ask');
  var isAdmin = params.get('admin') === '1', current = null;

  function show(o) {
    miss.hidden = true; bar.hidden = false; sheet.hidden = false;
    document.title = 'Bill ' + o.no + ' \u2014 Selvi Fireworks Industries';
    current = o;
    sheet.innerHTML = O.billHtml(o);
    O.renderBillQr(sheet);
    var nb = document.getElementById('bill-new');
    if (nb && params.get('new') === '1' && !O.paid(o)) { nb.hidden = false; nb.innerHTML = '&#10003; <strong>Order confirmed!</strong> Please pay <strong>' + O.money(o.total) + '</strong> using the QR code or UPI ID at the bottom of this bill. We start packing once your payment is received.'; }
    document.getElementById('bill-no').textContent = o.no;
    var back = document.getElementById('bill-orders');
    if (isAdmin) { back.href = 'admin.html#orders'; back.innerHTML = '&larr; Admin orders'; }
    else back.href = 'vieworders.html?order=' + encodeURIComponent(o.no);
    if (params.get('print') === '1') setTimeout(printBill, 600);
    if (params.get('pdf') === '1') setTimeout(downloadPdf, 700);
  }
  function missing(msg) {
    bar.hidden = true; sheet.hidden = true; miss.hidden = false;
    var m = document.getElementById('bill-msg'); if (m) m.textContent = msg || 'We could not find this bill.';
    if (ask) ask.hidden = !O.remote || !no;       // online mode: let the customer type their mobile number
  }

  function downloadPdf() {
    if (!current) return;
    window.SelviBillPdf.download(sheet, current.no, document.getElementById('bill-print'), printBill);
  }
  document.getElementById('bill-print').addEventListener('click', downloadPdf);
  /* Print: add one history step first, so the browser's Back arrow in the print screen returns to this bill page */
  var pushed = false;
  function printBill() {
    try { history.pushState({ billPrint: 1 }, '', location.href); pushed = true; } catch (e) {}
    window.print();
  }
  window.addEventListener('popstate', function () { pushed = false; });
  window.addEventListener('afterprint', function () { if (pushed) { pushed = false; try { history.back(); } catch (e) {} } });
  document.getElementById('bill-print-btn').addEventListener('click', printBill);
  if (ask) ask.addEventListener('submit', function (e) {
    e.preventDefault();
    O.fetch(no, document.getElementById('bill-mobile').value).then(function (o) {
      if (o) show(o); else missing('That mobile number does not match this bill.');
    }, function (err) { missing(err.message); });
  });

  if (!no) { missing(); return; }
  var mobile = O.remote ? (O.refMobile(no) || (params.get('m') || '').replace(/\D/g, '')) : '';
  if (O.remote && !mobile) { missing('Enter the mobile number used for this order to see the bill.'); return; }
  var found = O.remote ? O.fetch(no, mobile) : Promise.resolve(O.get(no));   // this browser's own orders need no mobile number
  found.then(function (o) { if (o) show(o); else missing(); }, function (err) { missing(err.message); });
})();
