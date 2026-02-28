from datetime import datetime, timedelta
import pytz
import numpy as np
from polygon import RESTClient

# ==============================
# CONFIG
# ==============================
API_KEY = "MHCK7ttpURdQqzvroYuDoiFgkJTI2A2F"

CT = pytz.timezone("America/Chicago")

def last_open_trading_day_ct(max_back_days=10):
    """
    Returns a datetime.date for the most recent day (up to max_back_days back)
    that actually has trades for the given ticker, by probing once per day.
    """
    today_ct = datetime.now(CT).date()

    for i in range(max_back_days):
        day = today_ct - timedelta(days=i)

        # Probe a mid‑session 10‑minute window (e.g., 13:20–13:30 CT)
        start_dt = CT.localize(datetime.combine(day, datetime.min.time())).replace(
            hour=13, minute=20, second=0, microsecond=0
        )
        end_dt = start_dt + timedelta(minutes=10)

        params = {
            "timestamp.gte": start_dt.isoformat(),
            "timestamp.lt": end_dt.isoformat(),
            "order": "asc",
            "sort": "timestamp",
        }

        # Use a very small probe limit
        try:
            from polygon import RESTClient  # ensure client in scope
        except ImportError:
            pass

        # This function will be called from main with an existing client;
        # we'll move the probing into fetch_trades_last_10_minutes().
        return day

    raise RuntimeError("No recent trading day with trades found")

def last_10_minute_window_last_open_day_ct(client, ticker, max_back_days=10):
    """
    Find the last open trading day (within max_back_days),
    then return a 10‑minute window at the **end of regular session**
    (14:50–15:00 CT) for that day.
    """
    today_ct = datetime.now(CT).date()

    for i in range(max_back_days):
        day = today_ct - timedelta(days=i)

        # 14:50–15:00 CT is inside RTH (8:30–15:00 CT)
        end = CT.localize(datetime.combine(day, datetime.min.time())).replace(
            hour=15, minute=0, second=0, microsecond=0
        )
        start = end - timedelta(minutes=10)

        params = {
            "timestamp.gte": start.isoformat(),
            "timestamp.lt": end.isoformat(),
            "order": "asc",
            "sort": "timestamp",
        }

        # Probe for a few trades to see if this day is open
        trades_iter = client.list_trades(ticker, params=params, limit=200)
        try:
            first = next(trades_iter)
            # If we get here, there was at least one trade that day
            return start, end
        except StopIteration:
            # No trades in this slice; try previous day
            continue

    raise RuntimeError("No recent trading day with trades found in last "
                       f"{max_back_days} days")


def fetch_trades_last_10_minutes_last_open_day(client, ticker,
                                               max_back_days=10,
                                               max_trades=2000):
    """
    Get up to `max_trades` trades for the last 10 minutes of the last open day.
    Window is 14:50–15:00 CT on that day.
    """
    start_dt, end_dt = last_10_minute_window_last_open_day_ct(
        client, ticker, max_back_days=max_back_days
    )

    params = {
        "timestamp.gte": start_dt.isoformat(),
        "timestamp.lt": end_dt.isoformat(),
        "order": "asc",
        "sort": "timestamp",
    }

    trades = []
    for t in client.list_trades(ticker, params=params, limit=1000):
        trades.append(t)
        if len(trades) >= max_trades:
            break

    return start_dt, end_dt, trades

def compute_net_flow(trades):
    """
    Simple net flow over a window of trades:
    sum( size_i * (price_i - price_{i-1}) ).
    """
    if len(trades) < 2:
        return 0.0

    prices = np.array([t.price for t in trades], dtype=np.float64)
    sizes  = np.array([t.size  for t in trades], dtype=np.float64)

    dp = np.diff(prices)
    v  = sizes[1:]  # align with dp

    net_flow = float((v * dp).sum())
    return net_flow


def adjust_mu_with_net_flow(mu, sigma, trades,
                            flow_scale=0.0001,
                            max_shift_sigmas=0.5):
    """
    Use trade-level net flow to nudge drift mu up/down.
    """
    net_flow = compute_net_flow(trades)

    # map raw net_flow to [-1, 1]
    sentiment = float(np.tanh(flow_scale * net_flow))

    # cap adjustment at +/- max_shift_sigmas * sigma
    delta_mu = float(
        np.clip(sentiment, -max_shift_sigmas, max_shift_sigmas) * sigma
    )

    return mu + delta_mu, net_flow, sentiment, delta_mu

# ==============================
# TIME HELPERS
# ==============================
def dt_to_unix_ms(dt):
    if dt.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    return int(dt.timestamp() * 1000)


