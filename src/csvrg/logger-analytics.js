(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  const CsvrgState = (LCPro.CSVRG && LCPro.CSVRG.State) || {};
  LCPro.CSVRG = LCPro.CSVRG || {};

  function nowIso() {
    return new Date().toISOString();
  }

  function push(state, type, payload) {
    const event = Object.assign({ type, timestamp: nowIso() }, payload || {});
    CsvrgState.appendEvent(state, event);
    return event;
  }

  function log_setup(state, pair, snapshot) {
    return push(state, "SETUP", { pair, snapshot: snapshot || null });
  }

  function log_trade_open(state, pair, trade) {
    return push(state, "TRADE_OPEN", { pair, trade: trade || null });
  }

  function log_trade_close(state, pair, trade) {
    return push(state, "TRADE_CLOSE", { pair, trade: trade || null });
  }

  function log_risk_event(state, event) {
    return push(state, "RISK", { event: event || null });
  }

  LCPro.CSVRG.LoggerAnalytics = {
    log_setup,
    log_trade_open,
    log_trade_close,
    log_risk_event
  };
})();
