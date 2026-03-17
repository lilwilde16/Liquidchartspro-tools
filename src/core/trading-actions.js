(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const Core = LCPro.Core || {};
  const MarketData = LCPro.MarketData || {};
  let entryModifyInFlight = false;

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

  function pickFirstString(obj, keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = obj && obj[keys[i]];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  }

  function isExplicitSuccess(res) {
    if (!res || typeof res !== "object") return false;
    if (res.okay === true || res.success === true || res.accepted === true) return true;
    const rc = Number(res.ResultCode);
    const code = Number(res.code);
    if (Number.isFinite(rc) && rc === 0) return true;
    if (Number.isFinite(code) && code === 0) return true;
    return false;
  }

  function getOrderFailureReason(res) {
    if (res == null) return "No response from framework";
    if (typeof res !== "object") return "Unexpected order response: " + String(res);

    const explicitFailure =
      res.okay === false || res.success === false || res.accepted === false || Number(res.ResultCode) < 0;

    const msg = pickFirstString(res, [
      "message",
      "error",
      "errorMessage",
      "reason",
      "statusText",
      "text",
      "ResultMessage",
      "resultMessage"
    ]);

    if (explicitFailure && msg) return msg;
    if (explicitFailure) return "Order was rejected by broker/framework";

    if (!isExplicitSuccess(res) && msg) {
      const lower = msg.toLowerCase();
      if (/(failed|could not|cannot|rejected|invalid|denied|error)/.test(lower)) return msg;
    }

    return "";
  }

  async function sendMarketOrder(instrumentId, side, lots) {
    const payload = {
      instrumentId,
      tradingAction: side === "BUY" ? orderType("BUY", 1) : orderType("SELL", 2),
      volume: { lots: Number(lots) }
    };
    const response = await sendOrder(payload);
    const reason = getOrderFailureReason(response);
    if (reason) {
      return { ok: false, reason, payload, response };
    }
    return { ok: true, payload, response };
  }

  function normalizeSide(raw) {
    const s = String(raw || "").toUpperCase();
    if (s === "BUY" || s === "LONG") return "BUY";
    if (s === "SELL" || s === "SHORT") return "SELL";
    return "";
  }

  function calcTpSlAbsolute(instrumentId, side, tpTicks, slTicks, tickSize) {
    const px = MarketData.getBidAsk(instrumentId);
    if (!px.ok) return { ok: false, reason: "No bid/ask" };

    const unitSize =
      Number.isFinite(Number(tickSize)) && Number(tickSize) > 0
        ? Number(tickSize)
        : Number(MarketData.getPipSize ? MarketData.getPipSize(instrumentId) : 1);

    const tpPts = Number(tpTicks) * unitSize;
    const slPts = Number(slTicks) * unitSize;
    if (!Number.isFinite(tpPts) || !Number.isFinite(slPts)) {
      return { ok: false, reason: "Bad tp/sl/tick" };
    }

    const base = side === "BUY" ? px.ask : px.bid;
    const tp = side === "BUY" ? base + tpPts : base - tpPts;
    const sl = side === "BUY" ? base - slPts : base + slPts;

    return { ok: true, base, tp, sl, bid: px.bid, ask: px.ask, tpPts, slPts, unitSize };
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
    const reason = getOrderFailureReason(res);
    if (reason) return { ok: false, reason, payload, response: res };
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

  function pickTradeIdentifier(obj, fallbackKey) {
    if (!obj || typeof obj !== "object") return fallbackKey ? String(fallbackKey) : "";
    const candidates = [obj.orderId, obj.tradeId, obj.positionId, obj.id, obj.ticket, obj.dealId, fallbackKey];
    for (let i = 0; i < candidates.length; i++) {
      const value = candidates[i];
      if (value != null && String(value).trim()) return String(value);
    }
    return "";
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

  function isTradeLikeObject(obj) {
    if (!obj || typeof obj !== "object") return false;
    return (
      obj.orderId != null ||
      obj.tradeId != null ||
      obj.positionId != null ||
      obj.id != null ||
      obj.ticket != null ||
      obj.instrumentId != null ||
      obj.instrument != null ||
      obj.symbol != null ||
      obj.tradingAction != null ||
      obj.orderType != null ||
      obj.entryPrice != null ||
      obj.openPrice != null ||
      obj.price != null
    );
  }

  function cleanInstrumentId(value) {
    const s = String(value == null ? "" : value).trim();
    if (!s) return "";
    if (s.toLowerCase() === "unknown") return "";
    return s;
  }

  function listOpenOrdersDetailed() {
    const d = getOrderDict();
    const keys = collectDictKeys(d);
    const out = [];

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const o = d[k];
      if (!o || typeof o !== "object") continue;
      if (!isTradeLikeObject(o)) continue;
      const orderId = pickTradeIdentifier(o, k);
      if (!orderId) continue;
      const instrumentId = cleanInstrumentId(o.instrumentId || o.instrument || o.symbol || "");
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

  function listActiveTradesDetailed() {
    const byId = {};
    const orders = listOpenOrdersDetailed();
    const positions = listOpenPositionsDetailed();

    function upsert(item) {
      if (!item || !item.tradeId) return;
      const id = String(item.tradeId);
      const existing = byId[id];
      if (!existing) {
        byId[id] = item;
        return;
      }

      if (!existing.instrumentId && item.instrumentId) {
        byId[id] = item;
        return;
      }

      if (existing.source !== item.source) {
        existing.source = [existing.source, item.source]
          .filter(Boolean)
          .join("+")
          .replace("order+order", "order")
          .replace("position+position", "position");
      }

      if (!existing.raw && item.raw) existing.raw = item.raw;
      if (!existing.instrumentId && item.instrumentId) existing.instrumentId = item.instrumentId;
    }

    for (let i = 0; i < orders.length; i++) {
      const item = orders[i];
      const tradeId = pickTradeIdentifier(item.raw, item.orderId);
      if (!tradeId) continue;
      upsert({
        tradeId,
        instrumentId: cleanInstrumentId(item.instrumentId || ""),
        source: "order",
        raw: item.raw
      });
    }

    for (let i = 0; i < positions.length; i++) {
      const item = positions[i];
      const tradeId = pickTradeIdentifier(item.raw, "");
      if (!tradeId) continue;
      upsert({
        tradeId,
        instrumentId: cleanInstrumentId(item.instrumentId || ""),
        source: "position",
        raw: item.raw
      });
    }

    return Object.keys(byId)
      .map((id) => byId[id])
      .filter((item) => item && item.tradeId);
  }

  function listActiveTradeIds() {
    return listActiveTradesDetailed()
      .map((item) => String(item.tradeId || ""))
      .filter(Boolean);
  }

  function getActiveTradeById(tradeId) {
    const target = String(tradeId || "");
    const all = listActiveTradesDetailed();
    for (let i = 0; i < all.length; i++) {
      if (String(all[i].tradeId) === target) return all[i];
    }
    return null;
  }

  function listOpenPositionsDetailed() {
    const d = getPositionDict();
    const keys = collectDictKeys(d);
    const out = [];

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const p = d[k];
      if (!p || typeof p !== "object") continue;
      if (!isTradeLikeObject(p)) continue;
      const instrumentId = cleanInstrumentId(p.instrumentId || p.instrument || p.symbol || "");
      const tradeId = pickTradeIdentifier(p, "");
      if (!instrumentId && !tradeId) continue;
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
    const id = String(orderId);
    const tradeRef = getActiveTradeById(id);
    const instrumentId =
      tradeRef && tradeRef.instrumentId
        ? String(tradeRef.instrumentId)
        : tradeRef && tradeRef.raw
          ? String(tradeRef.raw.instrumentId || tradeRef.raw.instrument || tradeRef.raw.symbol || "")
          : "";
    const attempts = [];
    const base = {
      tradingAction: orderType("CHANGE", 101),
      tp: Number(tpAbs),
      sl: Number(slAbs)
    };
    const payloads = [
      Object.assign({}, base, { orderId: id }),
      Object.assign({}, base, { tradeId: id }),
      Object.assign({}, base, { positionId: id }),
      Object.assign({}, base, { ticket: id })
    ];

    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      if (instrumentId) payload.instrumentId = instrumentId;
      try {
        const response = await sendOrder(payload);
        const reason = getOrderFailureReason(response);
        attempts.push({ payload, response, reason: reason || "" });
        if (!reason) return { ok: true, reason: "", payload, response, attempts };
      } catch (e) {
        attempts.push({ payload, error: e.message || String(e) });
      }
    }

    const last = attempts.length ? attempts[attempts.length - 1] : null;
    return {
      ok: false,
      reason: (last && last.reason) || (last && last.error) || "Modify TP/SL rejected",
      payload: last ? last.payload : null,
      response: last ? last.response : null,
      attempts
    };
  }

  async function entryThenModify(instrumentId, side, lots, tpTicks, slTicks, tickSize, timeoutMs) {
    if (entryModifyInFlight) {
      return { ok: false, reason: "Entry/modify already in progress" };
    }

    entryModifyInFlight = true;
    try {
      const before = new Set(listActiveTradeIds());
      const entryResult = await sendMarketOrder(instrumentId, side, lots);
      if (!entryResult.ok) {
        return { ok: false, reason: entryResult.reason || "Entry order rejected", entryResponse: entryResult };
      }
      const entryResponse = entryResult.response;

      // Prefer broker-returned id first for immediate modify.
      let newId =
        entryResponse &&
        (entryResponse.orderId || entryResponse.tradeId || entryResponse.positionId || entryResponse.id || entryResponse.ticket || null);
      if (newId) newId = String(newId);

      if (!newId) {
        const deadline = Date.now() + (Number(timeoutMs) || 8000);
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 250));
          const nowIds = listActiveTradeIds();
          for (let i = 0; i < nowIds.length; i++) {
            if (!before.has(nowIds[i])) {
              newId = nowIds[i];
              break;
            }
          }
          if (newId) break;
        }
      }

      if (!newId) {
        return { ok: false, reason: "No new orderId detected after entry", entryResponse };
      }

      const p = calcTpSlAbsolute(instrumentId, side, tpTicks, slTicks, tickSize);
      if (!p.ok) return { ok: false, reason: p.reason, entryResponse, orderId: newId };

      const modify = await modifyOrderTpSl(newId, p.tp, p.sl);
      if (!modify.ok) {
        return {
          ok: false,
          reason: modify.reason || "Modify TP/SL rejected",
          orderId: newId,
          entryResponse,
          tp: p.tp,
          sl: p.sl,
          modifyResponse: modify.response
        };
      }
      return {
        ok: true,
        orderId: newId,
        entryResponse,
        tp: p.tp,
        sl: p.sl,
        modifyResponse: modify.response
      };
    } finally {
      entryModifyInFlight = false;
    }
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

  async function closeSideOnInstrument(instrumentId, side) {
    const s = String(side || "").toUpperCase();
    const action = s === "SELL" ? orderType("CLOSEPOSSHORT", 6) : orderType("CLOSEPOSLONG", 5);
    const payload = { instrumentId, tradingAction: action };
    const response = await sendOrder(payload);
    return { payload, response };
  }

  function inferOrderSide(order) {
    if (!order || typeof order !== "object") return null;

    const sideRaw = String(order.side || order.direction || "").toUpperCase();
    if (sideRaw === "BUY" || sideRaw === "LONG") return "BUY";
    if (sideRaw === "SELL" || sideRaw === "SHORT") return "SELL";

    const action = Number(order.tradingAction || order.orderType || NaN);
    if (action === 1) return "BUY";
    if (action === 2) return "SELL";

    return null;
  }

  async function closeAllPositions() {
    const instrumentIds = listOpenPositionsDetailed().map((p) => p.instrumentId);
    if (!instrumentIds.length) {
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
    const tradeRef = getActiveTradeById(id);
    const order = tradeRef ? tradeRef.raw : getOrder(id);
    const instrumentId =
      tradeRef && tradeRef.instrumentId
        ? tradeRef.instrumentId
        : order && (order.instrumentId || order.instrument || order.symbol || "");
    const entryPrice = Number(
      (order && (order.entryPrice || order.openPrice || order.price || order.rate || order.open)) || NaN
    );

    const attempts = [];
    const closeTradeAction = orderType("CLOSETRADE", 4);

    // On this broker, close-by-id frequently returns code 116 (trade not specified),
    // while side-close succeeds reliably. Prefer side-close when we can infer side.
    const preferredSide = inferOrderSide(order);
    if (instrumentId && preferredSide) {
      const fallbackSide = await closeSideOnInstrument(String(instrumentId), preferredSide);
      return {
        ok: true,
        fallbackUsed: true,
        reason: "Used side close directly to avoid close-by-id broker rejection.",
        instrumentId: String(instrumentId),
        side: preferredSide,
        attempts,
        fallback: fallbackSide
      };
    }

    // Use a single best identifier to avoid repeated broker errors for unsupported id fields.
    const payload = { tradingAction: closeTradeAction };
    if (instrumentId) payload.instrumentId = String(instrumentId);

    const raw = tradeRef && tradeRef.raw ? tradeRef.raw : order;
    const source = String((tradeRef && tradeRef.source) || "");
    const preferredKey =
      source.indexOf("position") >= 0 || (raw && raw.positionId != null)
        ? "positionId"
        : raw && raw.tradeId != null
          ? "tradeId"
          : raw && raw.orderId != null
            ? "orderId"
            : raw && raw.ticket != null
              ? "ticket"
              : "orderId";

    payload[preferredKey] = id;
    if (preferredKey === "orderId" && Number.isFinite(entryPrice) && entryPrice > 0) {
      payload.entryPrice = entryPrice;
      payload.price = entryPrice;
    }

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

    // Fallback: close selected side on selected instrument.
    if (instrumentId) {
      const side = inferOrderSide(order);
      if (side) {
        const fallbackSide = await closeSideOnInstrument(String(instrumentId), side);
        return {
          ok: true,
          fallbackUsed: true,
          reason: "Direct close-by-id did not succeed; used side close fallback.",
          instrumentId: String(instrumentId),
          side,
          attempts,
          fallback: fallbackSide
        };
      }

      const fallback = await closeAllOnInstrument(String(instrumentId));
      return {
        ok: true,
        fallbackUsed: true,
        reason: "Direct close-by-id did not succeed; side unknown so used close-all-on-instrument fallback.",
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

  function listActions() {
    return ["BUY", "SELL", "CLOSE_SIDE", "CLOSE_ALL", "CLOSE_ORDER", "MARKET_ORDER_TPSL"];
  }

  async function executeAction(actionName, payload) {
    const action = String(actionName || "").toUpperCase();
    const p = payload || {};

    if (action === "BUY" || action === "SELL") {
      const side = action;
      const instrumentId = String(p.instrumentId || "");
      const lots = Number(p.lots || p.size_lots || p.sizeLots || 0);
      if (!instrumentId) return { ok: false, reason: "Missing instrumentId" };
      if (!Number.isFinite(lots) || lots <= 0) return { ok: false, reason: "Invalid lots" };

      const tpTicks = Number(p.tpTicks || 0);
      const slTicks = Number(p.slTicks || 0);
      const tickSize = Number(p.tickSize || 0);
      if ((tpTicks > 0 || slTicks > 0) && Number.isFinite(tickSize) && tickSize > 0) {
        return sendMarketOrderWithTpSl(instrumentId, side, lots, Math.max(0, tpTicks), Math.max(0, slTicks), tickSize);
      }
      return sendMarketOrder(instrumentId, side, lots);
    }

    if (action === "MARKET_ORDER_TPSL") {
      const instrumentId = String(p.instrumentId || "");
      const side = normalizeSide(p.side);
      const lots = Number(p.lots || p.size_lots || p.sizeLots || 0);
      const tpTicks = Number(p.tpTicks || 0);
      const slTicks = Number(p.slTicks || 0);
      const tickSize = Number(p.tickSize || 0);
      if (!instrumentId) return { ok: false, reason: "Missing instrumentId" };
      if (!side) return { ok: false, reason: "Missing/invalid side" };
      if (!Number.isFinite(lots) || lots <= 0) return { ok: false, reason: "Invalid lots" };
      if (!Number.isFinite(tickSize) || tickSize <= 0) return { ok: false, reason: "Invalid tickSize" };

      const tp = Math.max(0, Number.isFinite(tpTicks) ? tpTicks : 0);
      const sl = Math.max(0, Number.isFinite(slTicks) ? slTicks : 0);
      if (tp <= 0 && sl <= 0) {
        return sendMarketOrder(instrumentId, side, lots);
      }

      return entryThenModify(instrumentId, side, lots, tp, sl, tickSize);
    }

    if (action === "CLOSE_SIDE") {
      const instrumentId = String(p.instrumentId || "");
      const side = normalizeSide(p.side);
      if (!instrumentId) return { ok: false, reason: "Missing instrumentId" };
      if (!side) return { ok: false, reason: "Missing/invalid side" };
      const res = await closeSideOnInstrument(instrumentId, side);
      return { ok: true, result: res };
    }

    if (action === "CLOSE_ALL") {
      const res = await closeAllPositions();
      return { ok: true, result: res };
    }

    if (action === "CLOSE_ORDER") {
      if (!p.orderId) return { ok: false, reason: "Missing orderId" };
      return closeOrderById(String(p.orderId));
    }

    return { ok: false, reason: "Unknown action: " + action };
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
    listActiveTradesDetailed,
    listActiveTradeIds,
    getActiveTradeById,
    getOrder,
    modifyOrderTpSl,
    entryThenModify,
    closeAllOnInstrument,
    closeSideOnInstrument,
    closeAllPositions,
    closeOrderById,
    listActions,
    executeAction
  };
})();
