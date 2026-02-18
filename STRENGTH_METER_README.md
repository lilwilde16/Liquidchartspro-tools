# Currency Strength Meter - Multi-Timeframe Algorithm

## Overview

This update transforms the Currency Strength Meter from a simple percent-change aggregation into a sophisticated multi-timeframe composite strength model with ATR normalization and quality filters.

## Key Features

### 1. Enhanced Pair Parsing
- Supports both "EUR/USD" and "EURUSD" formats
- Automatically normalizes to "XXX/YYY" uppercase format
- Validates currencies against majors set: USD, EUR, GBP, JPY, AUD, NZD, CAD, CHF

### 2. Multi-Timeframe Analysis
The algorithm analyzes three timeframes simultaneously:
- **M5 (5-minute)**: 300 seconds, 300 candles, 20% weight
- **M15 (15-minute)**: 900 seconds, 300 candles, 50% weight
- **H1 (1-hour)**: 3600 seconds, 200 candles, 30% weight

### 3. Per-Timeframe Metrics
For each pair and timeframe, the algorithm computes:
- **ATR Percentage** (`atrPct`): ATR / current price
- **Trend Ratio**: |SMA_fast(20) - SMA_slow(100)| / ATR
- **Return Percentage**: ((current / first) - 1) × 100
- **Slope Normalized** (`slopeNorm`): Linear regression slope of ln(close) over last 60 bars / max(atrPct, 0.0006)

### 4. Quality Filters
Pairs are excluded from a timeframe if:
- ATR percentage < 0.0006 (too low volatility)
- Trend ratio < 0.25 (too choppy/consolidating)

### 5. Z-Score Normalization
After computing metrics for all pairs within a timeframe:
- `slopeNorm` values are z-scored across all pairs
- Weighted return (`returnPct / atrPct`) values are z-scored across all pairs
- This reduces scale bias and ensures fair comparison

### 6. Composite Scoring
Per timeframe composite:
```
compositeTF = (0.4 × slopeNormZ) + (0.3 × trendRatio) + (0.3 × wReturnZ)
```

Multi-timeframe blend:
```
compositeBlend = (0.2 × M5) + (0.5 × M15) + (0.3 × H1)
```
If a timeframe is missing/weak, remaining timeframes are reweighted proportionally.

### 7. Currency Aggregation
- For each pair, the `compositeBlend` is added to the base currency score
- The `compositeBlend` is subtracted from the quote currency score
- Currencies are ranked by average score (descending)

### 8. Best Pairs Suggestions
- Takes top 3 strongest currencies vs bottom 3 weakest currencies
- Suggests pairs with spread = strongest.avgScore - weakest.avgScore

## AutoTrader Integration

The `strengthBias` function in `engine-autotrader.js` now uses **dynamic scaling**:

```javascript
const scores = ranked.map(x => x.avgScore);
const minScore = Math.min(...scores);
const maxScore = Math.max(...scores);
const scale = Math.max(0.001, maxScore - minScore);
const normalized = spread / scale;
score = clamp(normalized, [-1, 1]);
```

This ensures the strength bias adapts to current market conditions rather than using a fixed divisor.

## UI Changes

### index.html
- Added comprehensive Strength page with controls
- Required element IDs:
  - `pairs`: Textarea for pair configuration
  - `strengthAutoSec`: Auto-refresh interval
  - `btnStrengthRun`: Run once button
  - `btnStrengthAuto`: Start auto-refresh
  - `btnStrengthStop`: Stop auto-refresh
  - `strengthStatus`: Status message display
  - `strengthTable`: Currency rankings table
  - `strengthBestPairs`: Best pairs suggestions
  - `statusPill`: Global status indicator
  - `log`: Log messages

### util-indicators.js
- Added `linregSlope(values, len)` function for linear regression slope calculation

## Testing

### Manual Test
Open `test/strength-test.html` in a browser to test with mock data:
```bash
cd Liquidchartspro-tools
python3 -m http.server 8080
# Navigate to http://localhost:8080/test/strength-test.html
```

### Node.js Test
Run the automated test:
```bash
cd test
node test-strength.js
```

## Algorithm Flow

1. Parse pairs from settings (supports both formats)
2. For each timeframe (M5, M15, H1):
   - Fetch candles for all pairs
   - Compute indicators (SMA fast/slow, ATR)
   - Calculate per-TF metrics
   - Apply quality filters
   - Z-normalize slopeNorm and weighted returns
   - Compute composite TF scores
3. Blend timeframe scores (weighted average)
4. Aggregate pair scores to currency scores
5. Rank currencies by average score
6. Generate best pair suggestions

## Performance Considerations

- Uses `Promise.allSettled()` for parallel candle fetching
- Quality filters reduce computation on low-quality data
- Z-normalization prevents scale bias
- Efficient array operations throughout

## Backward Compatibility

- Maintains same API surface: `run()`, `init()`, `startAuto()`, `stopAuto()`, `getSnapshot()`
- AutoTrader continues to work with dynamic strengthBias scaling
- Existing UI elements remain compatible

## Files Modified

1. `js/engine-strength.js` - Complete algorithm rewrite
2. `js/engine-autotrader.js` - Dynamic strengthBias normalization
3. `js/util-indicators.js` - Added linregSlope function
4. `js/ui-tabs.js` - Updated for new HTML structure
5. `index.html` - Added Strength page controls and structure
6. `css/style.css` - Comprehensive styling (new file)
7. `.gitignore` - Exclude backup and build files (new file)
8. `test/strength-test.html` - Standalone test page (new file)
9. `test/test-strength.js` - Node.js test script (new file)

## Future Enhancements

Potential improvements:
- Configurable timeframes and weights
- Additional quality metrics (e.g., volume)
- Historical strength tracking and visualization
- Export strength data to CSV
- Alert system for significant strength changes
