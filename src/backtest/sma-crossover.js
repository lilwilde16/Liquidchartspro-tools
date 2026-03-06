(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const MarketData = LCPro.MarketData || {};

  function sma(series, len) {
    const out = new Array(series.length).fill(null);
    let sum = 0;
    for (let i = 0; i < series.length; i++) {
      sum += series[i];
      if (i >= len) sum -= series[i - len];
      if (i >= len - 1) out[i] = sum / len;
    }
    return out;
  }

  async function lastCrossSignals(instrumentId, timeframeSec, pullCount, fastN, slowN, keepN) {
    const msg = await MarketData.requestCandles(instrumentId, timeframeSec, pullCount);
    const candles = msg && msg.candles ? msg.candles : null;
    if (!candles || candles.length < slowN + 50) return [];

    // Closed candles only: skip index 0 (forming/newest)
    const closed = candles.slice(1);
    const cChron = MarketData.candlesToChron(closed);

    const close = cChron.map((c) => c.c);
    const date = cChron.map((c) => c.date);
    const f = sma(close, fastN);
    const s = sma(close, slowN);

    const signals = [];
    for (let i = 1; i < cChron.length; i++) {
      if (f[i] == null || s[i] == null || f[i - 1] == null || s[i - 1] == null) continue;

      const prevDiff = f[i - 1] - s[i - 1];
      const diff = f[i] - s[i];
      if (prevDiff <= 0 && diff > 0) {
        signals.push({ type: "BUY", time: date[i], price: close[i], idx: i });
      } else if (prevDiff >= 0 && diff < 0) {
        signals.push({ type: "SELL", time: date[i], price: close[i], idx: i });
      }
    }

    return signals.slice(-keepN).reverse();
  }

  LCPro.Backtest = {
    sma,
    lastCrossSignals
  };
})();
