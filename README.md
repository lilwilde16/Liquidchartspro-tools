# LiquidChartsPro Tools

A comprehensive trading toolkit with a three-tab interface: **Home** (live controls), **Strategy** (configuration & analysis), and **Tools** (manual testing & diagnostics). Integrates with the LiquidCharts platform for live order execution, automated trading, currency strength analysis, and strategy backtesting.

---

## Tabs Overview

### 🏠 Home Tab
The main dashboard for live trading operations:
- **ARM toggle** — switch between Ticket-only (safe) and live `SendOrder` mode
- **AutoTrader start/stop** — launch or halt the automated trading engine
- **Profit Goals** — set and save daily/weekly $ targets (persisted in localStorage)
- **Active Strategy display** — shows the currently selected strategy name
- **Pairs Being Monitored** — live tag list of all configured pairs
- **Signal Scan button** — runs the AutoTrader signal detection across all pairs right now and shows the top 5 candidates by confidence score; use this to manually verify the strategy is finding good setups before enabling live trading

### 📊 Strategy Tab
Configure what the AutoTrader trades and how:
- **Strategy Preset** — choose from built-in strategies (SMA Crossover, Long-Term Trend, Strength Scalper, NAS100 Scalper); preset description and defaults auto-load
- **Pairs to Trade** — one pair per line (e.g. `EUR/USD`); used by AutoTrader and Strength Meter
- **AutoTrader Configuration** — timeframe, candle count, poll interval, risk mode, lot size, RR ratio, SL ATR multiplier, confidence threshold, schedule settings, daily limits, cooldown, and learning mode
- **Currency Strength Meter** — multi-timeframe composite strength analysis; run before enabling live trading to confirm market conditions

### 🔧 Tools Tab
Manual testing, backtesting, and diagnostics:
- **Trading Functions** — manually place BUY/SELL orders with TP/SL via the CHANGE(101) pattern; **Close One** uses a live dropdown populated from open orders (refreshes every 5 s and on ⟳ click)
- **Backtest Engine** — test the selected strategy against historical platform data with configurable parameters
- **Diagnostics** — health check, full diagnostics, and AutoTrader start/stop shortcuts
- **Log** — full timestamped log with **Copy Log** button for easy paste-sharing when debugging

---

## Features

### 🔍 Currency Strength Meter
- **Multi-timeframe composite analysis** (M5, M15, H1) with configurable weights
- **ATR-normalized scoring** to account for different pair volatilities
- **RSI spread calculation** using Wilder's smoothing method
- **Dynamic ranking** of 8 major currencies (USD, EUR, GBP, JPY, AUD, NZD, CAD, CHF)
- **Auto-refresh capability** with customizable intervals
- **Best pair suggestions** based on strength divergence

### 🤖 AutoTrader
- **Session-aware confidence thresholds** (London, NY overlap, other sessions)
- **Multi-timeframe confirmation** (M5 signals with H1 trend validation)
- **Dynamic strength bias** scaling using current min/max range
- **RSI filters** for directional confirmation
- **Spread monitoring** with JPY-specific thresholds
- **Risk management** with partial TP, break-even moves, and ATR trailing
- **Learning system** tracking win/loss ratios per pair
- **Adaptive confidence** adjustment after consecutive losses
- **Per-pair cooldowns** (60 min) and daily limits (2 trades/pair/day)
- **Global cooldown** (45 min) between trades

### 📊 Additional Tools
- **Backtest engine** for strategy validation with CSV export
- **Manual trading controls** with TP/SL management and order dropdown
- **Framework diagnostics** and health checks
- **Comprehensive logging** system with copy-to-clipboard

---

## Installation

1. Clone the repository:
```bash
git clone https://github.com/lilwilde16/Liquidchartspro-tools.git
cd Liquidchartspro-tools
```

2. Open `index.html` in a LiquidCharts-compatible environment

