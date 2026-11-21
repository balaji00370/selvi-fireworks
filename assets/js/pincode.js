/* Book Now: typing a 6-digit pincode fills Town/City, District and State.
   Uses the free India Post lookup (api.postalpincode.in). Only the pincode is sent. */
(function () {
  'use strict';
  var pin = document.getElementById('cust-pin');
  var city = document.getElementById('cust-city');
  var district = document.getElementById('cust-district');
  var state = document.getElementById('cust-state');
  var status = document.getElementById('pin-status');
  var list = document.getElementById('city-options');
  if (!pin || !city || !district) return;

  var autoCity = '', autoDistrict = '', timer = null, lastPin = '';

  function say(msg, ok) {
    if (!status) return;
    status.textContent = msg || '';
    status.setAttribute('data-ok', ok ? '1' : '0');
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z]/g, ''); }

  function setState(name) {
    if (!state || !name) return;
    var want = norm(name), best = null;
    Array.prototype.forEach.call(state.options, function (o) {
      var n = norm(o.text);
      if (n === want || n.indexOf(want) === 0 || want.indexOf(n) === 0) best = best || o;
    });
    if (best) state.value = best.value || best.text;
  }

  // only overwrite fields the user has not typed in themselves
  function fill(el, value, prevAuto) {
    if (!value) return prevAuto;
    if (el.value.trim() === '' || el.value === prevAuto) { el.value = value; return value; }
    return prevAuto;
  }

  function lookup(code) {
    say('Finding town & district…', true);
    fetch('https://api.postalpincode.in/pincode/' + code)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (pin.value.trim() !== code) return;            // user kept typing
        var res = data && data[0];
        if (!res || res.Status !== 'Success' || !res.PostOffice || !res.PostOffice.length) {
          say('Pincode not found — type town & district', false);
          return;
        }
        var offices = res.PostOffice, first = offices[0];
        var town = first.Block && first.Block !== 'NA' ? first.Block : first.Name;
        if (list) {
          list.innerHTML = '';
          offices.forEach(function (o) {
            var opt = document.createElement('option'); opt.value = o.Name; list.appendChild(opt);
          });
        }
        autoCity = fill(city, town, autoCity);
        autoDistrict = fill(district, first.District, autoDistrict);
        setState(first.State);
        say('✓ ' + (city.value || town) + ', ' + (district.value || first.District), true);
      })
      .catch(function () {
        say('Lookup unavailable — type town & district', false);
      });
  }

  pin.addEventListener('input', function () {
    pin.value = pin.value.replace(/\D/g, '').slice(0, 6);
    clearTimeout(timer);
    if (pin.value.length < 6) { lastPin = ''; say('', true); return; }
    if (pin.value === lastPin) return;
    lastPin = pin.value;
    timer = setTimeout(function () { lookup(pin.value); }, 150);
  });
})();
