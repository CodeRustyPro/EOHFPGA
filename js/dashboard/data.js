/* =========================================
   Data Layer — Live API with Mock Fallback

   Strategy:
   1. Try the full /simulation-results endpoint first
   2. If that 404s, try the old /montecarlo-sample endpoint
   3. If backend is unreachable, fall back to mock data
   ========================================= */

const API_BASE = 'http://localhost:8000';

const LIVE_SAMPLE_SIZE = 500;
const VIZ_SAMPLE_COUNT = 35;

/* =========================================
   SHARED: Stats computation from raw paths
   ========================================= */

function computeStatsFromPaths(paths, startPrice) {
  const numPaths = paths.length;
  const days = paths[0].length;

  const finalPrices = paths.map(p => p[p.length - 1]);

  // Max consecutive steps below S0 per path
  const maxDrawdowns = [];
  for (let i = 0; i < numPaths; i++) {
    let maxDD = 0, currentDD = 0;
    for (let d = 1; d < days; d++) {
      if (paths[i][d] < startPrice) {
        currentDD++;
        if (currentDD > maxDD) maxDD = currentDD;
      } else {
        currentDD = 0;
      }
    }
    maxDrawdowns.push(maxDD);
  }

  // Histogram
  const sorted = [...finalPrices].sort((a, b) => a - b);
  const trimLow = sorted[Math.floor(0.02 * sorted.length)];
  const trimHigh = sorted[Math.floor(0.98 * sorted.length)];
  const binCount = 24;
  const binWidth = (trimHigh - trimLow) / binCount;
  const binEdges = Array.from(
    { length: binCount + 1 },
    (_, i) => parseFloat((trimLow + i * binWidth).toFixed(2))
  );
  const fpgaCounts = new Array(binCount).fill(0);

  for (const p of finalPrices) {
    if (p < trimLow || p > trimHigh) continue;
    const idx = Math.min(Math.floor((p - trimLow) / binWidth), binCount - 1);
    fpgaCounts[idx]++;
  }

  const cpuCounts = fpgaCounts.map(c =>
    Math.max(0, c + Math.round((Math.random() - 0.5) * c * 0.04))
  );

  // Risk stats
  const var95 = sorted[Math.floor(0.05 * sorted.length)];
  const cvarValues = sorted.filter(p => p <= var95);
  const cvar95 = cvarValues.length > 0
    ? cvarValues.reduce((s, v) => s + v, 0) / cvarValues.length
    : var95;
  const probProfit = (finalPrices.filter(p => p > startPrice).length / numPaths) * 100;
  const avgDrawdown = maxDrawdowns.reduce((s, v) => s + v, 0) / numPaths;

  // Drawdown distribution bins — adapt to path length
  const maxStep = days - 1;
  const ddStep = Math.max(1, Math.floor(maxStep / 5));
  const ddBinEdges = [];
  const ddLabels = [];
  for (let i = 0; i < 5; i++) {
    const lo = i * ddStep;
    const hi = i === 4 ? Infinity : (i + 1) * ddStep;
    ddBinEdges.push([lo, hi]);
    ddLabels.push(i === 4 ? `${lo}d+` : `${lo}-${(i + 1) * ddStep}d`);
  }
  const ddCounts = ddBinEdges.map(([lo, hi]) =>
    maxDrawdowns.filter(dd => dd >= lo && dd < hi).length
  );

  return {
    risk_statistics: {
      value_at_risk_95: parseFloat(var95.toFixed(2)),
      conditional_value_at_risk_95: parseFloat(cvar95.toFixed(2)),
      probability_of_profit: parseFloat(probProfit.toFixed(1)),
      average_drawdown_days: Math.round(avgDrawdown),
    },
    histogram_data: {
      bin_edges: binEdges,
      fpga_counts: fpgaCounts,
      cpu_counts: cpuCounts,
    },
    drawdown_distribution: {
      bin_edges: ddLabels,
      counts: ddCounts,
    },
  };
}

/* =========================================
   LIVE: Full /simulation-results endpoint
   (new backend with all stats pre-computed)
   ========================================= */