The application is designed to run as a widget within the LiquidCharts platform and requires:
- LiquidCharts widget API
- Market data access
- Order execution capabilities

---

## Configuration

All configuration constants are documented in [CONFIGURATION.md](./CONFIGURATION.md).

### Quick Start Settings

**Strength Meter (Strategy tab):**
- Timeframe: M15
- Candles: 500
- Auto-refresh: 60 seconds

**AutoTrader (Strategy tab):**
- Signal timeframe: M15
- Risk mode: Conservative
- Lots: 0.01
- Risk:Reward: 1.5
- Stop loss: 1.1x ATR
- Min confidence: 0.58 (session-adjusted)

### Trading Pairs

Add pairs in the **Strategy tab -> Pairs to Trade** (one per line). Supported formats:
- `EUR/USD` (recommended)
- `EURUSD` (auto-converted)

Default pairs:
```
EUR/USD
GBP/USD
USD/JPY
AUD/USD
NZD/USD
USD/CAD
USD/CHF
EUR/GBP
EUR/JPY
GBP/JPY
```

---

## Usage

### Verifying the Strategy (Home Tab)
1. Select a strategy in the **Strategy tab**
2. Configure your pairs
3. Go to **Home** and click **Show Current Signal Scan (Top 5)**
4. Review the top 5 pair candidates with their confidence scores and signal direction
5. If results look reasonable, enable the AutoTrader

### Running a Strength Scan (Strategy Tab)
1. Navigate to the **Strategy** tab
2. Scroll to **Currency Strength Meter**
3. Select timeframe (M5, M15, M30, H1)
4. Set candle count (100-2000)
5. Click **Run Strength Scan**
6. Optional: Enable **Start Auto Refresh** for continuous updates

### Using the AutoTrader
1. Navigate to the **Strategy** tab and configure parameters
2. Add trading pairs
3. Go to the **Home** tab
4. Set ARM to "ON (live)"
5. Click **Start** AutoTrader

Monitor the log (Tools tab) for:
- Scanned pairs and confidence scores
- Trade execution confirmations
- Cooldown and limit messages
- Session changes

### Using Close One (Tools Tab)
1. Navigate to the **Tools** tab
2. Click the **refresh button** next to the Open Order dropdown to refresh the list
3. Select the order from the dropdown (shows instrument, direction, and ID)
4. Click **Close One (by Order ID)**

---

## AutoTrader Safety Features

- **Schedule enforcement**: Only trades Mon-Fri during configured hours
- **Session-based confidence**: Higher thresholds during less favorable sessions
- **Daily limits**: Maximum 4 trades/day global, 2 per pair
- **Cooldown periods**: 60 min per pair, 45 min global
- **Adaptive learning**: Tracks win/loss ratios, adjusts confidence after losses
- **Multi-factor gating**:
  - Strength spread must be >= 0.40
  - H1 trend ratio must be >= 0.30
  - RSI filters on M5 and H1
  - Spread must be within acceptable range

---

## Architecture

### Script Load Order

The application loads scripts in a specific order to ensure dependencies:

1. **LiquidCharts Widget** (external)
2. `util-indicators.js` - Technical indicators (SMA, ATR, RSI, linreg)
3. `lc-framework.js` - Framework wrapper and API handlers
4. `trading-api.js` - Trading API reference
5. `strategy-registry.js` - Backtest strategies
6. `engine-backtest.js` - Backtesting engine
7. `engine-strength.js` - Currency strength meter
8. `engine-autotrader.js` - Automated trading engine
9. `ui-tabs.js` - Tab navigation
10. `app.js` - Application initialization

### Data Flow

```
LiquidCharts Framework
        |
  lc-framework.js (wraps API)
        |
  +-----+-----+
  |           |
engine-strength  engine-autotrader
  |                |
Strength         Trade
Rankings        Execution
  |                |
  app.js (UI updates -- all 3 tabs)
```

---

## API Reference

### window.ENG.AutoTrader

