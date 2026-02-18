# Configuration Constants Documentation

## Engine-Strength.js Configuration

### Currency Set
```javascript
const CCYS = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"];
```
Major currencies analyzed in the strength meter.

### Multi-Timeframe Weights
```javascript
const TF_WEIGHTS = {
  300: 0.3,   // M5 weight
  900: 0.5,   // M15 weight
  3600: 0.2   // H1 weight
};
```
Weights for blending strength scores across timeframes. Total should sum to 1.0.

### ATR Normalization
```javascript
const ATR_PCT_FLOOR = 0.0008;
```
Minimum ATR percentage to prevent division by zero and ensure meaningful normalization.

### Trend Filters
```javascript
const MIN_TREND_RATIO = 0.40;
```
Minimum ratio of MA difference to ATR required for valid trend signals.

### Regression Analysis
```javascript
const REG_WINDOW = 60;
```
Lookback window for linear regression slope calculation.

### RSI Configuration
```javascript
const RSI_PERIOD = 7;
const USE_RSI = true;
```
- RSI period using Wilder's smoothing method
- Toggle to enable/disable RSI spread in composite calculation

### Composite Score Weights

#### With RSI Enabled
```javascript
const WEIGHTS_WITH_RSI = {
  rsiSpread: 0.35,       // RSI deviation from neutral
  trendRatio: 0.35,      // Trend strength vs ATR
  weightedReturn: 0.30   // Price momentum
};
```

#### Without RSI (Fallback)
```javascript
const WEIGHTS_WITHOUT_RSI = {
  slopeZ: 0.4,           // Linear regression slope z-score
  trendRatio: 0.3,       // Trend strength vs ATR
  weightedReturn: 0.3    // Price momentum
};
```

## Engine-AutoTrader.js Configuration

### Strength Thresholds
```javascript
const MIN_STRENGTH_SPREAD = 0.40;
const MIN_STRENGTH_AGAINST_TREND = 0.65;
```
- Minimum spread between strongest and weakest currencies
- Higher threshold required for counter-trend trades

### Trend Confirmation
```javascript
const H1_MIN_TREND_RATIO = 0.30;
```
Minimum H1 timeframe trend ratio for valid signals.

### RSI Filters
```javascript
const RSI_M5_LONG_MIN = 55;
const RSI_M5_SHORT_MAX = 45;
const RSI_H1_LONG_MIN = 50;
const RSI_H1_SHORT_MAX = 50;
```
RSI thresholds for directional filters on M5 and H1 timeframes.

### Spread Filtering
```javascript
const SPREAD_MEDIAN_MULTIPLIER = 1.2;
const JPY_SPREAD_THRESHOLD = 0.03;  // 3 pips
```
- Maximum spread as multiple of recent median
- Special threshold for JPY pairs

### Confidence Scoring Weights
```javascript
const CONF_WEIGHTS = {
  vol: 0.25,        // Volatility score
  sharp: 0.25,      // Sharpness/trend quality
  strength: 0.25,   // Currency strength alignment
  regime: 0.12,     // Market regime (H1 trend alignment)
  spread: -0.10,    // Spread penalty
  learning: 0.23    // Machine learning component
};
```
Weights sum to 1.00 (positive weights 1.10 minus spread penalty 0.10).

### Session-Based Confidence Thresholds
```javascript
const SESSION_MIN_CONFIDENCE = {
  london: 0.62,      // London session (7-16 UTC)
  nyOverlap: 0.60,   // NY overlap (12-16 UTC)
  other: 0.66        // All other times
};
```
Dynamic minimum confidence based on market session.

### Risk Management
```javascript
const DEFAULT_SL_ATR_MULT = 1.1;      // Stop loss distance
const DEFAULT_RR = 1.5;                // Default risk:reward
const AGGRESSIVE_RR = 2.0;             // Aggressive mode R:R
const PARTIAL_TP_PERCENT = 0.5;        // 50% partial TP
const BE_MOVE_AT_R = 0.8;              // Break-even at 0.8R
const ATR_TRAIL_MULT = 0.9;            // Trailing stop at 0.9×ATR
```

### Cooldowns and Limits
```javascript
const PER_PAIR_COOLDOWN_MIN = 60;              // Per-pair cooldown
const MAX_TRADES_PER_PAIR_PER_DAY = 2;         // Daily limit per pair
const GLOBAL_COOLDOWN_MIN = 45;                // Global cooldown
const LOSS_CONFIDENCE_PENALTY = 0.05;          // Confidence boost after 2+ losses
```

## Default UI Settings

### Strength Scanner
- Timeframe: M15 (900 seconds)
- Candles: 500
- Auto-refresh: 60 seconds

### AutoTrader
- Signal timeframe: M15
- Candles per scan: 500
- Scan interval: 120 seconds
- Risk mode: Conservative
- Lots: 0.01
- Risk:Reward: 1.5
- SL ATR multiple: 1.1
- Schedule: Mon-Fri, 6:00-20:00 UTC
- Volatile window: 12:00-16:00 UTC
- Max trades/day: 4
- Cooldown: 45 minutes
- Learning: On
- Min confidence: 0.58

### Trading Pairs (Default)
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

## Pair Format Parsing

Both formats are accepted and normalized to XXX/YYY:
- EUR/USD → EUR/USD
- EURUSD → EUR/USD

## Session Detection

Sessions are determined by UTC hour:
- London: 7-16 UTC
- NY Overlap: 12-16 UTC (most favorable)
- Other: All remaining hours

Trading is restricted to Mon-Fri when schedule is enabled.
