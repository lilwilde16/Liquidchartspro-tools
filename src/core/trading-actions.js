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
    const payload = {
      tradingAction: orderType("CLOSETRADE", 4),
      orderId: id
    };

    if (order) {
      const instrumentId = order.instrumentId || order.instrument;
      if (instrumentId) payload.instrumentId = instrumentId;
    }

    try {
      const response = await sendOrder(payload);
      return { payload, response, fallbackUsed: false };
    } catch (e) {
      // If direct close-by-id fails, fallback to closing both sides on this instrument.
      const instrumentId = payload.instrumentId || (order && (order.instrumentId || order.instrument));
      if (!instrumentId) throw e;
      const fallback = await closeAllOnInstrument(String(instrumentId));
      return {
        payload,
        response: { error: e.message || String(e) },
        fallbackUsed: true,
        fallback
      };
    }
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