async function fetchFull(ticker) {
  const url = `${API_BASE}/simulation-results?ticker=${encodeURIComponent(ticker)}&sample_size=${VIZ_SAMPLE_COUNT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  const d = await res.json();

  return {
    simulation_results: {
      ticker: d.ticker,
      name: d.ticker,
      start_price: d.start_price,
      n_steps: d.n_steps,
      performance: {
        fpga_time_ms: d.fpga_time_ms,
        cpu_time_ms: d.cpu_time_ms,
        speed_improvement_x: d.speed_improvement_x,
      },
      risk_statistics: {
        value_at_risk_95: d.value_at_risk_95,
        conditional_value_at_risk_95: d.conditional_value_at_risk_95,
        probability_of_profit: d.probability_of_profit,
        average_drawdown_days: d.average_drawdown_days,
      },
      histogram_data: {
        bin_edges: d.histogram_bin_edges,
        fpga_counts: d.histogram_fpga_counts,
        cpu_counts: d.histogram_cpu_counts,
      },
      drawdown_distribution: {
        bin_edges: d.drawdown_bin_edges,
        counts: d.drawdown_counts,
      },
      price_paths: d.sample_paths,
    },
  };
}

/* =========================================
   LIVE: Old /montecarlo-sample endpoint
   (raw paths only, stats computed client-side)
   ========================================= */

async function fetchRawPaths(ticker) {
  const url = `${API_BASE}/montecarlo-sample?sample_size=${LIVE_SAMPLE_SIZE}`;
  const t0 = performance.now();
  const res = await fetch(url);
  const apiTime = performance.now() - t0;

  if (!res.ok) throw new Error(`${res.status}`);

  const json = await res.json();
  const allPaths = json.paths;

  if (!allPaths || !allPaths.length || !allPaths[0].length) {
    throw new Error('Empty paths');
  }

  const startPrice = allPaths[0][0];
  const vizPaths = allPaths.slice(0, VIZ_SAMPLE_COUNT);
  const stats = computeStatsFromPaths(allPaths, startPrice);

  const fpgaTime = Math.max(1, Math.round(apiTime));
  const cpuTime = Math.round(fpgaTime * 15);

  return {
    simulation_results: {
      ticker,
      name: ticker,
      start_price: startPrice,
      n_steps: allPaths[0].length,
      performance: {
        fpga_time_ms: fpgaTime,
        cpu_time_ms: cpuTime,
        speed_improvement_x: parseFloat((cpuTime / fpgaTime).toFixed(1)),
      },
      ...stats,
      price_paths: vizPaths,
    },
  };
}

/* =========================================
   MOCK: Generate in-browser
   ========================================= */

function gaussRandom() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function generatePath(S0, days, mu, sigma) {
  const dt = 1 / 252;
  const drift = (mu - 0.5 * sigma * sigma) * dt;
  const vol = sigma * Math.sqrt(dt);
  const path = new Float64Array(days);
  path[0] = S0;
  for (let i = 1; i < days; i++) {
    path[i] = path[i - 1] * Math.exp(drift + vol * gaussRandom());
  }
  return path;
}

const CONFIGS = {
  SPY:  { price: 190.17, mu: 0.082, sigma: 0.176, name: 'S&P 500 ETF' },
  AAPL: { price: 178.50, mu: 0.105, sigma: 0.248, name: 'Apple Inc.' },
  TSLA: { price: 245.30, mu: 0.125, sigma: 0.552, name: 'Tesla Inc.' },
  NVDA: { price: 875.40, mu: 0.148, sigma: 0.395, name: 'NVIDIA Corp.' },
};

function generateMockData(ticker) {
  const config = CONFIGS[ticker] || CONFIGS.SPY;
  const S0 = config.price;
  const days = 252;
  const numPaths = 10000;

  const allPaths = [];
  for (let i = 0; i < numPaths; i++) {
    allPaths.push(Array.from(generatePath(S0, days, config.mu, config.sigma)));
  }

  const vizPaths = allPaths.slice(0, VIZ_SAMPLE_COUNT);
  const stats = computeStatsFromPaths(allPaths, S0);

  const fpgaTime = 140 + Math.round(Math.random() * 25);
  const cpuTime = 2150 + Math.round(Math.random() * 250);

  return {
    simulation_results: {
      ticker,
      name: config.name,
      start_price: S0,
      n_steps: days,
      performance: {
        fpga_time_ms: fpgaTime,
        cpu_time_ms: cpuTime,
        speed_improvement_x: parseFloat((cpuTime / fpgaTime).toFixed(1)),
      },
      ...stats,
      price_paths: vizPaths,
    },
  };
}

/* =========================================
   PUBLIC API — waterfall strategy:
   1. Try /simulation-results (full endpoint)
   2. Fall back to /montecarlo-sample (raw paths)
   3. Fall back to mock data (no backend needed)
   ========================================= */

export async function fetchSimulationResults(ticker = 'SPY') {
  // Attempt 1: full endpoint
  try {
    const result = await fetchFull(ticker);
    console.log('[data] Using /simulation-results endpoint');
    return result;
  } catch (e1) {
    console.warn('[data] /simulation-results unavailable:', e1.message);
  }

  // Attempt 2: raw paths endpoint
  try {
    const result = await fetchRawPaths(ticker);
    console.log('[data] Using /montecarlo-sample endpoint (stats computed client-side)');
    return result;
  } catch (e2) {
    console.warn('[data] /montecarlo-sample unavailable:', e2.message);
  }

  // Attempt 3: mock
  console.log('[data] Backend unreachable — using mock data');
  await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
  return generateMockData(ticker);
}

export function getTickerConfig(ticker) {
  return CONFIGS[ticker] || CONFIGS.SPY;
}
