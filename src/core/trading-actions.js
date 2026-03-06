(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const Core = LCPro.Core || {};
  const MarketData = LCPro.MarketData || {};

  function orderType(name, fallback) {
    const t = window.Liquid && window.Liquid.OrderTypes;
    return t && Number.isFinite(t[name]) ? t[name] : fallback;
  }

  function openDealTicket(instrumentId) {
    const Framework = Core.ensureFramework();
    Framework.CreateDialog({ type: "dealticket", settings: { instrumentId } });
  }

  function sendOrder(payload) {
    const Framework = Core.ensureFramework();
    return new Promise((resolve, reject) => {
      try {
        Framework.SendOrder(payload, (res) => resolve(res));
      } catch (e) {
        reject(e);
      }
    });
  }

  async function sendMarketOrder(instrumentId, side, lots) {
    const payload = {
      instrumentId,
      tradingAction: side === "BUY" ? orderType("BUY", 1) : orderType("SELL", 2),
      volume: { lots: Number(lots) }
    };
    return await sendOrder(payload);
  }

  function calcTpSlAbsolute(instrumentId, side, tpTicks, slTicks, tickSize) {
    const px = MarketData.getBidAsk(instrumentId);
    if (!px.ok) return { ok: false, reason: "No bid/ask" };

    const tpPts = Number(tpTicks) * Number(tickSize);
    const slPts = Number(slTicks) * Number(tickSize);
    if (!Number.isFinite(tpPts) || !Number.isFinite(slPts)) {
      return { ok: false, reason: "Bad tp/sl/tick" };
    }

    const base = side === "BUY" ? px.ask : px.bid;
    const tp = side === "BUY" ? base + tpPts : base - tpPts;
    const sl = side === "BUY" ? base - slPts : base + slPts;

    return { ok: true, base, tp, sl, bid: px.bid, ask: px.ask, tpPts, slPts };
  }

  async function sendMarketOrderWithTpSl(instrumentId, side, lots, tpTicks, slTicks, tickSize) {
    const p = calcTpSlAbsolute(instrumentId, side, tpTicks, slTicks, tickSize);
    if (!p.ok) return { ok: false, reason: p.reason };

    const payload = {
      instrumentId,
      tradingAction: side === "BUY" ? orderType("BUY", 1) : orderType("SELL", 2),
      volume: { lots: Number(lots) },
      takeProfit: { price: p.tp },
      stopLoss: { price: p.sl }
    };

    const res = await sendOrder(payload);
    return { ok: true, payload, response: res };
  }

  function getOrderDict() {
    const Framework = Core.ensureFramework();
    return Framework.Orders && Framework.Orders._dict ? Framework.Orders._dict : {};
  }

  function getPositionDict() {
    const Framework = Core.ensureFramework();
    return Framework.Positions && Framework.Positions._dict ? Framework.Positions._dict : {};
  }

  function listOpenOrderIds() {
    return listOpenOrdersDetailed().map((o) => String(o.orderId)).filter(Boolean);
  }

  function getOrder(orderId) {
    const target = String(orderId);
    const all = listOpenOrdersDetailed();
    for (let i = 0; i < all.length; i++) {
      if (String(all[i].orderId) === target) return all[i].raw;
    }
    return null;
  }

  function collectDictKeys(dict) {
    const set = new Set();
    if (!dict) return [];
    try {
      Object.keys(dict).forEach((k) => set.add(k));
      Object.getOwnPropertyNames(dict).forEach((k) => set.add(k));
      for (const k in dict) set.add(k);
    } catch (e) {
      return [];
    }
    return Array.from(set);
  }

  function listOpenOrdersDetailed() {
    const d = getOrderDict();
    const keys = collectDictKeys(d);
    const out = [];

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const o = d[k];
      if (!o || typeof o !== "object") continue;
      const orderId = o.orderId || o.id || o.ticket || k;
      const instrumentId = o.instrumentId || o.instrument || o.symbol || "";
      out.push({ orderId: String(orderId), instrumentId: String(instrumentId || ""), raw: o });
    }

    // Dedupe by order id in case keys/properties overlap
    const seen = new Set();
    return out.filter((x) => {
      if (seen.has(x.orderId)) return false;
      seen.add(x.orderId);
      return true;
    });
  }

  function listOpenPositionsDetailed() {
    const d = getPositionDict();
    const keys = collectDictKeys(d);
    const out = [];

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const p = d[k];
      if (!p || typeof p !== "object") continue;
      const instrumentId = p.instrumentId || p.instrument || p.symbol || k;
      out.push({ instrumentId: String(instrumentId || ""), raw: p });
    }

    const seen = new Set();
    return out.filter((x) => {
      if (!x.instrumentId) return false;
      if (seen.has(x.instrumentId)) return false;
      seen.add(x.instrumentId);
      return true;
    });
  }

  async function modifyOrderTpSl(orderId, tpAbs, slAbs) {
    const payload = {
      tradingAction: orderType("CHANGE", 101),
      orderId: String(orderId),
      tp: Number(tpAbs),
      sl: Number(slAbs)
    };
    const res = await sendOrder(payload);
    return { payload, response: res };
  }

  async function entryThenModify(instrumentId, side, lots, tpTicks, slTicks, tickSize, timeoutMs) {
    const before = new Set(listOpenOrderIds());
    const entryResponse = await sendMarketOrder(instrumentId, side, lots);

    const deadline = Date.now() + (Number(timeoutMs) || 8000);
    let newId = null;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      const nowIds = listOpenOrderIds();
      for (let i = 0; i < nowIds.length; i++) {
        if (!before.has(nowIds[i])) {
          newId = nowIds[i];
          break;
        }
      }
      if (newId) break;
    }

    if (!newId) {
      return { ok: false, reason: "No new orderId detected after entry", entryResponse };
    }

    const p = calcTpSlAbsolute(instrumentId, side, tpTicks, slTicks, tickSize);
    if (!p.ok) return { ok: false, reason: p.reason, entryResponse, orderId: newId };

    const modify = await modifyOrderTpSl(newId, p.tp, p.sl);
    return {
      ok: true,
      orderId: newId,
      entryResponse,
      tp: p.tp,
      sl: p.sl,
      modifyResponse: modify.response
    };
  }

  async function closeAllOnInstrument(instrumentId) {
    const out = [];
    try {
      out.push(
        await sendOrder({
          instrumentId,
          tradingAction: orderType("CLOSEPOSLONG", 5)
        })
      );
    } catch (e) {
      out.push({ error: e.message || String(e), side: "long" });
    }

    try {
      out.push(
        await sendOrder({
          instrumentId,
          tradingAction: orderType("CLOSEPOSSHORT", 6)
        })
      );
    } catch (e) {
      out.push({ error: e.message || String(e), side: "short" });
    }
    return out;
  }

  async function closeAllPositions() {
    const instrumentIds = listOpenPositionsDetailed().map((p) => p.instrumentId);
    if (!instrumentIds.length) {
      // Fallback to instruments inferred from open orders.
      const fromOrders = listOpenOrdersDetailed()
        .map((o) => o.instrumentId)
        .filter(Boolean);
      for (let i = 0; i < fromOrders.length; i++) {
        if (instrumentIds.indexOf(fromOrders[i]) < 0) instrumentIds.push(fromOrders[i]);
      }
    }

    const out = [];

    for (let i = 0; i < instrumentIds.length; i++) {
      const instrumentId = instrumentIds[i];
      const res = await closeAllOnInstrument(instrumentId);
      out.push({ instrumentId, result: res });
    }

    return out;
  }

  async function closeOrderById(orderId) {
    const id = String(orderId);
    const order = getOrder(id);
    const instrumentId = order && (order.instrumentId || order.instrument || order.symbol || "");
    const entryPrice = Number(
      (order && (order.entryPrice || order.openPrice || order.price || order.rate || order.open)) || NaN
    );

    const attempts = [];
    const closeTradeAction = orderType("CLOSETRADE", 4);

    // Some brokers require extra fields (like entry/close price) for close-by-id.
    const payloads = [];

    const p1 = { tradingAction: closeTradeAction, orderId: id };
    if (instrumentId) p1.instrumentId = String(instrumentId);
    payloads.push(p1);

    if (Number.isFinite(entryPrice) && entryPrice > 0) {
      const p2 = { tradingAction: closeTradeAction, orderId: id };
      if (instrumentId) p2.instrumentId = String(instrumentId);
      p2.entryPrice = entryPrice;
      p2.price = entryPrice;
      payloads.push(p2);
    }

    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      try {
        const response = await sendOrder(payload);
        attempts.push({ payload, response });
        if (
          response &&
          (response.okay === true || response.success === true || response.code === 0 || response.ResultCode === 0)
        ) {
          return { ok: true, fallbackUsed: false, payload, response, attempts };
        }
      } catch (e) {
        attempts.push({ payload, error: e.message || String(e) });
      }
    }

    // Fallback: close by side on selected instrument.
    if (instrumentId) {
      const fallback = await closeAllOnInstrument(String(instrumentId));
      return {
        ok: true,
        fallbackUsed: true,
        reason: "Direct close-by-id did not succeed; used instrument side close fallback.",
        instrumentId: String(instrumentId),
        attempts,
        fallback
      };
    }

    return {
      ok: false,
      fallbackUsed: false,
      reason: "Unable to close selected order. Missing instrument context and close-by-id variants failed.",
      attempts
    };
  }

  LCPro.Trading = {
    openDealTicket,
    sendOrder,
    sendMarketOrder,
    calcTpSlAbsolute,
    sendMarketOrderWithTpSl,
    getOrderDict,
    getPositionDict,
    listOpenOrderIds,
    listOpenOrdersDetailed,
    listOpenPositionsDetailed,
    getOrder,
    modifyOrderTpSl,
    entryThenModify,
    closeAllOnInstrument,
    closeAllPositions,
    closeOrderById
  };
})();
