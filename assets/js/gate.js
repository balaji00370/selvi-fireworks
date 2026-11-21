/* Pages that need a customer login (Book Now, Payment, View Orders).
   Works in test mode (browser-only accounts) and in online mode (Supabase). */
(function () {
  'use strict';
  var O = window.SelviOrders;
  if (!O) return;
  var token = ''; try { token = localStorage.getItem('selvi-customer-token') || ''; } catch (e) {}
  var next = location.pathname.split('/').pop() + location.search;
  var toLogin = function () { location.replace('login.html?next=' + encodeURIComponent(next)); };
  if (!token) { document.documentElement.style.visibility = 'hidden'; toLogin(); return; }
  if (!O.remote) return;   // test mode: the saved login is checked in the browser itself
  // quietly confirm the saved login is still valid (30-day sessions can expire)
  O.call('account', { action: 'me' }, null, { 'x-customer-token': token }).then(null, function (e) {
    if (e && e.status === 401) { try { localStorage.removeItem('selvi-customer-token'); localStorage.removeItem('selvi-customer'); } catch (x) {} toLogin(); }
  });
})();
