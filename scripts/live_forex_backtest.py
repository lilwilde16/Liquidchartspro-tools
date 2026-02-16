#!/usr/bin/env python3
import math
from dataclasses import dataclass
from itertools import product
from typing import Dict, List, Tuple

import pandas as pd

try:
    import yfinance as yf
except Exception as exc:
    raise SystemExit("Missing dependency yfinance. Install with: pip install yfinance") from exc

PAIRS = ["EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X"]
START = "2012-01-01"

FASTS = [20, 50, 100]
SLOWS = [100, 200, 300]
ATR_STOPS = [1.5, 2.0, 3.0]
ALLOW_SHORT = [True, False]


@dataclass
class Metrics:
    pair: str
    bars: int
    trades: int
    win_rate: float
    cagr: float
    max_dd: float
    sharpe: float
    total_return: float


def max_drawdown(equity: pd.Series) -> float:
    peak = equity.cummax()
    dd = (equity / peak) - 1.0
    return float(dd.min())


def annualized_sharpe(ret: pd.Series) -> float:
    ret = ret.dropna()
    if ret.std() == 0 or len(ret) < 2:
        return 0.0
    return float((ret.mean() / ret.std()) * math.sqrt(252))


def cagr(equity: pd.Series) -> float:
    years = len(equity) / 252.0
    if len(equity) < 2 or years <= 0:
        return 0.0
    return float((equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1)


def run_strategy(df: pd.DataFrame, fast=50, slow=200, atr_len=14, atr_stop=2.0, allow_short=True) -> Dict:
    close = df["Close"]
    high = df["High"]
    low = df["Low"]

    fast_ma = close.rolling(fast).mean()
    slow_ma = close.rolling(slow).mean()

    tr = pd.concat([
        (high - low).abs(),
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(atr_len).mean()

    pos = pd.Series(0.0, index=df.index)
    entry_price = 0.0
    stop_price = None
    trades = []

    for i in range(1, len(df)):
        prev_pos = pos.iloc[i - 1]
        c = close.iloc[i]

        fast_prev, slow_prev = fast_ma.iloc[i - 1], slow_ma.iloc[i - 1]
        fast_now, slow_now = fast_ma.iloc[i], slow_ma.iloc[i]
        if pd.isna(fast_prev) or pd.isna(slow_prev) or pd.isna(fast_now) or pd.isna(slow_now):
            continue

        bullish_cross = bool(fast_prev <= slow_prev and fast_now > slow_now)
        bearish_cross = bool(fast_prev >= slow_prev and fast_now < slow_now)

        if prev_pos == 0:
            atr_now = atr.iloc[i]
            if pd.isna(atr_now):
                continue
            if bullish_cross:
                pos.iloc[i] = 1.0
                entry_price = c
                stop_price = c - atr_stop * atr_now
                trades.append({"r": None})
            elif allow_short and bearish_cross:
                pos.iloc[i] = -1.0
                entry_price = c
                stop_price = c + atr_stop * atr_now
                trades.append({"r": None})
            continue

        pos.iloc[i] = prev_pos
        atr_now = atr.iloc[i]
        if prev_pos > 0:
            if not pd.isna(atr_now):
                stop_price = max(stop_price, c - atr_stop * atr_now)
            if c <= stop_price or bearish_cross:
                trades[-1]["r"] = float((c - entry_price) / entry_price)
                pos.iloc[i] = 0.0
        else:
            if not pd.isna(atr_now):
                stop_price = min(stop_price, c + atr_stop * atr_now)
            if c >= stop_price or bullish_cross:
                trades[-1]["r"] = float((entry_price - c) / entry_price)
                pos.iloc[i] = 0.0

    rets = close.pct_change().fillna(0.0)
    strat_rets = rets * pos.shift(1).fillna(0.0)
    equity = (1 + strat_rets).cumprod()

    closed = [t for t in trades if t["r"] is not None]
    wins = sum(1 for t in closed if t["r"] > 0)

    return {
        "bars": len(df),
        "trades": len(closed),
        "win_rate": (wins / len(closed) * 100.0) if closed else 0.0,
        "cagr": cagr(equity) * 100,
        "max_dd": max_drawdown(equity) * 100,
        "sharpe": annualized_sharpe(strat_rets),
        "total_return": (equity.iloc[-1] - 1.0) * 100,
    }


def fetch(pair: str) -> pd.DataFrame:
    df = yf.download(pair, start=START, interval="1d", auto_adjust=False, progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    if df.empty:
        raise RuntimeError(f"No data for {pair}")
    return df[["Open", "High", "Low", "Close"]].dropna().copy()


def evaluate_combo(data: Dict[str, pd.DataFrame], combo: Tuple[int, int, float, bool]) -> Dict:
    fast, slow, atr_stop, allow_short = combo
    pair_rows: List[Metrics] = []
    for pair, df in data.items():
        out = run_strategy(df, fast=fast, slow=slow, atr_stop=atr_stop, allow_short=allow_short)
        pair_rows.append(Metrics(pair=pair, **out))
    table = pd.DataFrame([r.__dict__ for r in pair_rows])
    avg = table[["cagr", "max_dd", "sharpe", "win_rate", "total_return"]].mean(numeric_only=True)
    return {
        "fast": fast,
        "slow": slow,
        "atr_stop": atr_stop,
        "allow_short": allow_short,
        "avg_cagr": float(avg["cagr"]),
        "avg_max_dd": float(avg["max_dd"]),
        "avg_sharpe": float(avg["sharpe"]),
        "avg_win_rate": float(avg["win_rate"]),
        "avg_total_return": float(avg["total_return"]),
        "by_pair": table,
    }


def main():
    data = {p: fetch(p) for p in PAIRS}
    combos = [(f, s, a, sh) for f, s, a, sh in product(FASTS, SLOWS, ATR_STOPS, ALLOW_SHORT) if f < s]
    results = [evaluate_combo(data, c) for c in combos]

    ranking = pd.DataFrame([{"combo_id": i, **{k: v for k, v in r.items() if k != "by_pair"}} for i, r in enumerate(results)])
    ranking = ranking.sort_values(["avg_sharpe", "avg_cagr", "avg_max_dd"], ascending=[False, False, False]).reset_index(drop=True)

    print("Top 8 parameter sets (portfolio-average):")
    print(ranking.head(8).to_string(index=False, float_format=lambda x: f"{x:,.3f}"))

    best = results[int(ranking.iloc[0]["combo_id"])]
    print("\nBest set by pair:")
    print(best["by_pair"].to_string(index=False, float_format=lambda x: f"{x:,.3f}"))


if __name__ == "__main__":
    main()
