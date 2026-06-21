// ChronoCode — Interactive Controller
document.addEventListener('DOMContentLoaded', () => {

  // ─── AMBIENT ORB MOUSE TRACKING ───
  const orb = document.getElementById('orb');
  if (orb) {
    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let ox = mx, oy = my;
    document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
    (function animOrb() {
      ox += (mx - ox) * 0.06;
      oy += (my - oy) * 0.06;
      orb.style.left = ox + 'px';
      orb.style.top = oy + 'px';
      requestAnimationFrame(animOrb);
    })();
  }

  // ─── SCROLL REVEAL (IntersectionObserver) ───
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    reveals.forEach(el => obs.observe(el));
  }

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
  document.querySelectorAll('.btn-download').forEach(btn => {
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
      const target = document.querySelector(a.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

});
