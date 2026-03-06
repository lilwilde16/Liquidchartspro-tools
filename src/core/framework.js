(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});

  function safeJson(x) {
    try {
      return JSON.stringify(x);
    } catch (e) {
      return "(unstringifiable)";
    }
  }

  function ensureFramework() {
    if (!window.Sway || typeof window.Sway.Framework !== "function") {
      throw new Error("Sway.Framework is unavailable. Load inside LiquidCharts widget context.");
    }
    if (!LCPro.framework) {
      LCPro.framework = new window.Sway.Framework();
    }
    return LCPro.framework;
  }

  LCPro.Core = LCPro.Core || {};
  LCPro.Core.safeJson = safeJson;
  LCPro.Core.ensureFramework = ensureFramework;
})();
