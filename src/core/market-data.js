(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const Core = LCPro.Core || {};

  const TF_SECONDS = {
    M1: 60,
    M5: 300,
    M15: 900,
    M30: 1800,
    H1: 3600
  };

  function getInstrument(instrumentId) {
    const Framework = Core.ensureFramework();
    return Framework.Instruments.getOrBlank(instrumentId);
  }

  function requestPrices(instrumentIds) {
    const Framework = Core.ensureFramework();
    try {
      Framework.RequestPrices(instrumentIds);
    } catch (e) {
      return false;
    }
    return true;
  }

  function getBidAsk(instrumentId) {
    const m = getInstrument(instrumentId);
    const bid = Number(m.bid);
    const ask = Number(m.ask);
    return { bid, ask, ok: Number.isFinite(bid) && Number.isFinite(ask) };
  }

  function getFirstFinite(obj, keys) {
    if (!obj || typeof obj !== "object") return null;
    for (let i = 0; i < keys.length; i++) {
      const v = Number(obj[keys[i]]);
      if (Number.isFinite(v)) return v;
    }
    return null;
  }

  function inferPipFromSymbol(instrumentId) {
    const s = String(instrumentId || "").toUpperCase();
    const clean = s.replace("/", "");
    if (clean.length === 6) {
      const quote = clean.slice(3);
      if (quote === "JPY") return 0.01;
      return 0.0001;
    }
    return 1;
  }

  function getPipSize(instrumentId) {
    const m = getInstrument(instrumentId);
    const fromMeta =
      getFirstFinite(m, ["pipSize", "pip", "point", "tickSize", "priceIncrement", "increment"]) ||
      inferPipFromSymbol(instrumentId);
    return Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : 1;
  }

  function getAccountSnapshot() {
    const Framework = Core.ensureFramework();
    const candidates = [];

    if (Framework.Account) candidates.push(Framework.Account);
    if (Framework.Accounts) {
      if (Framework.Accounts.current) candidates.push(Framework.Accounts.current);
      if (typeof Framework.Accounts.getCurrent === "function") {
        try {
          const c = Framework.Accounts.getCurrent();
          if (c) candidates.push(c);
        } catch (e) {}
      }
      if (Framework.Accounts._dict && typeof Framework.Accounts._dict === "object") {
        const keys = Object.keys(Framework.Accounts._dict);
        for (let i = 0; i < keys.length; i++) {
          candidates.push(Framework.Accounts._dict[keys[i]]);
        }
      }
    }

    let balance = null;
    let equity = null;
    let profitLoss = null;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (balance == null) balance = getFirstFinite(c, ["balance", "accountBalance", "cash", "Balance"]);
      if (equity == null) equity = getFirstFinite(c, ["equity", "accountEquity", "Equity"]);
      if (profitLoss == null) {
        profitLoss = getFirstFinite(c, [
          "profitLoss",
          "pnl",
          "floatingProfitLoss",
          "unrealizedPnl",
          "dailyProfitLoss",
          "ProfitLoss",
          "PnL"
        ]);
      }
      if (balance != null && equity != null && profitLoss != null) break;
    }

    if (profitLoss == null && Framework.Positions && Framework.Positions._dict) {
      const d = Framework.Positions._dict;
      const keys = Object.keys(d);
      let sum = 0;
      let found = 0;
      for (let i = 0; i < keys.length; i++) {
        const p = d[keys[i]];
        const v = getFirstFinite(p, [
          "profitLoss",
          "pnl",
          "floatingProfitLoss",
          "unrealizedPnl",
          "ProfitLoss",
          "PnL"
        ]);
        if (v != null) {
          sum += v;
          found += 1;
        }
      }
      if (found > 0) profitLoss = sum;
    }

    return {
      balance,
      equity,
      profitLoss,
      ok: balance != null || equity != null || profitLoss != null
    };
  }

  async function requestCandles(instrumentId, timeframeSec, count, extra) {
    const Framework = Core.ensureFramework();
    const payload = Object.assign(
      {
        instrumentId,
        timeframe: timeframeSec,
        count,
        streaming: false
      },
      extra && typeof extra === "object" ? extra : {}
    );

    if (Framework.pRequestCandles) {
      return await Framework.pRequestCandles(payload);
    }

    return await new Promise((resolve) => {
      Framework.RequestCandles(payload, (m) => resolve(m));
    });
  }

  function candlesToChron(candlesNewestFirst) {
    return candlesNewestFirst.slice().reverse();
  }

  LCPro.MarketData = {
    TF_SECONDS,
    getInstrument,
    requestPrices,
    getBidAsk,
    getPipSize,
    getAccountSnapshot,
    requestCandles,
    candlesToChron
  };
})();
