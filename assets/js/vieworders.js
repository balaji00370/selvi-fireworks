/* View Orders page: find an order, show dispatch progress (Packed -> Transporting -> Arrived), open the bill. */
(function () {
  'use strict';
  var O = window.SelviOrders;
  var list = document.getElementById('orders-list');
  if (!list) return;
  var params = new URLSearchParams(location.search);
  var target = (params.get('order') || '').toUpperCase();
  var isNew = params.get('new') === '1';
  var staff = params.get('staff') === '1' && !O.remote;   // test buttons exist only without a server
  var shown = null;            // order opened by a manual search (may not be in the device list)

  function tracker(o) {
    var at = O.stageIndex(o.status);
    var steps = O.STAGES.map(function (s, i) {
      var cls = i < at ? 'done' : i === at ? 'now' : '';
      var when = '';
      (o.history || []).forEach(function (h) { if (h.status === s.key) when = O.dateStr(h.at); });
      return '<li class="trk-step ' + cls + '"><span class="trk-dot">' + (i <= at ? s.icon : '') + '</span>' +
        '<span class="trk-label">' + s.label + '</span><span class="trk-when">' + (i <= at ? when : '') + '</span></li>';
    }).join('');
    var cur = O.STAGES[at];
    var pct = Math.round(at / (O.STAGES.length - 1) * 100);
    return '<ol class="trk" style="--p:' + pct + '%">' + steps + '</ol>' +
      '<p class="trk-note ' + (o.status === 'arrived' ? 'ok' : '') + '">' + cur.icon + ' ' + O.esc(cur.note) +
      (o.status === 'arrived' ? ' <strong>You will receive a call on ' + O.esc(o.customer.mobile) + '.</strong>' : '') + '</p>';
  }

  function card(o) {
    var items = o.items.reduce(function (s, it) { return s + it.qty; }, 0);
    var stage = O.STAGES[O.stageIndex(o.status)];
    var detailRows = o.items.map(function (it) {
      return '<tr><td>' + O.esc(it.name) + '</td><td class="r">' + it.qty + '</td><td class="r">' + O.money(it.amt) + '</td></tr>';
    }).join('');
    var shot = o.payment && o.payment.screenshot
      ? '<div class="ord-proof"><span>Payment screenshot</span><a href="' + o.payment.screenshot + '" target="_blank" rel="noopener"><img src="' + o.payment.screenshot + '" alt="Payment screenshot for ' + O.esc(o.no) + '"></a></div>' : '';
    var staffRow = staff
      ? '<div class="ord-staff"><span>Staff test controls:</span>' + O.STAGES.map(function (s) {
          return '<button type="button" data-set="' + s.key + '" data-no="' + O.esc(o.no) + '"' + (s.key === o.status ? ' class="on"' : '') + '>' + s.label + '</button>';
        }).join('') + '</div>' : '';
    return '<article class="ord-card' + (o.no === target ? ' hl' : '') + '" id="o-' + O.esc(o.no) + '">' +
      '<header class="ord-head"><div><div class="ord-no">' + O.esc(o.no) + '</div><div class="ord-meta">' + O.dateStr(o.date) + ' &middot; ' +
      o.items.length + ' product' + (o.items.length === 1 ? '' : 's') + ' &middot; ' + items + ' items</div></div>' +
      '<div class="ord-right"><span class="chip st-' + o.status + '">' + stage.icon + ' ' + stage.label + '</span><div class="ord-total">' + O.money(o.total) + '</div></div></header>' +
      tracker(o) +
      '<details class="ord-more"><summary>Items ordered</summary><table><tbody>' + detailRows + '</tbody></table>' + shot + '</details>' +
      '<div class="ord-actions"><a class="btn btn-primary btn-sm" href="bill.html?no=' + encodeURIComponent(o.no) + '">View bill</a>' +
      '<a class="btn btn-outline btn-sm" href="bill.html?no=' + encodeURIComponent(o.no) + '&pdf=1">Download PDF</a></div>' + staffRow + '</article>';
  }

  var cache = [];
  function render() {
    var all = cache.slice();
    if (shown && !all.some(function (o) { return o.no === shown.no; })) all = [shown].concat(all);
    list.innerHTML = all.length ? all.map(card).join('') : '';
    document.getElementById('orders-empty').hidden = all.length > 0;
    document.getElementById('orders-title').hidden = all.length === 0;
  }
  function reload() {
    return O.myOrders().then(function (l) { cache = l; render(); });
  }

  if (isNew && target) {
    document.getElementById('new-banner').hidden = false;
    document.getElementById('new-no').textContent = target;
  }

  document.getElementById('find-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var no = document.getElementById('f-no').value.trim().toUpperCase();
    var mob = document.getElementById('f-mobile').value;
    var msg = document.getElementById('find-msg');
    var btn = this.querySelector('button[type=submit]');
    msg.hidden = true;
    btn.disabled = true;
    O.fetch(no, mob).then(function (o) {
      btn.disabled = false;
      if (!o) {
        msg.textContent = 'We could not find an order with that bill number and mobile number' + (O.remote ? '' : ' on this device') + '. Please check them, or call us on ' + O.CONTACT.phone + '.';
        msg.hidden = false; return;
      }
      target = o.no; shown = o; render();
      var el = document.getElementById('o-' + o.no); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, function (err) {
      btn.disabled = false;
      msg.textContent = err && err.message ? err.message : 'Something went wrong. Please try again.';
      msg.hidden = false;
    });
  });

  list.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-set]');
    if (!b) return;
    O.setStatus(b.getAttribute('data-no'), b.getAttribute('data-set'));
    if (shown && shown.no === b.getAttribute('data-no')) shown = O.get(shown.no);
    reload();
  });

  /* live updates: when the admin changes a status the page refreshes by itself (no reload needed) */
  function refreshLive() {
    var again = shown && O.remote ? O.fetch(shown.no, shown.customer.mobile).then(function (o) { if (o) shown = o; }, function () {}) : Promise.resolve();
    if (shown && !O.remote) shown = O.get(shown.no) || shown;
    return again.then(reload).catch(function () {});
  }
  window.addEventListener('storage', function (e) { if (e.key === 'selvi-orders') refreshLive(); });     // test mode: admin in another tab
  setInterval(function () { if (!document.hidden) refreshLive(); }, 8000);                                 // online mode: check every 8 seconds
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshLive(); });

  reload().then(function () {
    if (target) { var el = document.getElementById('o-' + target); if (el) setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 300); }
  });
})();
