/* Gallery page: type filter + product photo viewer */
(function () {
  'use strict';
  var grid = document.getElementById('gallery-grid');
  if (!grid) return;

  var tiles = Array.prototype.slice.call(grid.querySelectorAll('.photo-tile'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.gallery-filter-btn'));
  var countEl = document.getElementById('gallery-count');
  var emptyEl = document.getElementById('gallery-empty');
  var FULL = 'assets/images/gallery/f/';
  var THUMB = 'assets/images/gallery/t/';

  /* ---------- filter by cracker type ---------- */
  function apply(cat, updateUrl) {
    var shown = 0, photos = 0;
    tiles.forEach(function (t) {
      var on = cat === 'all' || t.getAttribute('data-cat') === cat;
      t.hidden = !on;
      if (on) { shown++; photos += parseInt(t.getAttribute('data-photo-count'), 10) || 1; }
    });
    chips.forEach(function (c) {
      var active = c.getAttribute('data-filter') === cat;
      c.classList.toggle('active', active);
      c.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (countEl) countEl.textContent = 'Showing ' + shown + ' product' + (shown === 1 ? '' : 's') + ' · ' + photos + ' photos';
    if (emptyEl) emptyEl.hidden = shown !== 0;
    if (updateUrl && window.history && history.replaceState) {
      history.replaceState(null, '', cat === 'all' ? location.pathname + location.search : '#' + cat);
    }
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      apply(c.getAttribute('data-filter'), true);
      if (c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    });
  });
  var wanted = (location.hash || '').replace('#', '');
  var known = chips.some(function (c) { return c.getAttribute('data-filter') === wanted; });
  apply(known ? wanted : 'all', false);

  /* ---------- photo viewer ---------- */
  var lb = document.getElementById('lightbox');
  if (!lb) return;
  var img = document.getElementById('lb-img');
  var titleEl = document.getElementById('lb-title');
  var descEl = document.getElementById('lb-desc');
  var countLb = document.getElementById('lb-count');
  var thumbsEl = document.getElementById('lb-thumbs');
  var prevBtn = document.getElementById('lb-prev');
  var nextBtn = document.getElementById('lb-next');
  var closeBtn = document.getElementById('lb-close');
  var cur = { name: '', cat: '', list: [], i: 0 };
  var opener = null;

  function preload(n) { if (n) { var p = new Image(); p.src = FULL + n + '.webp'; } }

  function show(i) {
    var n = cur.list.length;
    cur.i = (i + n) % n;
    img.src = FULL + cur.list[cur.i] + '.webp';
    img.alt = cur.name + ' – photo ' + (cur.i + 1) + ' of ' + n;
    countLb.textContent = n > 1 ? (cur.i + 1) + ' / ' + n : '';
    Array.prototype.forEach.call(thumbsEl.children, function (b, k) { b.classList.toggle('active', k === cur.i); });
    prevBtn.hidden = nextBtn.hidden = n < 2;
    if (n > 1) { preload(cur.list[(cur.i + 1) % n]); preload(cur.list[(cur.i - 1 + n) % n]); }
  }

  function open(tile) {
    opener = tile;
    cur.name = tile.getAttribute('data-name');
    cur.cat = tile.getAttribute('data-catname');
    cur.list = (tile.getAttribute('data-photos') || '').split(',').filter(Boolean);
    titleEl.textContent = cur.name;
    descEl.textContent = cur.cat;
    thumbsEl.innerHTML = '';
    if (cur.list.length > 1) {
      cur.list.forEach(function (n, k) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'lb-thumb';
        b.setAttribute('aria-label', 'Photo ' + (k + 1));
        var t = document.createElement('img');
        t.src = THUMB + n + '.webp';
        t.alt = '';
        b.appendChild(t);
        b.addEventListener('click', function () { show(k); });
        thumbsEl.appendChild(b);
      });
    }
    show(0);
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  }

  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    if (opener && opener.focus) opener.focus();
  }

  tiles.forEach(function (t) { t.addEventListener('click', function () { open(t); }); });
  closeBtn.addEventListener('click', close);
  prevBtn.addEventListener('click', function () { show(cur.i - 1); });
  nextBtn.addEventListener('click', function () { show(cur.i + 1); });
  lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
  document.addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') show(cur.i - 1);
    else if (e.key === 'ArrowRight') show(cur.i + 1);
  });

  /* swipe on touch screens */
  var x0 = null;
  lb.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', function (e) {
    if (x0 === null || cur.list.length < 2) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(cur.i + (dx < 0 ? 1 : -1));
    x0 = null;
  }, { passive: true });
})();
