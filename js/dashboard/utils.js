/* =========================================
   Shared Utilities — Dashboard
   ========================================= */

const d3 = window.d3;

export const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function dur(ms) {
  return prefersReducedMotion ? 0 : ms;
}

export function clamp(min, val, max) {
  return Math.min(max, Math.max(min, val));
}

/* ---- Number Formatting ---- */
export function fmtMs(ms) {
  return ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : ms + 'ms';
}

export function fmtCurrency(val) {
  return '$' + val.toFixed(2);
}

export function fmtPercent(val) {
  return val.toFixed(1) + '%';
}

export function fmtNumber(n) {
  return n.toLocaleString('en-US');
}

export function fmtCompact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

/* ---- Responsive SVG Helper ---- */
export function createChart(containerSelector, margin) {
  const container = d3.select(containerSelector);
  const node = container.node();
  if (!node) return null;

  // Clear previous
  container.selectAll('svg').remove();

  const rect = node.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height || 260;

  const svg = container.append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  return {
    svg,
    g,
    width,
    height,
    innerWidth: width - margin.left - margin.right,
    innerHeight: height - margin.top - margin.bottom,
  };
}

/* ---- Animated Counter ---- */
export function animateValue(element, from, to, duration, formatter) {
  if (prefersReducedMotion) {
    element.textContent = formatter(to);
    return;
  }

  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const progress = clamp(0, elapsed / duration, 1);
    // easeOutExpo
    const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const current = from + (to - from) * eased;
    element.textContent = formatter(current);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/* ---- Debounce ---- */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
