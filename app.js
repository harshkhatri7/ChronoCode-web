// ChronoCode Landing Page Interactive Controller

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Vector Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // ─────────────────────────────────────────────
  // 1. AMBIENT MOUSE TRAILING ORB
  // ─────────────────────────────────────────────
  const orb = document.getElementById('ambientOrb');
  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let orbX = mouseX;
  let orbY = mouseY;

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  // Smooth lerp animation for the ambient orb
  function animateOrb() {
    orbX += (mouseX - orbX) * 0.08;
    orbY += (mouseY - orbY) * 0.08;
    if (orb) {
      orb.style.left = `${orbX}px`;
      orb.style.top = `${orbY}px`;
    }
    requestAnimationFrame(animateOrb);
  }
  animateOrb();

  // ─────────────────────────────────────────────
  // 2. SCROLL TRIGGER ANIMATIONS (IntersectionObserver)
  // ─────────────────────────────────────────────
  const scrollReveals = document.querySelectorAll('.scroll-reveal');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      }
    });
  }, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  });

  scrollReveals.forEach((el) => {
    revealObserver.observe(el);
  });

  // ─────────────────────────────────────────────
  // 3. INTERACTIVE TIMELINE AND CODE SIMULATOR
  // ─────────────────────────────────────────────
  const timelineNodesContainer = document.getElementById('mockupTimelineNodes');
  const activeIdeEl = document.getElementById('mockupActiveIde');
  const snapshotIdEl = document.getElementById('mockupSnapshotId');
  const fileEl = document.getElementById('mockupFile');
  const codeContentEl = document.querySelector('.editor-content code');

  const SIMULATION_STATES = [
    {
      id: 'CC-773412',
      time: '14:22:15',
      file: 'workspace/app.js',
      ide: 'Cursor IDE [Active]',
      code: `<span class="keyword">const</span> express = require(<span class="string">'express'</span>);\n<span class="keyword">const</span> app = express();\n\n<span class="comment">// Init server...</span>\n<span class="function">app.listen</span>(<span class="number">3000</span>);`
    },
    {
      id: 'CC-773425',
      time: '14:22:45',
      file: 'workspace/app.js',
      ide: 'Cursor IDE [Active]',
      code: `<span class="keyword">const</span> express = require(<span class="string">'express'</span>);\n<span class="keyword">const</span> app = express();\n\n<span class="comment">// ChronoCode tracks this live...</span>\n<span class="function">app.get</span>(<span class="string">'/api'</span>, (req, res) => {\n<span class="addition">+  res.json({ status: 'ok' });</span>\n});`
    },
    {
      id: 'CC-773456',
      time: '14:23:20',
      file: 'workspace/app.js',
      ide: 'VS Code [Background]',
      code: `<span class="keyword">const</span> express = require(<span class="string">'express'</span>);\n<span class="keyword">const</span> app = express();\n\n<span class="comment">// ChronoCode tracks this live...</span>\n<span class="function">app.get</span>(<span class="string">'/api'</span>, (req, res) => {\n  <span class="keyword">const</span> time = <span class="keyword">new</span> <span class="class">Date</span>();\n<span class="addition">+  res.json({ time: time.toISOString() });</span>\n});`
    },
    {
      id: 'CC-773489',
      time: '14:24:10',
      file: 'workspace/app.js',
      ide: 'Zed Editor [Active]',
      code: `<span class="keyword">const</span> express = require(<span class="string">'express'</span>);\n<span class="keyword">const</span> app = express();\n\n<span class="comment">// Zed editor changes saved</span>\n<span class="function">app.get</span>(<span class="string">'/health'</span>, (req, res) => {\n<span class="addition">+  res.send('healthy');</span>\n});`
    }
  ];

  // Initialize nodes in the timeline
  function initSimulationTimeline() {
    if (!timelineNodesContainer) return;
    timelineNodesContainer.innerHTML = '';

    SIMULATION_STATES.forEach((state, index) => {
      const node = document.createElement('div');
      node.className = `timeline-node-mock ${index === 0 ? 'active' : ''} ${index === SIMULATION_STATES.length - 1 ? 'pulse' : ''}`;
      node.innerText = state.id.slice(-4);
      node.title = `Snapshot at ${state.time}`;

      node.addEventListener('click', () => {
        clearInterval(simulationInterval);
        selectSimulationIndex(index);
      });

      timelineNodesContainer.appendChild(node);
    });

    selectSimulationIndex(0);
  }

  function selectSimulationIndex(index) {
    const nodes = document.querySelectorAll('.timeline-node-mock');
    nodes.forEach((n, idx) => {
      if (idx === index) {
        n.classList.add('active');
      } else {
        n.classList.remove('active');
      }
    });

    const state = SIMULATION_STATES[index];
    if (state) {
      if (activeIdeEl) activeIdeEl.innerText = state.ide;
      if (snapshotIdEl) snapshotIdEl.innerText = state.id;
      if (fileEl) fileEl.innerText = state.file;
      if (codeContentEl) codeContentEl.innerHTML = state.code;
    }
  }

  let currentSimIndex = 0;
  initSimulationTimeline();

  // Rotate simulation state every 4.5 seconds
  const simulationInterval = setInterval(() => {
    currentSimIndex = (currentSimIndex + 1) % SIMULATION_STATES.length;
    selectSimulationIndex(currentSimIndex);
  }, 4500);
});
