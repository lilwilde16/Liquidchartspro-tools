# Currency Strength Meter Enhancement

## Overview
This enhancement upgrades the Currency Strength Meter to use a more sophisticated, multi-timeframe ATR-normalized composite model that provides more accurate and robust currency strength assessments.

## Key Features

### 1. Multi-Timeframe Analysis
- **M5 (5-minute)**: 300 bars, 20% weight
- **M15 (15-minute)**: 300 bars, 50% weight  
- **H1 (1-hour)**: 200 bars, 30% weight

The algorithm analyzes all three timeframes simultaneously and blends them with the specified weights to provide a comprehensive view of currency strength across different time horizons.

### 2. ATR Normalization
All metrics are normalized by Average True Range (ATR) to account for volatility differences:
- Ensures fair comparison between pairs with different volatility profiles
- Makes scores more meaningful and comparable across diverse market conditions

### 3. Quality Filters
The algorithm automatically filters out poor-quality signals:
- **ATR % Filter**: Skips timeframes where ATR < 0.06% of price (low volatility)
- **Trend Ratio Filter**: Skips timeframes where trend ratio < 0.25 (choppy/consolidating)

### 4. Advanced Metrics
For each pair and timeframe, the algorithm computes:
- **Slope Normalized**: Linear regression slope of log prices over 60 bars, normalized by ATR%
- **Trend Ratio**: Distance between SMA(20) and SMA(100) divided by ATR
- **Weighted Return**: Price return percentage normalized by ATR%

### 5. Cross-Pair Z-Normalization
Within each timeframe, the algorithm:
- Computes z-scores for slope and weighted return across all pairs
- Ensures statistical fairness in comparing different pairs
- Prevents any single pair from dominating the results

### 6. Composite Scoring
Per timeframe composite = (0.4 × Slope Z-score) + (0.3 × Trend Ratio) + (0.3 × Weighted Return Z-score)

Final score = Weighted average across timeframes

## API Documentation

### Public Interface
The strength engine maintains the same public API as before:

```javascript
window.ENG.Strength = {
  run(),           // Run strength analysis once
  init(),          // Initialize UI event handlers
  startAuto(),     // Start auto-refresh
  stopAuto(),      // Stop auto-refresh
  getSnapshot()    // Get current results
};
```

### getSnapshot() Returns
```javascript
{
  ranked: [        // Array of currency objects, sorted by avgScore descending
    {
      ccy: "USD",          // Currency code
      avgScore: 1.234,     // Average composite strength score
      avgAbsMove: 0.567,   // Average absolute movement proxy
      samples: 10          // Number of pairs contributing to this currency
    },
    // ...
  ],
  pairs: ["EUR/USD", "GBP/USD", ...],  // List of analyzed pairs
  updatedAt: 1708268412340              // Timestamp of last update
}
```

## Pair Format Support
The parser now accepts both formats:
- **Slash format**: "EUR/USD", "GBP/JPY"
- **Concatenated format**: "EURUSD", "GBPJPY"

Both are normalized internally to "XXX/YYY" uppercase format.

## AutoTrader Integration

### Dynamic Strength Bias
The AutoTrader's `strengthBias()` function has been updated to use dynamic scaling:

**Old approach**: Fixed divisor of 2.5
```javascript
score = spread / 2.5
```

**New approach**: Dynamic scaling based on actual score range
```javascript
scale = max(avgScore) - min(avgScore)
score = (baseScore - quoteScore) / scale
```

This ensures the strength bias always uses the full [-1, 1] range regardless of the absolute score values, making it more adaptive to varying market conditions.

## UI Components

### Settings Page
- **Pairs Textarea**: Enter trading pairs (one per line) in either format
- **Save Settings**: Persists pairs configuration to localStorage

### Strength Page
- **Multi-timeframe Info**: Shows the timeframe weights used
- **Auto Refresh Control**: Set interval for automatic updates (10-900 seconds)
- **Run Now**: Execute analysis immediately
- **Start/Stop Auto**: Control auto-refresh
- **Status Display**: Shows last update time, strongest/weakest currencies, and success rate
- **Strength Table**: Ranked list of currencies with scores and statistics
- **Best Pair Ideas**: Top 3 strongest vs top 3 weakest currency pairs with spread information

## Performance Considerations

### Caching
- Within a single run cycle, candle data is cached per pair+timeframe combination
- Prevents redundant API calls for the same data

### Parallel Fetching
- Uses `Promise.allSettled()` to fetch all pair+timeframe combinations in parallel
- Continues processing even if some requests fail
- Reports partial results rather than failing completely

### Error Handling
- Gracefully handles missing or invalid candle data
- Skips failed indicators/calculations rather than crashing
- Guards against NaN and division by zero

## Configuration Constants

Located at the top of `js/engine-strength.js`:

```javascript
const ATR_PCT_FLOOR = 0.0006;           // 0.06% minimum ATR filter
const MIN_TREND_RATIO = 0.25;           // Minimum trend strength
const SLOPE_LOOKBACK = 60;              // Bars for regression slope
const COMPOSITE_SLOPE_WEIGHT = 0.4;     // Weight for slope in composite
const COMPOSITE_TREND_WEIGHT = 0.3;     // Weight for trend in composite
const COMPOSITE_RETURN_WEIGHT = 0.3;    // Weight for return in composite
const TF_WEIGHTS = {                    // Multi-timeframe blend weights
  300: 0.2,   // M5
  900: 0.5,   // M15
  3600: 0.3   // H1
};
```

## Styling

CSS classes for visual feedback:
- `.str-up`: Green text for positive strength scores
- `.str-down`: Red text for negative strength scores
- `.pairIdea`: Styling for pair suggestion cards

## Dependencies

### Required
- `window.LC.requestCandles()`: For fetching historical candle data
- `window.LC.log()`: For logging
- `window.LC.setStatus()`: For status updates

### Optional
- `window.UTIL.sma()`: SMA calculation (falls back to inline implementation)
- `window.UTIL.atr()`: ATR calculation (falls back to inline implementation)

## Compatibility

### Backward Compatible
- All existing API methods maintained
- Returns same data structure from `getSnapshot()`
- UI element IDs unchanged

### Breaking Changes
- Strength scores now on a different scale (composite z-scores vs. simple percent change)
- AutoTrader must use updated `strengthBias()` for proper integration
- Multi-timeframe analysis may take longer than single timeframe

## Testing Recommendations

1. **Pair Format**: Test with both "EUR/USD" and "EURUSD" formats
2. **Edge Cases**: Test with 0, 1, 2, and many pairs
3. **Failed Requests**: Simulate candle request failures
4. **Low Volatility**: Test during quiet market periods
5. **High Volatility**: Test during volatile market periods
6. **Auto Refresh**: Verify timer-based updates work correctly

## Future Enhancements

Potential improvements for future versions:
- User-configurable timeframe weights
- Additional quality filters (volume, spread)
- Machine learning for adaptive weight optimization
- Historical strength tracking and visualization
- Correlation analysis between pairs
- Support for additional asset classes (commodities, indices)

## Security Summary

CodeQL analysis completed with **0 alerts** - no security vulnerabilities detected.

## Change Log

### v2.0.0 (2024-02-18)
- Implemented multi-timeframe composite strength model
- Added ATR normalization for all metrics
- Added quality filters for volatility and trend
- Implemented cross-pair z-normalization
- Added weighted multi-timeframe blending
- Updated AutoTrader dynamic scaling
- Enhanced UI with comprehensive controls
- Added CSS styling for strength displays
- Maintained full backward compatibility with existing API
