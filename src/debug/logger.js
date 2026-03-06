(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});

  function ts() {
    const d = new Date();
    const pad = (n) => (n < 10 ? "0" : "") + n;
    let h = d.getHours();
    const m = d.getMinutes();
    const s = d.getSeconds();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return "[" + h + ":" + pad(m) + ":" + pad(s) + " " + ampm + "]";
  }

  function createLogger(logElement) {
    return function log(msg) {
      const line = ts() + " " + msg;
      if (logElement) {
        logElement.textContent = line + "\n" + logElement.textContent;
      }
      console.log(line);
    };
  }

  function setStatus(statusElement, text, cls) {
    if (!statusElement) return;
    statusElement.textContent = text;
    statusElement.className = "pill " + (cls || "warn");
  }

  function healthCheck() {
    const Framework = window.LCPro && window.LCPro.Core ? window.LCPro.Core.ensureFramework() : null;
    const hasCandles = !!(Framework && (Framework.pRequestCandles || Framework.RequestCandles));
    const hasSendOrder = !!(Framework && typeof Framework.SendOrder === "function");
    const hasOrders = !!(Framework && Framework.Orders);
    const hasPositions = !!(Framework && Framework.Positions);

    return {
      hasCandles,
      hasSendOrder,
      hasOrders,
      hasPositions
    };
  }

  function dumpOrderPositionState() {
    const Trading = window.LCPro && window.LCPro.Trading;
    if (!Trading) return { orders: {}, positions: {} };
    return {
      orders: Trading.getOrderDict(),
      positions: Trading.getPositionDict()
    };
  }

  LCPro.Debug = {
    ts,
    createLogger,
    setStatus,
    healthCheck,
    dumpOrderPositionState
  };
})();
