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

  async function requestCandles(instrumentId, timeframeSec, count) {
    const Framework = Core.ensureFramework();

    if (Framework.pRequestCandles) {
      return await Framework.pRequestCandles({
        instrumentId,
        timeframe: timeframeSec,
        count,
        streaming: false
      });
    }

    return await new Promise((resolve) => {
      Framework.RequestCandles(
        { instrumentId, timeframe: timeframeSec, count, streaming: false },
        (m) => resolve(m)
      );
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
    requestCandles,
    candlesToChron
  };
})();
