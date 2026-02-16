# Live Forex Strategy Test (Yahoo Finance feed)

This report was generated from `scripts/live_forex_backtest.py` using daily OHLC data downloaded from Yahoo Finance (`yfinance`) from 2012 onward.

## Tested universe
- EURUSD=X
- GBPUSD=X
- USDJPY=X
- AUDUSD=X

## Strategy model
- Trend-following SMA crossover.
- Entry: fast SMA crosses slow SMA.
- Exit: ATR trailing stop OR opposite cross.
- Both long-only and long/short modes were tested.

## Parameter sweep
- Fast SMA: 20, 50, 100
- Slow SMA: 100, 200, 300
- ATR stop multiple: 1.5, 2.0, 3.0
- `allow_short`: true/false

## Top portfolio-average setting
- `fast=50`
- `slow=300`
- `atr_stop=1.5`
- `allow_short=false`

Portfolio-average metrics for this set:
- CAGR: **0.291%**
- Max drawdown: **-3.512%**
- Sharpe: **0.197**
- Win rate: **58.879%**
- Total return: **4.366%**

## Conclusion
- This sweep found only **marginal edge** on daily bars for the tested FX majors.
- The best set was conservative (long-only, very slow trend filter), with low drawdown but modest return.
- For a long-running system, use this as a baseline and add:
  - spread/commission/slippage modeling,
  - walk-forward re-optimization,
  - volatility regime filter,
  - position sizing cap by pair correlation.


## Risk note
No strategy can guarantee zero losing weeks. Use weekly loss caps, small risk per trade, and forward-test before scaling.
