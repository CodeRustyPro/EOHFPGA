/* =========================================
   Monte Carlo FPGA — Dashboard App
   State machine, ambient FX, chart lifecycle
   ========================================= */

import { fetchSimulationResults } from './data.js';
import { createPricePathsChart, destroyPricePathsChart } from './charts/price-paths.js';
import { createHistogramChart, destroyHistogramChart } from './charts/histogram.js';
import { createDrawdownChart, destroyDrawdownChart } from './charts/drawdown.js';
import { createPerformanceChart, destroyPerformanceChart } from './charts/performance.js';
import { fmtMs, fmtCurrency, fmtPercent, fmtNumber, animateValue, debounce, prefersReducedMotion } from './utils.js';

/* =========================================
   1. STATE MACHINE
   ========================================= */
const State = Object.freeze({ IDLE: 'idle', PROCESSING: 'processing', RESULTS: 'results' });
let currentState = State.IDLE;
let currentData = null;

const $ = (id) => document.getElementById(id);

const els = {
  idle:         $('dash-idle'),
  processing:   $('dash-processing'),
  results:      $('dashboard-main'),
  form:         $('sim-form'),
  ticker:       $('ticker-select'),
  runBtn:       $('run-btn'),
  rerunBtn:     $('rerun-btn'),
  resultTicker: $('result-ticker'),
  resultPrice:  $('result-price'),
  fpgaTime:     $('fpga-time'),
  cpuTime:      $('cpu-time'),
  metricsRow:   $('metrics-row'),
  warpCanvas:   $('warpCanvas'),
  ambientCanvas:$('ambientCanvas'),
  pathsSubtitle:$('paths-subtitle'),
};

function transitionTo(newState) {
  // Exit current state
  if (currentState === State.IDLE) els.idle.hidden = true;
  if (currentState === State.PROCESSING) {
    els.processing.hidden = true;
    stopWarp();
  }
  if (currentState === State.RESULTS) {
    destroyAllCharts();
    els.results.hidden = true;
  }

  currentState = newState;

  // Enter new state
  if (newState === State.IDLE) {
    els.idle.hidden = false;
  }
  if (newState === State.PROCESSING) {
    els.processing.hidden = false;
    startWarp();
  }
  if (newState === State.RESULTS) {
    els.results.hidden = false;
    renderDashboard(currentData);
  }
}

async function runSimulation() {
  const ticker = els.ticker.value;
  transitionTo(State.PROCESSING);

  try {
    const result = await fetchSimulationResults(ticker);
    currentData = result.simulation_results;
    transitionTo(State.RESULTS);
  } catch (err) {
    console.error('Simulation failed:', err);
    transitionTo(State.IDLE);
    showToast('Simulation failed. Check console for details.');
  }
}

/* =========================================
   2. RENDER DASHBOARD
   ========================================= */
function renderDashboard(data) {
  // Top bar
  els.resultTicker.textContent = data.ticker;
  els.resultPrice.textContent = fmtCurrency(data.start_price);
  els.fpgaTime.textContent = fmtMs(data.performance.fpga_time_ms);
  els.cpuTime.textContent = fmtMs(data.performance.cpu_time_ms);

  // Dynamic subtitle
  if (els.pathsSubtitle) {
    const numPaths = data.price_paths.length;
    const numDays = data.price_paths[0] ? data.price_paths[0].length : 0;
    els.pathsSubtitle.textContent = `${numPaths} sample paths \u00b7 ${numDays} steps`;
  }

  // Metrics
  renderMetrics(data);

  // Charts (staggered)
  requestAnimationFrame(() => {
    createPricePathsChart('#chart-price-paths', data);
    createHistogramChart('#chart-histogram', data);

    setTimeout(() => {
      createDrawdownChart('#chart-drawdown', data);
      createPerformanceChart('#chart-performance', data);
    }, prefersReducedMotion ? 0 : 150);
  });
}

