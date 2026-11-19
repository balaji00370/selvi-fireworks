// =============================================
// SELVI FIREWORKS INDUSTRIES - Main JavaScript
// =============================================

(function () {
  'use strict';

  // ── Page Loader ──────────────────────────────
  window.addEventListener('load', function () {
    var loader = document.getElementById('page-loader');
    if (loader) {
      setTimeout(function () {
        loader.classList.add('hidden');
      }, 600);
    }
  });

  // ── Navbar Scroll Behaviour ──────────────────
  var navbar = document.getElementById('navbar');
  if (navbar) {
    var onScroll = function () {
      if (window.scrollY > 60) {
        navbar.classList.add('scrolled');
      } else {
        navbar.classList.remove('scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── Active nav link highlight ────────────────
  (function () {
    var currentPage = window.location.pathname.split('/').pop() || 'index.html';
    var allLinks = document.querySelectorAll('.nav-links a, .mobile-nav a');
    allLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      if (href === currentPage || (currentPage === '' && href === 'index.html')) {
        link.classList.add('active');
      }
    });
  })();

  // ── Hamburger / Mobile Nav ───────────────────
  var hamburger = document.getElementById('hamburger');
  var mobileNav = document.getElementById('mobile-nav');

  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', function () {
      var isOpen = mobileNav.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      });
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!navbar.contains(e.target) && !mobileNav.contains(e.target)) {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  // ── Smooth Scroll for anchor links ──────────
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href').slice(1);
      if (!targetId) return;
      var target = document.getElementById(targetId);
      if (target) {
        e.preventDefault();
        var navH = navbar ? navbar.offsetHeight : 72;
        var top = target.getBoundingClientRect().top + window.scrollY - navH - 20;
        window.scrollTo({ top: top, behavior: 'smooth' });
      }
    });
  });

  // ── Intersection Observer – Scroll Animations ─
  (function () {
    var animatedEls = document.querySelectorAll(
      '.anim-fade-up, .anim-fade-in, .anim-fade-left, .anim-fade-right, .anim-scale'
    );

    if (!animatedEls.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('anim-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    animatedEls.forEach(function (el) {
      observer.observe(el);
    });
  })();

  // ── Counter Animation ────────────────────────
  (function () {
    var counters = document.querySelectorAll('[data-count]');
    if (!counters.length) return;

    var counterObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var target = parseInt(el.getAttribute('data-count'), 10);
          var suffix = el.getAttribute('data-suffix') || '';
          var prefix = el.getAttribute('data-prefix') || '';
          var duration = 1800;
          var start = 0;
          var startTime = null;

          function step(timestamp) {
            if (!startTime) startTime = timestamp;
            var progress = Math.min((timestamp - startTime) / duration, 1);
            var eased = 1 - Math.pow(1 - progress, 3);
            var current = Math.floor(eased * target);
            el.textContent = prefix + current + suffix;
            if (progress < 1) {
              requestAnimationFrame(step);
            } else {
              el.textContent = prefix + target + suffix;
            }
          }

          requestAnimationFrame(step);
          counterObserver.unobserve(el);
        });
      },
      { threshold: 0.4 }
    );

    counters.forEach(function (c) { counterObserver.observe(c); });
  })();

  // ── Product Filter (products.html) ──────────
  (function () {
    var filterBtns = document.querySelectorAll('.filter-btn');
    var productCards = document.querySelectorAll('.product-card');
    if (!filterBtns.length || !productCards.length) return;

    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Update active state
        filterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');

        var category = btn.getAttribute('data-filter');

        productCards.forEach(function (card) {
          var cardCat = card.getAttribute('data-category');
          if (category === 'all' || cardCat === category) {
            card.classList.remove('hidden');
            // Re-trigger animation
            card.classList.remove('anim-visible');
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                card.classList.add('anim-visible');
              });
            });
          } else {
            card.classList.add('hidden');
          }
        });
      });
    });
  })();

  // ── Contact Form Validation & Success ────────
  (function () {
    var form = document.getElementById('contact-form');
    if (!form) return;

    var successBox = document.getElementById('form-success');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var valid = true;

      // Clear previous errors
      form.querySelectorAll('.form-error').forEach(function (err) { err.remove(); });
      form.querySelectorAll('.form-control').forEach(function (inp) {
        inp.style.borderColor = '';
      });

      function showError(input, msg) {
        input.style.borderColor = '#ff4444';
        var err = document.createElement('span');
        err.className = 'form-error';
        err.style.cssText = 'color:#ff6666;font-size:0.78rem;margin-top:4px;display:block;';
        err.textContent = msg;
        input.parentNode.appendChild(err);
        valid = false;
      }

      var name = form.querySelector('#fname');
      var phone = form.querySelector('#fphone');
      var email = form.querySelector('#femail');
      var subject = form.querySelector('#fsubject');
      var message = form.querySelector('#fmessage');

      if (name && name.value.trim().length < 2) {
        showError(name, 'Please enter your full name.');
      }
      if (phone && !/^[\d\s\+\-\(\)]{7,15}$/.test(phone.value.trim())) {
        showError(phone, 'Please enter a valid phone number.');
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) {
        showError(email, 'Please enter a valid email address.');
      }
      if (subject && subject.value === '') {
        showError(subject, 'Please select a subject.');
      }
      if (message && message.value.trim().length < 10) {
        showError(message, 'Message must be at least 10 characters.');
      }

      if (valid) {
        var submitBtn = form.querySelector('.form-submit');
        submitBtn.textContent = 'Sending…';
        submitBtn.disabled = true;

        setTimeout(function () {
          form.style.display = 'none';
          if (successBox) {
            successBox.classList.add('show');
            successBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 1000);
      }
    });
  })();

  // ── Gallery Lightbox (gallery.html) ──────────
  (function () {
    var lightbox = document.getElementById('lightbox');
    if (!lightbox) return;

    var lbEmoji = document.getElementById('lb-emoji');
    var lbTitle = document.getElementById('lb-title');
    var lbDesc  = document.getElementById('lb-desc');
    var lbClose = document.getElementById('lb-close');

    document.querySelectorAll('.gallery-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var emoji = item.getAttribute('data-emoji') || '🎆';
        var title = item.getAttribute('data-title') || 'Fireworks';
        var desc  = item.getAttribute('data-desc')  || '';
        if (lbEmoji) lbEmoji.textContent = emoji;
        if (lbTitle) lbTitle.textContent = title;
        if (lbDesc)  lbDesc.textContent  = desc;
        lightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
      });
    });

    function closeLightbox() {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (lbClose) lbClose.addEventListener('click', closeLightbox);

    lightbox.addEventListener('click', function (e) {
      if (e.target === lightbox) closeLightbox();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLightbox();
    });
  })();

  // ── Hero Scroll CTA ──────────────────────────
  var heroScroll = document.getElementById('hero-scroll');
  if (heroScroll) {
    heroScroll.addEventListener('click', function () {
      var target = document.getElementById('features') || document.querySelector('section:nth-of-type(2)');
      if (target) {
        var navH = navbar ? navbar.offsetHeight : 72;
        window.scrollTo({ top: target.offsetTop - navH, behavior: 'smooth' });
      }
    });
  }

  // ── Canvas Fireworks (Hero Enhancement) ──────
  (function () {
    var canvas = document.getElementById('fw-canvas');
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    var particles = [];
    var rockets = [];

    function resize() {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    function random(min, max) { return Math.random() * (max - min) + min; }

    var COLORS = [
      '#FFD700', '#FFA500', '#FF6B00', '#FF3366',
      '#00E5FF', '#C0FF00', '#FF69B4', '#FFFFFF',
      '#FF4500', '#7FFF00', '#FF1493', '#00BFFF'
    ];

    function createRocket() {
      var x = random(canvas.width * 0.1, canvas.width * 0.9);
      var y = canvas.height + 10;
      var targetY = random(canvas.height * 0.05, canvas.height * 0.45);
      return {
        x: x, y: y,
        targetY: targetY,
        speed: random(4, 8),
        color: COLORS[Math.floor(random(0, COLORS.length))],
        exploded: false,
        trail: []
      };
    }

    function explodeRocket(rocket) {
      var count = Math.floor(random(60, 120));
      for (var i = 0; i < count; i++) {
        var angle = (Math.PI * 2 / count) * i + random(-0.1, 0.1);
        var speed = random(1, 6);
        var color = random(0, 1) < 0.3 ? COLORS[Math.floor(random(0, COLORS.length))] : rocket.color;
        particles.push({
          x: rocket.x, y: rocket.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          alpha: 1,
          size: random(1.5, 3.5),
          color: color,
          gravity: 0.08,
          decay: random(0.012, 0.025),
          trail: []
        });
      }
    }

    var frameCount = 0;
    var rocketInterval = 80;

    function animate() {
      requestAnimationFrame(animate);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Spawn rockets
      frameCount++;
      if (frameCount % rocketInterval === 0) {
        rockets.push(createRocket());
        rocketInterval = Math.floor(random(60, 120));
      }

      // Update & draw rockets
      rockets = rockets.filter(function (r) {
        if (r.exploded) return false;

        r.trail.push({ x: r.x, y: r.y });
        if (r.trail.length > 8) r.trail.shift();

        r.y -= r.speed;

        // Draw trail
        r.trail.forEach(function (pt, idx) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.5, 0, Math.PI * 2);
          ctx.fillStyle = r.color;
          ctx.globalAlpha = idx / r.trail.length * 0.5;
          ctx.fill();
        });
        ctx.globalAlpha = 1;

        // Draw rocket
        ctx.beginPath();
        ctx.arc(r.x, r.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = r.color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = r.color;
        ctx.fill();
        ctx.shadowBlur = 0;

        if (r.y <= r.targetY) {
          explodeRocket(r);
          r.exploded = true;
        }
        return !r.exploded;
      });

      // Update & draw particles
      particles = particles.filter(function (p) {
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;

        if (p.alpha <= 0) return false;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.shadowBlur = 6;
        ctx.shadowColor = p.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        return true;
      });
    }

    animate();

    // Initial rockets
    setTimeout(function () { rockets.push(createRocket()); }, 500);
    setTimeout(function () { rockets.push(createRocket()); }, 1200);
    setTimeout(function () { rockets.push(createRocket()); }, 2000);
  })();

})();
