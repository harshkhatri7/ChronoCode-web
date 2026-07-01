// ChronoCode — Premium Interactive Controller
document.addEventListener('DOMContentLoaded', () => {

  // ─── AMBIENT ORB MOUSE TRACKING ───
  const orb = document.getElementById('orb');
  if (orb) {
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let ox = mx, oy = my;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    (function animOrb() {
      ox += (mx - ox) * 0.04;
      oy += (my - oy) * 0.04;
      orb.style.left = ox + 'px';
      orb.style.top = oy + 'px';
      requestAnimationFrame(animOrb);
    })();
  }

  // ─── MOBILE HAMBURGER MENU ───
  const hamburger = document.querySelector('.nav-hamburger');
  const navLinks = document.querySelector('.nav-links');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navLinks.classList.remove('open');
      });
    });
  }

  // ─── SCROLL REVEAL (IntersectionObserver) with stagger ───
  const reveals = document.querySelectorAll('.reveal, .reveal-scale, .reveal-slide');
  if (reveals.length) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.06, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(el => obs.observe(el));
  }

  // ─── CARD TILT EFFECT (subtle 3D) ───
  document.querySelectorAll('.card-glass, .feature-card, .step-card, .dl-card, .support-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = (y - centerY) / centerY * -3;
      const rotateY = (x - centerX) / centerX * 3;
      card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-3px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transition = 'transform 0.5s var(--ease-out-expo)';
      card.style.transform = '';
      setTimeout(() => { card.style.transition = ''; }, 500);
    });
    card.addEventListener('mouseenter', () => {
      card.style.transition = 'transform 0.1s ease-out';
    });
  });

  // ─── MOCKUP TIMELINE SIMULATOR ───
  const nodesContainer = document.getElementById('mockNodes');
  const ideEl = document.getElementById('mockIde');
  const idEl = document.getElementById('mockId');
  const fileEl = document.getElementById('mockFile');

  if (nodesContainer) {
    const states = [
      { id: 'CC-773412', ide: 'Cursor IDE [Active]', file: 'workspace/app.js' },
      { id: 'CC-773425', ide: 'Cursor IDE [Active]', file: 'workspace/app.js' },
      { id: 'CC-773456', ide: 'VS Code [Background]', file: 'workspace/app.js' },
      { id: 'CC-773489', ide: 'Zed Editor [Active]', file: 'workspace/app.js' },
    ];

    function renderNodes(activeIdx) {
      nodesContainer.innerHTML = '';
      states.forEach((s, i) => {
        const n = document.createElement('div');
        n.className = 'tl-node' + (i === activeIdx ? ' active' : '') + (i === states.length - 1 ? ' pulse' : '');
        n.textContent = s.id.slice(-4);
        n.title = s.id;
        n.addEventListener('click', () => { clearInterval(rot); setActive(i); });
        nodesContainer.appendChild(n);
      });
    }

    function setActive(i) {
      renderNodes(i);
      if (ideEl) ideEl.textContent = states[i].ide;
      if (idEl) idEl.textContent = states[i].id;
      if (fileEl) fileEl.textContent = states[i].file;
    }

    let cur = 0;
    renderNodes(0);
    const rot = setInterval(() => { cur = (cur + 1) % states.length; setActive(cur); }, 4000);
  }

  // ─── DOWNLOAD BUTTON RIPPLE EFFECT ───
  document.querySelectorAll('.btn-download, .btn-primary, .btn-secondary').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const ripple = document.createElement('span');
      ripple.style.cssText = 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.15);transform:scale(0);animation:ripple-anim 0.6s ease-out;pointer-events:none;';
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size/2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size/2) + 'px';
      this.appendChild(ripple);
      setTimeout(() => ripple.remove(), 600);
    });
  });

  // Inject ripple keyframes
  if (!document.getElementById('ripple-style')) {
    const style = document.createElement('style');
    style.id = 'ripple-style';
    style.textContent = '@keyframes ripple-anim { to { transform: scale(4); opacity: 0; } }';
    document.head.appendChild(style);
  }

  // ─── SMOOTH ANCHOR SCROLL ───
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (!href || href === '#' || href.length < 2) return;
      try {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (_) {}
    });
  });

  // ─── NAVBAR SCROLL EFFECT ───
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      const currentScroll = window.scrollY;
      if (currentScroll > 60) {
        navbar.style.boxShadow = '0 1px 20px rgba(0,0,0,0.3)';
        navbar.style.borderBottomColor = 'rgba(255,255,255,0.08)';
      } else {
        navbar.style.boxShadow = 'none';
        navbar.style.borderBottomColor = '';
      }
    }, { passive: true });
  }

  // ─── STAT COUNTER ANIMATION ───
  const statNumbers = document.querySelectorAll('.stat-number');
  if (statNumbers.length) {
    const statsObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const el = e.target;
          const target = el.getAttribute('data-count');
          const suffix = el.getAttribute('data-suffix') || '';
          const isStatic = el.getAttribute('data-static') === 'true';
          if (isStatic) { el.textContent = target; statsObs.unobserve(el); return; }
          const numTarget = parseInt(target);
          if (isNaN(numTarget)) { el.textContent = target; statsObs.unobserve(el); return; }
          const duration = 1600;
          const start = performance.now();
          function step(now) {
            const progress = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.floor(numTarget * ease) + suffix;
            if (progress < 1) requestAnimationFrame(step);
            else el.textContent = numTarget + suffix;
          }
          requestAnimationFrame(step);
          statsObs.unobserve(el);
        }
      });
    }, { threshold: 0.5 });
    statNumbers.forEach(el => statsObs.observe(el));
  }

  // Inject fadeInUp keyframes
  if (!document.getElementById('anim-style')) {
    const style = document.createElement('style');
    style.id = 'anim-style';
    style.textContent = '@keyframes fadeInUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }';
    document.head.appendChild(style);
  }

  // ─── COOKIE CONSENT BANNER ───
  const COOKIE_CONSENT_KEY = 'cc_cookie_consent';
  let cookieConsent = null;
  try { cookieConsent = localStorage.getItem(COOKIE_CONSENT_KEY); } catch (_) {}

  if (!cookieConsent) {
    const banner = document.createElement('div');
    banner.id = 'cookieConsentBanner';
    banner.innerHTML = `
      <style>
        #cookieConsentBanner {
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
          background: rgba(6, 8, 9, 0.95); backdrop-filter: blur(20px);
          border-top: 1px solid rgba(255,255,255,0.06);
          padding: 16px 24px; display: flex; align-items: center; justify-content: space-between;
          gap: 16px; flex-wrap: wrap; animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        #cookieConsentBanner .cc-text {
          font-size: 13px; color: #8a919e; line-height: 1.5; flex: 1; min-width: 200px;
        }
        #cookieConsentBanner .cc-text a { color: #6366f1; text-decoration: none; font-weight: 600; }
        #cookieConsentBanner .cc-text a:hover { text-decoration: underline; }
        #cookieConsentBanner .cc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        #cookieConsentBanner .cc-btn {
          padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.2s; font-family: 'Inter', sans-serif; border: none;
        }
        #cookieConsentBanner .cc-accept {
          background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff;
        }
        #cookieConsentBanner .cc-accept:hover { filter: brightness(1.1); transform: translateY(-1px); }
        #cookieConsentBanner .cc-reject {
          background: rgba(255,255,255,0.04); color: #8a919e; border: 1px solid rgba(255,255,255,0.07);
        }
        #cookieConsentBanner .cc-reject:hover { background: rgba(255,255,255,0.08); color: #f0f2f5; }
        #cookieConsentBanner .cc-manage {
          background: transparent; color: #5c6370; text-decoration: underline;
        }
        #cookieConsentBanner .cc-manage:hover { color: #8a919e; }
        @media (max-width: 600px) {
          #cookieConsentBanner { flex-direction: column; text-align: center; }
          #cookieConsentBanner .cc-actions { justify-content: center; }
        }
      </style>
      <div class="cc-text">
        We use cookies to improve your experience. By continuing, you agree to our
        <a href="cookie-policy.html">Cookie Policy</a>,
        <a href="privacy-policy.html">Privacy Policy</a>, and
        <a href="terms-and-conditions.html">Terms &amp; Conditions</a>.
      </div>
      <div class="cc-actions">
        <button class="cc-btn cc-accept" onclick="handleCookieConsent('all')">Accept All</button>
        <button class="cc-btn cc-reject" onclick="handleCookieConsent('essential')">Reject Non-Essential</button>
        <button class="cc-btn cc-manage" onclick="handleCookieConsent('manage')">Manage</button>
      </div>
    `;
    document.body.appendChild(banner);

    window.handleCookieConsent = function(preference) {
      try {
        localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify({
          preference: preference,
          timestamp: Date.now(),
          essential: true,
          analytics: preference === 'all',
          preferences: preference === 'all'
        }));
      } catch (_) {}
      banner.style.animation = 'slideUp 0.3s ease reverse forwards';
      setTimeout(() => banner.remove(), 300);
    };
  }

});
