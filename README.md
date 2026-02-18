# LiquidChartsPro Tools

A comprehensive trading toolkit featuring a multi-timeframe currency strength meter and session-aware automated trading system integrated with the LiquidCharts platform.

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
- **Backtest engine** for strategy validation
- **Manual trading controls** with TP/SL management
- **Framework diagnostics** and health checks
- **Comprehensive logging** system

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

## Configuration

All configuration constants are documented in [CONFIGURATION.md](./CONFIGURATION.md).

### Quick Start Settings

**Strength Meter:**
- Timeframe: M15
- Candles: 500
- Auto-refresh: 60 seconds

**AutoTrader:**
- Signal timeframe: M15
- Risk mode: Conservative
- Lots: 0.01
- Risk:Reward: 1.5
- Stop loss: 1.1× ATR
- Min confidence: 0.58 (session-adjusted)

### Trading Pairs

Add pairs to Settings (one per line). Supported formats:
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
EUR/GBP
EUR/JPY
GBP/JPY
AUD/JPY
```

## Usage

### Running a Strength Scan

1. Navigate to the **Strength** tab
2. Select timeframe (M5, M15, M30, H1)
3. Set candle count (100-2000)
4. Click **Run Strength Scan**
5. Optional: Enable **Start Auto Refresh** for continuous updates

The strength table shows:
- Currency ranking
- Strength scores (positive = strong, negative = weak)
- Number of pairs analyzed

**Best Trading Pairs** section suggests trades based on strength divergence.

### Using the AutoTrader

⚠️ **Important**: AutoTrader executes real trades. Test thoroughly in demo mode first.

1. Navigate to the **Tools** tab
2. Configure parameters:
   - Timeframe and candles
   - Risk mode and lot size
   - Schedule (Mon-Fri, UTC hours)
   - Confidence threshold
3. Ensure trading pairs are configured in Settings
4. Set ARM to "ON (live)" for real execution
5. Click **Start AutoTrader**

Monitor the status display and activity log for:
- Scanned pairs and confidence scores
- Trade execution confirmations
- Cooldown and limit messages
- Session changes

### AutoTrader Safety Features

- **Schedule enforcement**: Only trades Mon-Fri during configured hours
- **Session-based confidence**: Higher thresholds during less favorable sessions
- **Daily limits**: Maximum 4 trades/day global, 2 per pair
- **Cooldown periods**: 60 min per pair, 45 min global
- **Adaptive learning**: Tracks win/loss ratios, adjusts confidence after losses
- **Multi-factor gating**:
  - Strength spread must be ≥0.40
  - H1 trend ratio must be ≥0.30
  - RSI filters on M5 and H1
  - Spread must be within acceptable range

## Architecture

### Script Load Order

The application loads scripts in a specific order to ensure dependencies:

1. **LiquidCharts Widget** (external)
2. `util-indicators.js` - Technical indicators (SMA, ATR, RSI, linreg)
3. `lc-framework.js` - Framework wrapper and API handlers
4. `strategy-registry.js` - Backtest strategies
5. `engine-backtest.js` - Backtesting engine
6. `engine-strength.js` - Currency strength meter
7. `engine-autotrader.js` - Automated trading engine
8. `ui-tabs.js` - Tab navigation
9. `app.js` - Application initialization

### Data Flow

```
LiquidCharts Framework
        ↓
  lc-framework.js (wraps API)
        ↓
┌───────┴────────┐
↓                ↓
engine-strength  engine-autotrader
    ↓                ↓
 Strength         Trade
 Rankings        Execution
    ↓                ↓
 app.js (UI updates)
```

### Strength Calculation

1. Fetch multi-timeframe candle data (M5, M15, H1)
2. Calculate indicators per timeframe:
   - ATR for normalization
   - Moving averages for trend
   - RSI for momentum
   - Linear regression for direction
3. Compute composite score:
   - With RSI: 0.35×RSI spread + 0.35×trend ratio + 0.30×weighted return
   - Without RSI: 0.4×slope + 0.3×trend ratio + 0.3×weighted return
4. Blend timeframes: M5 30%, M15 50%, H1 20%
5. Score currencies by pair components
6. Rank and display

### AutoTrader Decision Flow

```
1. Check schedule → Outside hours? → Idle
2. Check daily limits → Exceeded? → Idle
3. Check global cooldown → Active? → Idle
4. Run strength scan → Update rankings
5. Scan all pairs:
   - Fetch M5 + H1 data
   - Calculate indicators
   - Check H1 trend confirmation
   - Check RSI filters
   - Check strength alignment
   - Check spread cap
   - Calculate confidence
6. Select best candidate
7. Apply session min confidence + adaptive adjustment
8. Below threshold? → Idle
9. Execute trade with TP/SL
10. Update cooldowns and limits
```

## API Reference

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

### window.ENG.AutoTrader

```javascript
// Start autotrader
window.ENG.AutoTrader.start();

// Stop autotrader
window.ENG.AutoTrader.stop();

// Run single cycle (for testing)
await window.ENG.AutoTrader.runCycle();
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

## Testing

### Syntax Validation

```bash
node --check js/util-indicators.js
node --check js/lc-framework.js
node --check js/engine-strength.js
node --check js/engine-autotrader.js
node --check js/app.js
```

### Manual Testing Checklist

- [ ] Framework loads and status shows "Framework responding"
- [ ] Buttons enable after Framework.OnLoad
- [ ] Strength scan with M15, 500 candles populates table
- [ ] Auto-refresh updates table every 60 seconds
- [ ] Best pairs section shows buy/sell ideas
- [ ] AutoTrader gating logs confidence calculations
- [ ] AutoTrader respects schedule and cooldowns
- [ ] Settings persist via localStorage
- [ ] Tab navigation works correctly
- [ ] No console errors with missing Framework

## Troubleshooting

### "Candles API unavailable"
- Ensure running in LiquidCharts environment
- Check Framework.OnLoad has executed
- Verify pair names are correct format

### "No valid pairs configured"
- Add pairs to Settings tab
- Save settings
- Ensure pairs are in XXX/YYY or XXXYYY format

### AutoTrader not trading
Check status messages for:
- "Outside Mon-Fri schedule" → Enable trading hours
- "Max trades/day reached" → Wait for next day
- "Cooldown active" → Wait for cooldown expiry
- "Confidence below threshold" → Market conditions don't meet criteria

### High confidence but no trades
- Check H1 trend confirmation (must be ≥0.30)
- Check RSI filters (M5 and H1 must pass)
- Check strength spread (must be ≥0.40)
- Check spread cap (must be within limits)

## Security

- No secrets are stored in code
- All API calls go through Framework wrapper
- localStorage used only for settings and learning data
- No external HTTP requests except LiquidCharts widget

Security scan: ✅ No vulnerabilities detected

## Contributing

This is a consolidation of three feature branches:
- `codex/add-manual-refresh-button` (#1)
- `copilot/enhance-currency-strength-meter` (#3)
- `copilot/upgrade-currency-strength-meter` (#4)

See [CONFIGURATION.md](./CONFIGURATION.md) for detailed parameter documentation.

## License

See repository license file.

## Disclaimer

⚠️ **Trading Risk Warning**: Automated trading involves substantial risk. This software is provided as-is without any warranty. Use at your own risk. Past performance does not guarantee future results. Always test thoroughly in demo mode before live trading.
