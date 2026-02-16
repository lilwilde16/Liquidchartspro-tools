# Weekly Strength Scalper Plan (LiquidCharts Pro)

## Important reality check
No strategy can guarantee "never ending on a losing week" in live markets. The practical goal is to lower downside variance while preserving positive expectancy.

## Pair selection (anti-consolidation)
1. Run Strength scanner every 15-60 minutes.
2. Focus only on top-vs-bottom currencies (best spread in scanner panel).
3. Skip symbols with low movement / flat strength changes.

## Backtest preset to use
- Strategy: `Strength Scalper (Weekly Focus)`
- Timeframe: `M15`
- Session: `London` (or custom overlap window)
- Baseline params: `Fast=20`, `Slow=100`, `ATR=14`, `SL=1.1x ATR`, `RR=1.5`

## Live risk framework for week-long run
- Risk per trade: 0.25% to 0.75%
- Daily max loss: 2R (stop trading for day)
- Weekly max drawdown stop: 5R
- Reduce risk by 50% after 3 consecutive losses

## Execution checklist
- Trade only in-session.
- Take trades only when trend filter permits (avoid consolidation).
- Skip major high-impact news windows.
- End of week: export results and compare with backtest stats.
