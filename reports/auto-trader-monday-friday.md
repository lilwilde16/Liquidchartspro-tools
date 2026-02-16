# Auto Trader Monday-Friday Workflow (Adaptive v2)

## What it now does
- Scans **all configured pairs** every cycle.
- Updates currency strength snapshot before ranking candidates.
- Scores each pair by:
  - volatility activity (ATR%),
  - sharp trend quality (MA spread vs ATR),
  - strength alignment,
  - adaptive pair win/loss memory.
- Prioritizes entries only when confidence exceeds your minimum threshold.
- Uses supply/demand zone rejection for directional confirmation.
- Trades only in Mon-Fri schedule windows and supports a separate high-volatility UTC window.

## Learning model
- Learns per-pair bias from tracked order outcomes in local memory (`localStorage`).
- Pairs with stronger historical hit rate get slightly higher ranking weight.
- Learning is optional (toggle ON/OFF in UI).

## Safety constraints
- No strategy can guarantee a profitable week every week.
- Keep ARM OFF until forward-testing confirms behavior.
- Recommended controls:
  - risk <= 0.5% per trade,
  - daily max loss stop,
  - weekly drawdown stop,
  - pause for major news events.

## Suggested baseline
- Timeframe: M15
- Scan interval: 120s
- Volatile window UTC: 12-16
- Min confidence: 0.58
- SL ATR: 1.1
- RR: 1.5
- Max trades/day: 4
- Cooldown: 45 minutes