```javascript
// Start autotrader
window.ENG.AutoTrader.start();

// Stop autotrader
window.ENG.AutoTrader.stop();

// Run single cycle (for testing)
await window.ENG.AutoTrader.runCycle();

// Scan all configured pairs for signals (powers Home tab signal scan)
const results = await window.ENG.AutoTrader.scan();
// Returns: Array of { pair, dir, confidence, reason, pattern, ... } sorted by confidence desc
```

### window.ENG.Strength

```javascript
// Run strength scan
await window.ENG.Strength.run();

// Start auto-refresh (reads interval from UI)
window.ENG.Strength.startAuto();

// Stop auto-refresh
window.ENG.Strength.stopAuto();

// Get current snapshot
const snapshot = window.ENG.Strength.getSnapshot();
// Returns: { ranked: Array, pairs: Array, updatedAt: Number }
```

### window.LC (Framework Wrapper)

```javascript
// Log message
window.LC.log("Message");

// Set status pill
window.LC.setStatus("Text", "ok|warn|bad");

// Request candle data
const candles = await window.LC.requestCandles(pair, timeframe, count);

// Request live prices
window.LC.requestPrices(["EUR/USD", "GBP/USD"]);
```

---

## Testing

### Syntax Validation

```bash
node --check js/util-indicators.js
node --check js/lc-framework.js
node --check js/engine-strength.js
node --check js/engine-autotrader.js
node --check js/engine-backtest.js
node --check js/app.js
```

### Manual Testing Checklist

- [ ] Framework loads and status shows "Framework responding"
- [ ] Buttons enable after Framework.OnLoad
- [ ] All three tabs (Home, Strategy, Tools) switch correctly
- [ ] ARM toggle on Home tab mirrors ARM in Tools tab
- [ ] Profit goals save/load via localStorage
- [ ] Signal Scan button runs and shows top 5 results
- [ ] Strategy preset dropdown loads and populates description
- [ ] Pairs textarea persists via localStorage
- [ ] AutoTrader start/stop buttons work from both Home and Tools tabs
- [ ] Open Order dropdown auto-populates from live orders; refresh button works
- [ ] Close One uses selected dropdown order ID
- [ ] Strength scan populates table and best pairs
- [ ] Backtest runs and displays results
- [ ] Copy Log copies full log to clipboard
- [ ] Page is scrollable on mobile; tabs are touch-friendly

---

## Troubleshooting

### Sharing Logs for Support
Go to **Tools -> Log** and click **Copy Log**, then paste directly into a chat or issue. The log contains all timestamped events, payloads, and errors.

### "Candles API unavailable"
- Ensure running in LiquidCharts environment
- Check Framework.OnLoad has executed (status pill shows "Framework responding")
- Verify pair names are correct format (XXX/YYY)

### "No valid pairs configured"
- Add pairs to **Strategy tab -> Pairs to Trade**
- Save settings
- Ensure pairs are in XXX/YYY or XXXYYY format

### Open Order dropdown is empty
- Click the refresh button next to the dropdown to refresh
- Use **Dump Orders** to log all open orders to the log
- Ensure ARM is ON before executing live orders

### AutoTrader not trading
Check log (Tools tab) for:
- "Outside Mon-Fri schedule window" -> Check schedule settings
- "Max trades/day reached" -> Wait for next day
- "Cooldown active" -> Wait for cooldown expiry
- "Confidence below threshold" -> Market conditions don't meet criteria
- "strength spread too low" -> Run strength scan first

---

## Security

- No secrets are stored in code
- All API calls go through Framework wrapper
- localStorage used only for settings, goals, and learning data
- No external HTTP requests except LiquidCharts widget

Security scan: No vulnerabilities detected

---

## License

See repository license file.

## Disclaimer

Trading Risk Warning: Automated trading involves substantial risk. This software is provided as-is without any warranty. Use at your own risk. Past performance does not guarantee future results. Always test thoroughly in demo mode before live trading.
