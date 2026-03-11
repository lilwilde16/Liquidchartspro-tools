(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const MarketData = LCPro.MarketData || {};
  const Indicators = (LCPro.CSVRG && LCPro.CSVRG.Indicators) || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  const TF = { M1: 60, M5: 300, M15: 900, H1: 3600 };

  function symbolToInstrument(symbol) {
    const s = String(symbol || "").replace(/\//g, "").toUpperCase();
    if (s.length !== 6) return symbol;
    return s.slice(0, 3) + "/" + s.slice(3);
  }

  function normalizeCandles(candlesNewestFirst) {
    const raw = Array.isArray(candlesNewestFirst) ? candlesNewestFirst : [];
    const chron = MarketData.candlesToChron ? MarketData.candlesToChron(raw) : raw.slice().reverse();
    return chron.filter((x) => x && Number.isFinite(Number(x.c)));
  }

  async function get_ohlc(pair, timeframe, bars) {
    const instrumentId = symbolToInstrument(pair);
    const tfSec = TF[timeframe];
    if (!tfSec) return [];
    const res = await MarketData.requestCandles(instrumentId, tfSec, bars);
    return normalizeCandles(res);
  }

  function get_bid_ask(pair) {
    const instrumentId = symbolToInstrument(pair);
    return MarketData.getBidAsk(instrumentId);
  }

  function get_spread(pair) {
    const px = get_bid_ask(pair);
    if (!px.ok) return null;
    return Math.max(0, Number(px.ask) - Number(px.bid));
  }

  function calcIndicators(candles, settings) {
    const closes = Indicators.closeSeries(candles);
    const ema = Indicators.ema(closes, settings.ema_period);
    const bb = Indicators.bollinger(closes, settings.bb_period, settings.bb_stddev);
    const atr = Indicators.atr(candles, settings.atr_period);
    const adx = Indicators.adx(candles, settings.adx_period);
    return { ema, bb, atr, adx };
  }

  async function update_market_data(state) {
    const settings = state.settings;
    const symbols = settings.pairs_universe || [];
    const instruments = symbols.map(symbolToInstrument);

    if (MarketData.requestPrices) {
      MarketData.requestPrices(instruments);
    }

    for (let i = 0; i < symbols.length; i++) {
      const pair = symbols[i];
      const ps = state.pair_states[pair];
      if (!ps) continue;

      const bidAsk = get_bid_ask(pair);
      ps.bid = bidAsk.ok ? Number(bidAsk.bid) : null;
      ps.ask = bidAsk.ok ? Number(bidAsk.ask) : null;
      ps.mid = bidAsk.ok ? (ps.bid + ps.ask) / 2 : null;

      const spread = get_spread(pair);
      ps.spread = spread;
      if (Number.isFinite(spread)) {
        if (!Number.isFinite(ps.spread_avg)) ps.spread_avg = spread;
        ps.spread_avg = ps.spread_avg * 0.9 + spread * 0.1;
      }

      const tfNames = Object.keys(TF);
      for (let t = 0; t < tfNames.length; t++) {
        const tfName = tfNames[t];
        const candles = await get_ohlc(pair, tfName, settings.candles_lookback);
        ps.timeframe[tfName] = candles;
      }

      const m15 = ps.timeframe.M15 || [];
      const ind = calcIndicators(m15, settings);
      ps.indicators.EMA = ind.ema;
      ps.indicators.BB = ind.bb || { upper: null, middle: null, lower: null };
      ps.indicators.ATR = ind.atr;
      ps.indicators.ADX = ind.adx;
    }

    state.cycle_timestamp = Date.now();
    return state;
  }

  LCPro.CSVRG.MarketDataModule = {
    TF,
    symbolToInstrument,
    update_market_data,
    get_bid_ask,
    get_spread,
    get_ohlc
  };
})();