def last_60_minutes_market_clamped_ct(client, ticker, now=None, max_back_days=10):
    """
    Returns (start_dt, end_dt) for the most recent day (up to max_back_days back)
    where the clamped 60‑minute window has enough intraday minute data.
    """
    for i in range(max_back_days):
        if now is None:
            candidate_now = datetime.now(CT) - timedelta(days=i) - timedelta(minutes=15)
        else:
            candidate_now = now - timedelta(days=i)
            if candidate_now.tzinfo is None:
                candidate_now = CT.localize(candidate_now)

        open_dt  = candidate_now.replace(hour=8, minute=30, second=0, microsecond=0)
        close_dt = candidate_now.replace(hour=15, minute=0, second=0, microsecond=0)

        end = min(max(candidate_now, open_dt), close_dt)
        start = end - timedelta(minutes=60)
        if start < open_dt:
            start = open_dt

        # quick probe to see if this day has data
        aggs = fetch_raw_second_aggs(client, ticker, start, end)
        if len(aggs) >= 10:
            # found a good day; just return the window
            return start, end

    raise RuntimeError("No recent day with enough intraday data found")


# ==============================
# DATA FETCH
# ==============================
def fetch_raw_second_aggs(client, ticker, start_dt, end_dt):
    return client.get_aggs(
        ticker,
        multiplier=1,
        timespan="second",
        from_=dt_to_unix_ms(start_dt),
        to=dt_to_unix_ms(end_dt),
        limit=50000,
    )


# ==============================
# GBM PARAMETER ESTIMATION
# ==============================
def estimate_mu_sigma_trade_seconds(raw_aggs):
    raw_aggs = sorted(raw_aggs, key=lambda a: a.timestamp)

    closes = np.array([a.close for a in raw_aggs], dtype=np.float64)
    log_returns = np.diff(np.log(closes))

    mu_sample = log_returns.mean()
    sigma_sample = log_returns.std(ddof=1)

    return float(mu_sample), float(sigma_sample)


def convert_to_per_second(raw_aggs, mu_sample, sigma_sample):
    t0 = raw_aggs[0].timestamp / 1000.0
    t1 = raw_aggs[-1].timestamp / 1000.0

    T = max(t1 - t0, 1.0)               # elapsed seconds
    N = max(len(raw_aggs) - 1, 1)       # number of returns

    mu_per_sec = mu_sample * (N / T)
    sigma_per_sec = sigma_sample * np.sqrt(N / T)

    return float(mu_per_sec), float(sigma_per_sec)


# ==============================
# MAIN
# ==============================
def calculate_stock_prices(TICKER):
    client = RESTClient(API_KEY)

    start_dt, end_dt = last_60_minutes_market_clamped_ct(client, TICKER)
    print("Using window:", start_dt, "→", end_dt)

    raw_aggs = fetch_raw_second_aggs(client, TICKER, start_dt, end_dt)
    print("Raw trade-seconds:", len(raw_aggs))

    if len(raw_aggs) < 10:
        raise RuntimeError("Not enough data — window likely illiquid")

    S0 = raw_aggs[-1].close

    mu_sample, sigma_sample = estimate_mu_sigma_trade_seconds(raw_aggs)
    mu, sigma = convert_to_per_second(raw_aggs, mu_sample, sigma_sample)
    
    print("\n=== GBM PARAMETERS (PER SECOND) ===")
    print("S0:", S0)
    print("mu:", mu)
    print("sigma:", sigma)

    implied_1min_std = S0 * sigma * np.sqrt(60)
    print("\nImplied 1-minute std ($):", implied_1min_std)

    # 3) Trades last 10 min (15-min delayed) and net flow
    t_start, t_end, trades = fetch_trades_last_10_minutes_last_open_day(client, TICKER)
    print(f"\nTrades window (last open day): {t_start} → {t_end}, count={len(trades)}")

    if len(trades) >= 2:
        mu_adj, net_flow, sentiment, delta_mu = adjust_mu_with_net_flow(mu, sigma, trades)
    else:
        mu_adj, net_flow, sentiment, delta_mu = mu, 0.0, 0.0, 0.0

    print("\n=== ORDER-FLOW ADJUSTMENT ===")
    print("Net flow:", net_flow)
    print("Sentiment (tanh‑scaled):", sentiment)
    print("Delta mu:", delta_mu)
    print("Adjusted mu:", mu_adj)

    implied_1min_std = S0 * sigma * np.sqrt(60)
    print("\nImplied 1-minute std ($):", implied_1min_std)

    print("\n>>> READY FOR C MONTE CARLO WITH mu_adj, sigma <<<")

    return S0, mu_adj, sigma


# if __name__ == "__main__":
#     main()
