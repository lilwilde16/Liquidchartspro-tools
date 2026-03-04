/**
 * trading-api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralised trading API reference for LiquidChartsPro strategies.
 *
 * All functions live on  window.LC.api  (populated by lc-framework.js).
 * Strategies should call them through  window.LC.tradingAPI  (this module),
 * which validates availability at runtime and keeps strategy code clean.
 *
 * IMPORTANT:  ARM must be ON (toolArm = "on") for any live order to execute.
 *             With ARM OFF every order call opens a Deal Ticket instead.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AVAILABLE FUNCTIONS
 * ───────────────────
 *
 * 1. buyEntry(instrumentId, lotSize, tpAbsPrice, slAbsPrice)
 *    ──────────────────────────────────────────────────────
 *    Places a BUY market order then immediately attaches TP and SL via
 *    CHANGE (101).  TP must be ABOVE entry, SL must be BELOW entry —
 *    lc-framework enforces this automatically when tpIsPips=false.
 *    Returns: { orderId, entryResponse, changeResponse, status }
 *
 * 2. sellEntry(instrumentId, lotSize, tpAbsPrice, slAbsPrice)
 *    ───────────────────────────────────────────────────────
 *    Places a SELL market order then attaches TP and SL via CHANGE (101).
 *    TP must be BELOW entry, SL must be ABOVE entry — direction is handled
 *    automatically; just pass the correct absolute prices for each side.
 *    Returns: { orderId, entryResponse, changeResponse, status }
 *
 * 3. changeTPSL(orderId, tpAbsPrice, slAbsPrice)
 *    ────────────────────────────────────────────
 *    Modifies the TP and SL of an existing open order using CHANGE (101).
 *    Use after an entry if you want to move levels on an open trade.
 *    Returns: platform response object
 *
 * 4. closeAll()
 *    ──────────
 *    Closes ALL open long and short positions across every instrument.
 *    Use before a strategy re-enters or at end-of-day shutdown.
 *    Returns: undefined (each close result is logged)
 *
 * 5. closeOne(orderId)
 *    ──────────────────
 *    Closes a single order / ticket by its numeric or string orderId.
 *    Looks up the order in the Orders dict to include instrumentId in the
 *    payload; falls back gracefully if the order is not in the local dict.
 *    Returns: platform response object
 *
 * 6. openTicket(instrumentId)
 *    ─────────────────────────
 *    Opens the platform Deal Ticket dialog for manual review before sending.
 *    Safe to call regardless of ARM state.
 *    Returns: undefined
 *
 * 7. dumpOrders()
 *    ────────────
 *    Logs all open orders and positions to the UI log panel for inspection.
 *    Returns: undefined
 *
 * 8. getMarket(instrumentId)
 *    ─────────────────────────
 *    Returns the live { bid, ask } object for an instrument.
 *    Returns: { bid: number, ask: number }
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STRATEGY USAGE EXAMPLE
 * ──────────────────────
 *
 *   const api = window.LC.tradingAPI;
 *
 *   // Buy EUR/USD at market, TP = 1.09500, SL = 1.08800
 *   const result = await api.buyEntry("EUR/USD", 0.01, 1.09500, 1.08800);
 *   if (result.status === "tpsl_attached") {
 *     console.log("Entry placed, orderId:", result.orderId);
 *   }
 *
 *   // Sell NAS100 at market, TP = 17000, SL = 17200
 *   await api.sellEntry("NAS100", 0.01, 17000, 17200);
 *
 *   // Close all open positions
 *   await api.closeAll();
 *
 *   // Close a single order
 *   await api.closeOne("987654");
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
(function(){
  "use strict";

  function ensureApi(){
    if(!window.LC || !window.LC.api){
      throw new Error("LC API not ready. Ensure lc-framework.js has loaded and Framework.OnLoad has fired.");
    }
    return window.LC.api;
  }

  /**
   * BUY entry → CHANGE TP/SL.
   * TP above entry price, SL below entry price.
   * @param {string}  instrumentId  e.g. "EUR/USD", "NAS100"
   * @param {number}  lotSize       e.g. 0.01
   * @param {number}  tpAbsPrice    Absolute TP price (above current ask)
   * @param {number}  slAbsPrice    Absolute SL price (below current ask)
   * @returns {Promise<{orderId:string|null, status:string}>}
   */
  async function buyEntry(instrumentId, lotSize, tpAbsPrice, slAbsPrice){
    return ensureApi().placeMarketThenAttachTPSL(
      instrumentId, true, Number(lotSize), Number(tpAbsPrice), Number(slAbsPrice), false
    );
  }

  /**
   * SELL entry → CHANGE TP/SL.
   * TP below entry price, SL above entry price.
   * @param {string}  instrumentId  e.g. "EUR/USD", "NAS100"
   * @param {number}  lotSize       e.g. 0.01
   * @param {number}  tpAbsPrice    Absolute TP price (below current bid)
   * @param {number}  slAbsPrice    Absolute SL price (above current bid)
   * @returns {Promise<{orderId:string|null, status:string}>}
   */
  async function sellEntry(instrumentId, lotSize, tpAbsPrice, slAbsPrice){
    return ensureApi().placeMarketThenAttachTPSL(
      instrumentId, false, Number(lotSize), Number(tpAbsPrice), Number(slAbsPrice), false
    );
  }

  /**
   * Modify TP and SL on an existing open order (CHANGE 101).
   * @param {string}  orderId       The order's numeric ID as string
   * @param {number}  tpAbsPrice    New absolute TP price
   * @param {number}  slAbsPrice    New absolute SL price
   * @returns {Promise<object>}     Platform response
   */
  async function changeTPSL(orderId, tpAbsPrice, slAbsPrice){
    return ensureApi().changeOrderTPSL(String(orderId), Number(tpAbsPrice), Number(slAbsPrice));
  }

  /**
   * Close ALL open positions across every instrument (global close).
   * Useful before a strategy re-enters or shuts down.
   * @returns {Promise<void>}
   */
  async function closeAll(){
    return ensureApi().closeAllPositions();
  }

  /**
   * Close a single order by its ID (CLOSETRADE 4).
   * @param {string|number}  orderId  The order's numeric ID
   * @returns {Promise<object>}       Platform response
   */
  async function closeOne(orderId){
    return ensureApi().closeOrderById(String(orderId));
  }

  /**
   * Open the platform Deal Ticket for an instrument (no live order sent).
   * @param {string}  instrumentId
   */
  function openTicket(instrumentId){
    ensureApi().openDealTicket(instrumentId);
  }

  /**
   * Dump all open orders and positions to the log panel.
   */
  function dumpOrders(){
    ensureApi().dumpOpenTradeSources();
  }

  /**
   * Get the live bid/ask for an instrument.
   * @param {string}  instrumentId
   * @returns {{ bid: number, ask: number }}
   */
  function getMarket(instrumentId){
    return ensureApi().market(instrumentId);
  }

  // ── Expose on window.LC.tradingAPI ──────────────────────────────────────
  window.LC = window.LC || {};
  window.LC.tradingAPI = {
    buyEntry,
    sellEntry,
    changeTPSL,
    closeAll,
    closeOne,
    openTicket,
    dumpOrders,
    getMarket
  };
})();
