/* Site-styled question popup (replaces the plain browser confirm box).
   SelviDialog.ask({ icon, title, text, ok, cancel }) -> Promise<true|false> */
(function (w) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  function ask(o) {
    o = o || {};
    return new Promise(function (done) {
      var prev = document.activeElement;
      var back = document.createElement('div');
      back.className = 'sd-back';
      back.innerHTML = '<div class="sd-box" role="alertdialog" aria-modal="true" aria-labelledby="sd-title" aria-describedby="sd-text">' +
        '<div class="sd-icon" aria-hidden="true">' + (o.icon || '?') + '</div>' +
        '<h3 class="sd-title" id="sd-title">' + esc(o.title || 'Are you sure?') + '</h3>' +
        '<p class="sd-text" id="sd-text">' + esc(o.text || '') + '</p>' +
        '<div class="sd-btns"><button type="button" class="sd-cancel">' + esc(o.cancel || 'Cancel') + '</button>' +
        '<button type="button" class="sd-ok">' + esc(o.ok || 'OK') + '</button></div></div>';
      document.body.appendChild(back);
      document.body.classList.add('sd-open');
      var okb = back.querySelector('.sd-ok'), nob = back.querySelector('.sd-cancel');
      var finish = function (v) {
        document.removeEventListener('keydown', onKey, true);
        back.remove(); document.body.classList.remove('sd-open');
        if (prev && prev.focus) { try { prev.focus(); } catch (e) {} }
        done(v);
      };
      var onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
        else if (e.key === 'Tab') {   // keep the focus inside the popup
          e.preventDefault(); (document.activeElement === okb ? nob : okb).focus();
        }
      };
      document.addEventListener('keydown', onKey, true);
      okb.addEventListener('click', function () { finish(true); });
      nob.addEventListener('click', function () { finish(false); });
      back.addEventListener('mousedown', function (e) { if (e.target === back) finish(false); });
      okb.focus();
    });
  }
  w.SelviDialog = { ask: ask };
})(window);
