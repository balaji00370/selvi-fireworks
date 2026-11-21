/* Dark / Light theme toggle (standalone so other scripts cannot break it) */
(function () {
  var KEY = 'selvi-theme';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function saved() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function apply(t) { root.setAttribute('data-theme', t); }

  apply(saved() || (mq && mq.matches ? 'light' : 'dark'));

  function init() {
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        apply(next);
        try { localStorage.setItem(KEY, next); } catch (e) {}
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function (e) { if (!saved()) apply(e.matches ? 'light' : 'dark'); });
  }
})();
