# src/ui/

Front-end files: HTML-adjacent JavaScript, CSS styles, and small UI helpers.

## Files

| File | Description |
|------|-------------|
| `app.js` | Main UI controller. Wires buttons, dropdowns, and live status updates to the engine APIs |
| `ui-tabs.js` | Tab navigation (Home / Strategy / Tools). Exposes `window.UI.setTab` |
| `signals-display.js` | **Last 5 signals display stub.** Stores and renders the most recent strategy signals. See instructions below |
| `css/app.css` | Application styles |

## Displaying the last 5 signals

`signals-display.js` exposes `window.SignalsDisplay`. Signals are pushed from
whichever strategy engine is running. To connect it to a live strategy:

```javascript
// After a strategy produces a signal, call:
window.SignalsDisplay.push({
  pair:       "EUR/USD",
  dir:        1,           // 1 = BUY, -1 = SELL
  confidence: 0.82,
  reason:     "SMA crossover above H1 trend",
  time:       Date.now()
});
```

The last 5 signals are persisted in `localStorage` and rendered into the
`#lastSignalsTable` element in `index.html` automatically.

To clear the signal history:
```javascript
window.SignalsDisplay.clear();
```

## Adding a new UI panel

1. Add your HTML to the relevant tab section in `index.html`.
2. Add the button wiring and logic to `src/ui/app.js`.
3. Keep UI logic thin — delegate all calculation to `src/strategies/` or
   `src/functions/`.