function renderMetrics(data) {
  const perf = data.performance;
  const risk = data.risk_statistics;

  const metrics = [
    { val: perf.fpga_time_ms, fmt: v => fmtMs(Math.round(v)), label: 'FPGA Time', accent: true },
    { val: perf.cpu_time_ms, fmt: v => fmtMs(Math.round(v)), label: 'CPU Time', accent: false },
    { val: perf.speed_improvement_x, fmt: v => v.toFixed(1) + 'x', label: 'Speedup', accent: true },
    { val: risk.value_at_risk_95, fmt: v => fmtCurrency(v), label: 'VaR 95%', accent: false },
    { val: risk.probability_of_profit, fmt: v => fmtPercent(v), label: 'Profit Prob.', accent: false },
  ];

  els.metricsRow.innerHTML = metrics.map((m, i) => `
    <div class="dash-metric ${m.accent ? 'dash-metric-accent' : ''}" style="animation-delay:${i * 0.05}s">
      <span class="dash-metric-val" data-target="${m.val}" data-idx="${i}">\u2013</span>
      <span class="dash-metric-label">${m.label}</span>
    </div>
  `).join('');

  // Animate counters
  requestAnimationFrame(() => {
    els.metricsRow.querySelectorAll('.dash-metric-val').forEach(el => {
      const idx = parseInt(el.dataset.idx);
      const m = metrics[idx];
      animateValue(el, 0, m.val, 1200, m.fmt);
    });
  });
}

function destroyAllCharts() {
  destroyPricePathsChart('#chart-price-paths');
  destroyHistogramChart('#chart-histogram');
  destroyDrawdownChart('#chart-drawdown');
  destroyPerformanceChart('#chart-performance');
}

/* =========================================
   3. TOAST NOTIFICATION
   ========================================= */
function showToast(message) {
  // Remove existing
  const existing = document.querySelector('.dash-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'dash-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('visible'));

  // Auto-dismiss
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

/* =========================================
   4. WARP SPEED EFFECT (Processing State)
   ========================================= */
let warpRunning = false;
let warpRafId = null;

function startWarp() {
  const canvas = els.warpCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const maxR = Math.hypot(cx, cy);

  const streaks = [];
  for (let i = 0; i < 120; i++) {
    const angle = Math.random() * Math.PI * 2;
    streaks.push({
      angle,
      r: Math.random() * maxR * 0.3,
      speed: 2 + Math.random() * 6,
      length: 20 + Math.random() * 80,
      opacity: 0.1 + Math.random() * 0.4,
      width: 0.5 + Math.random() * 1.5,
    });
  }

  warpRunning = true;

  function draw() {
    if (!warpRunning) return;
    ctx.fillStyle = 'rgba(6, 6, 12, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const s of streaks) {
      s.r += s.speed;
      if (s.r > maxR) {
        s.r = Math.random() * maxR * 0.1;
        s.angle = Math.random() * Math.PI * 2;
      }

      const x1 = cx + Math.cos(s.angle) * s.r;
      const y1 = cy + Math.sin(s.angle) * s.r;
      const x2 = cx + Math.cos(s.angle) * Math.max(0, s.r - s.length);
      const y2 = cy + Math.sin(s.angle) * Math.max(0, s.r - s.length);

      const progress = s.r / maxR;
      ctx.strokeStyle = `rgba(245, 158, 11, ${s.opacity * (0.3 + progress * 0.7)})`;
      ctx.lineWidth = s.width * (0.5 + progress);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    warpRafId = requestAnimationFrame(draw);
  }

  ctx.fillStyle = '#06060c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  draw();
}

function stopWarp() {
  warpRunning = false;
  if (warpRafId) cancelAnimationFrame(warpRafId);
}

/* =========================================
   5. AMBIENT PARTICLE CANVAS (Background)
   ========================================= */
function initAmbient() {
  const canvas = els.ambientCanvas;
  if (!canvas || prefersReducedMotion) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();

  const particles = [];
  const count = 50;
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.15,
      r: 0.5 + Math.random() * 1.5,
      opacity: 0.1 + Math.random() * 0.25,
    });
  }

  let running = true;

  function draw() {
    if (!running) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) p.y = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245, 158, 11, ${p.opacity})`;
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  draw();
  window.addEventListener('resize', debounce(resize, 200));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      running = false;
    } else {
      running = true;
      requestAnimationFrame(draw);
    }
  });
}

/* =========================================
   6. RESIZE HANDLER
   ========================================= */
const handleResize = debounce(() => {
  if (currentState === State.RESULTS && currentData) {
    destroyAllCharts();
    requestAnimationFrame(() => {
      createPricePathsChart('#chart-price-paths', currentData);
      createHistogramChart('#chart-histogram', currentData);
      createDrawdownChart('#chart-drawdown', currentData);
      createPerformanceChart('#chart-performance', currentData);
    });
  }
}, 300);

/* =========================================
   7. EVENT LISTENERS
   ========================================= */
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  runSimulation();
});

els.rerunBtn.addEventListener('click', () => {
  transitionTo(State.IDLE);
});

window.addEventListener('resize', handleResize, { passive: true });

els.ticker.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runSimulation();
  }
});

/* =========================================
   8. BOOT
   ========================================= */
initAmbient();
transitionTo(State.IDLE);
