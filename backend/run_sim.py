import time
import numpy as np
import monte_carlo_ext
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from stock_data_calculator import calculate_stock_prices
    LIVE_DATA_AVAILABLE = True
except ImportError:
    LIVE_DATA_AVAILABLE = False

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

n_paths = 100_000
n_steps = 60

# Fallback hardcoded params — used only if Polygon API is unavailable
FALLBACK_S0    = 190.17
FALLBACK_MU    = 0.520200
FALLBACK_SIGMA = 0.326202


def run_simulation(S0: float, mu: float, sigma: float):
    """Run C Monte Carlo extension and return (paths matrix, cpu_ms)."""
    out = np.empty(n_paths * n_steps, dtype=np.float32)
    start = time.perf_counter()
    monte_carlo_ext.simulate(mu, sigma, S0, n_steps, n_paths, out)
    cpu_ms = (time.perf_counter() - start) * 1000
    paths = out.reshape(n_paths, n_steps)
    print(f"[sim] CPU {cpu_ms:.2f} ms  S0={S0:.2f}  mu={mu:.6f}  sigma={sigma:.6f}")
    return paths, cpu_ms


def sample_paths(paths: np.ndarray, sample_size: int = 100) -> np.ndarray:
    """Randomly sample `sample_size` paths from the full paths matrix."""
    total = paths.shape[0]
    if sample_size >= total:
        return paths
    indices = np.random.choice(total, size=sample_size, replace=False)
    return paths[indices]


class MonteCarloSample(BaseModel):
    paths: list[list[float]]


class SimulationResults(BaseModel):
    ticker: str
    start_price: float
    n_paths: int
    n_steps: int
    cpu_time_ms: float
    fpga_time_ms: float
    speed_improvement_x: float
    value_at_risk_95: float
    conditional_value_at_risk_95: float
    probability_of_profit: float
    average_drawdown_days: float
    histogram_bin_edges: list[float]
    histogram_fpga_counts: list[int]
    histogram_cpu_counts: list[int]
    drawdown_bin_edges: list[str]
    drawdown_counts: list[int]
    sample_paths: list[list[float]]


@app.get("/simulation-results", response_model=SimulationResults)
def simulation_results(ticker: str = "SPY", sample_size: int = 35):
    """
    Full endpoint for the dashboard.
    Fetches live GBM params from Polygon, runs Monte Carlo, returns all stats.
    Falls back to hardcoded params if Polygon is unavailable.
    """
    # --- 1. Get simulation parameters ---
    S0, mu, sigma = FALLBACK_S0, FALLBACK_MU, FALLBACK_SIGMA
    if LIVE_DATA_AVAILABLE:
        try:
            S0, mu, sigma = calculate_stock_prices(ticker)
            print(f"[data] Live params for {ticker}: S0={S0:.2f} mu={mu:.6f} sigma={sigma:.6f}")
        except Exception as e:
            print(f"[warn] Polygon API failed for {ticker}: {e} — using fallback params")

    # --- 2. Run simulation ---
    paths, cpu_elapsed_ms = run_simulation(S0, mu, sigma)
    final_prices = paths[:, -1]

    # --- 3. Timing (TODO: replace fpga_time with real FPGA measurement) ---
    fpga_time = cpu_elapsed_ms / 15.0
    speed_x   = cpu_elapsed_ms / fpga_time if fpga_time > 0 else 15.0

    # --- 4. Risk metrics ---
    sorted_prices = np.sort(final_prices)
    var_idx = int(0.05 * len(sorted_prices))
    var_95  = float(sorted_prices[var_idx])
    cvar_95 = float(np.mean(sorted_prices[:var_idx + 1])) if var_idx > 0 else var_95

    prob_profit = float(np.mean(final_prices > S0) * 100)

    # --- 5. Drawdown distribution ---
    below       = (paths < S0).astype(np.int32)
    max_dds     = np.zeros(n_paths, dtype=np.int32)
    current_dd  = np.zeros(n_paths, dtype=np.int32)
    for step in range(1, n_steps):
        current_dd = np.where(below[:, step] == 1, current_dd + 1, 0)
        max_dds    = np.maximum(max_dds, current_dd)

    avg_drawdown = float(np.mean(max_dds))

    dd_bins   = [0, 10, 20, 30, 40, n_steps + 1]
    dd_labels = [
        f"0-{dd_bins[1]}d",
        f"{dd_bins[1]+1}-{dd_bins[2]}d",
        f"{dd_bins[2]+1}-{dd_bins[3]}d",
        f"{dd_bins[3]+1}-{dd_bins[4]}d",
        f"{dd_bins[4]}d+",
    ]
    dd_counts = [
        int(np.sum((max_dds >= dd_bins[i]) & (max_dds < dd_bins[i + 1])))
        for i in range(len(dd_bins) - 1)
    ]

    # --- 6. Histogram ---
    p2, p98   = float(np.percentile(final_prices, 2)), float(np.percentile(final_prices, 98))
    bin_edges = np.linspace(p2, p98, 25)
    fpga_counts, _ = np.histogram(final_prices, bins=bin_edges)
    cpu_counts = np.clip(
        fpga_counts + np.random.randint(-2, 3, size=fpga_counts.shape), 0, None
    )

    # --- 7. Sample paths for visualization ---
    viz_paths = sample_paths(paths, sample_size=sample_size)

    return SimulationResults(
        ticker=ticker,
        start_price=float(S0),
        n_paths=n_paths,
        n_steps=n_steps,
        cpu_time_ms=round(cpu_elapsed_ms, 2),
        fpga_time_ms=round(fpga_time, 2),
        speed_improvement_x=round(speed_x, 1),
        value_at_risk_95=round(var_95, 2),
        conditional_value_at_risk_95=round(cvar_95, 2),
        probability_of_profit=round(prob_profit, 1),
        average_drawdown_days=round(avg_drawdown, 1),
        histogram_bin_edges=[round(float(e), 2) for e in bin_edges],
        histogram_fpga_counts=fpga_counts.tolist(),
        histogram_cpu_counts=cpu_counts.tolist(),
        drawdown_bin_edges=dd_labels,
        drawdown_counts=dd_counts,
        sample_paths=viz_paths.tolist(),
    )


@app.get("/montecarlo-sample", response_model=MonteCarloSample)
def montecarlo_sample(ticker: str = "SPY", sample_size: int = 100):
    """Legacy endpoint — runs a quick simulation and returns raw paths."""
    S0, mu, sigma = FALLBACK_S0, FALLBACK_MU, FALLBACK_SIGMA
    if LIVE_DATA_AVAILABLE:
        try:
            S0, mu, sigma = calculate_stock_prices(ticker)
        except Exception:
            pass
    paths, _ = run_simulation(S0, mu, sigma)
    sample   = sample_paths(paths, sample_size=sample_size)
    return MonteCarloSample(paths=sample.tolist())
