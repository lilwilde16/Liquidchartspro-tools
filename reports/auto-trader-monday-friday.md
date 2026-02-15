# Auto Trader Monday-Friday Workflow

## What is automated now
- Strength scan refresh is triggered before each auto-trader cycle.
- Pair selection prefers strongest-vs-weakest currency combinations.
- Entry requires both:
  1) supply/demand zone rejection signal,
  2) strength-direction alignment.
- Trade execution uses `sendMarketOrderWithTPSL` with ATR-based distances.
- Schedule guard can limit operation to Monday-Friday + UTC hour window.

## Safety constraints
- No strategy can be foolproof or guarantee a green week every week.
- Use low size first and keep ARM OFF until you complete forward-testing.
- Suggested hard stops:
  - max 2R daily loss,
  - max 5R weekly drawdown,
  - auto-off after abnormal volatility/news.

## Recommended baseline
- Timeframe: M15
- Scan interval: 120s
- SL ATR: 1.1
- RR: 1.5
- Max trades/day: 4
- Cooldown: 45 minutes
