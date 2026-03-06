(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function fmtTime(x) {
    try {
      const d = new Date(x);
      if (!isNaN(d.getTime())) return d.toLocaleString();
    } catch (e) {
      return String(x);
    }
    return String(x);
  }

  function getInputs() {
    return {
      instrumentId: $("sym").value,
      timeframeSec: parseInt($("tfSec").value, 10),
      lookback: Math.max(200, parseInt($("lookback").value || "900", 10)),
      fastLen: Math.max(2, parseInt($("fastLen").value || "9", 10)),
      slowLen: Math.max(3, parseInt($("slowLen").value || "21", 10))
    };
  }

  function setTab(tabName) {
    const tabs = ["Home", "Strategy", "Tools"];
    tabs.forEach((name) => {
      const tabEl = $("tab" + name);
      const pageEl = $("page" + name);
      if (tabEl) tabEl.classList.toggle("active", name === tabName);
      if (pageEl) pageEl.classList.toggle("hidden", name !== tabName);
    });
  }

  function initTabs() {
    ["Home", "Strategy", "Tools"].forEach((name) => {
      const tabEl = $("tab" + name);
      if (tabEl) {
        tabEl.addEventListener("click", function () {
          setTab(name);
        });
      }
    });
  }

  function initStrategyTab() {
    const strategySelect = $("strategySelect");
    const strategyInfo = $("strategyInfo");
    const registry = window.LCPro.Strategy && window.LCPro.Strategy.STRATEGIES;

    if (!strategySelect || !strategyInfo || !registry) return;

    const items = Object.keys(registry).map((k) => registry[k]);
    strategySelect.innerHTML = items
      .map((s) => '<option value="' + s.id + '">' + s.name + "</option>")
      .join("");

    function renderStrategyInfo() {
      const id = strategySelect.value;
      const selected = items.find((s) => s.id === id);
      if (!selected) {
        strategyInfo.textContent = "No strategy selected.";
        return;
      }
      strategyInfo.textContent = "ID: " + selected.id + " | " + (selected.notes || "No notes");
    }

    strategySelect.addEventListener("change", renderStrategyInfo);
    renderStrategyInfo();
  }

  function initToolsTab() {
    const out = $("toolsOutput");
    const write = function (obj) {
      if (!out) return;
      try {
        out.textContent = typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
      } catch (e) {
        out.textContent = String(obj);
      }
    };

    const btnHealthCheck = $("btnHealthCheck");
    const btnDumpState = $("btnDumpState");
    const btnTestCalc = $("btnTestCalc");
    const btnTestBuyTpSl = $("btnTestBuyTpSl");
    const btnTestSellTpSl = $("btnTestSellTpSl");

    function readToolTradeInput() {
      return {
        instrument: $("toolInstrument") ? $("toolInstrument").value : "NAS100",
        lots: $("toolLots") ? Number($("toolLots").value) : 0.01,
        tpTicks: $("toolTpTicks") ? Number($("toolTpTicks").value) : 55,
        slTicks: $("toolSlTicks") ? Number($("toolSlTicks").value) : 55,
        tickSize: $("toolTickSize") ? Number($("toolTickSize").value) : 1
      };
    }

    async function runEntryTpSlTest(side) {
      const input = readToolTradeInput();

      // Price refresh before absolute TP/SL calculation
      try {
        window.LCPro.MarketData.requestPrices([input.instrument]);
      } catch (e) {}

      write("Submitting " + side + " test order with entry-then-modify flow...");
      try {
        const res = await window.LCPro.Trading.entryThenModify(
          input.instrument,
          side,
          input.lots,
          input.tpTicks,
          input.slTicks,
          input.tickSize
        );
        write({
          action: side + " test order",
          instrument: input.instrument,
          lots: input.lots,
          tpTicks: input.tpTicks,
          slTicks: input.slTicks,
          tickSize: input.tickSize,
          result: res
        });
      } catch (e) {
        write({
          action: side + " test order",
          error: e && e.message ? e.message : String(e)
        });
      }
    }

    if (btnHealthCheck) {
      btnHealthCheck.addEventListener("click", function () {
        write(window.LCPro.Debug.healthCheck());
      });
    }

    if (btnDumpState) {
      btnDumpState.addEventListener("click", function () {
        write(window.LCPro.Debug.dumpOrderPositionState());
      });
    }

    if (btnTestCalc) {
      btnTestCalc.addEventListener("click", function () {
        const instrument = $("toolInstrument") ? $("toolInstrument").value : "NAS100";
        const side = $("toolSide") ? $("toolSide").value : "BUY";
        const tpTicks = $("toolTpTicks") ? Number($("toolTpTicks").value) : 55;
        const slTicks = $("toolSlTicks") ? Number($("toolSlTicks").value) : 55;
        const tickSize = $("toolTickSize") ? Number($("toolTickSize").value) : 1;
        const calc = window.LCPro.Trading.calcTpSlAbsolute(instrument, side, tpTicks, slTicks, tickSize);
        write(calc);
      });
    }

    if (btnTestBuyTpSl) {
      btnTestBuyTpSl.addEventListener("click", function () {
        runEntryTpSlTest("BUY");
      });
    }

    if (btnTestSellTpSl) {
      btnTestSellTpSl.addEventListener("click", function () {
        runEntryTpSlTest("SELL");
      });
    }
  }

  function renderSignals(signals) {
    if (!signals.length) {
      $("results").innerHTML = '<div class="small">No signals found. Try increasing lookback or adjusting SMA lengths.</div>';
      return;
    }

    let html =
      '<div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>Signal</th><th>Time</th><th>Price</th></tr></thead><tbody>';

    signals.forEach((s, i) => {
      const cls = s.type === "BUY" ? "buy" : "sell";
      html +=
        "<tr><td>" +
        (i + 1) +
        '</td><td class="' +
        cls +
        '">' +
        s.type +
        "</td><td>" +
        fmtTime(s.time) +
        "</td><td>" +
        Number(s.price).toFixed(2) +
        "</td></tr>";
    });

    html += "</tbody></table></div>";
    $("results").innerHTML = html;
  }

  function refreshPx() {
    const MarketData = window.LCPro.MarketData;
    const input = getInputs();
    const m = MarketData.getInstrument(input.instrumentId);
    $("px").textContent = "bid/ask: " + m.bid + " / " + m.ask;
  }

  async function runBacktest(log, setStatus) {
    const input = getInputs();

    setStatus("Pulling candles...", "warn");
    log(
      "Run start: " +
        input.instrumentId +
        " tf=" +
        input.timeframeSec +
        " lookback=" +
        input.lookback +
        " fast=" +
        input.fastLen +
        " slow=" +
        input.slowLen
    );

    try {
      try {
        window.LCPro.MarketData.requestPrices([input.instrumentId]);
      } catch (e) {}

      const signals = await window.LCPro.Backtest.lastCrossSignals(
        input.instrumentId,
        input.timeframeSec,
        input.lookback,
        input.fastLen,
        input.slowLen,
        5
      );

      renderSignals(signals);
      setStatus("Done", "ok");
      log("Run done. Found " + signals.length + " signals.");
      if (signals.length) {
        log("Most recent: " + signals[0].type + " @ " + fmtTime(signals[0].time) + " price=" + signals[0].price);
      }
    } catch (e) {
      setStatus("Failed (see log)", "bad");
      log("[ERR] Error: " + (e.message || String(e)));
    }
  }

  async function dumpSampleCandle(log) {
    try {
      const input = getInputs();
      const msg = await window.LCPro.MarketData.requestCandles(
        input.instrumentId,
        input.timeframeSec,
        Math.min(300, input.lookback)
      );
      const candles = msg && msg.candles ? msg.candles : null;
      if (!candles || !candles.length) {
        log("No candles returned");
        return;
      }
      log("Sample candle[0] (forming/newest): " + window.LCPro.Core.safeJson(candles[0]));
      if (candles[1]) log("Sample candle[1] (last closed): " + window.LCPro.Core.safeJson(candles[1]));
    } catch (e) {
      log("Dump candle failed: " + (e.message || String(e)));
    }
  }

  function setup() {
    const Framework = window.LCPro.Core.ensureFramework();
    const log = window.LCPro.Debug.createLogger($("log"));
    const setStatus = (text, cls) => window.LCPro.Debug.setStatus($("status"), text, cls);

    initTabs();
    initStrategyTab();
    initToolsTab();
    setTab("Home");

    Framework.OnLoad = function () {
      setStatus("Connected", "ok");
      log("[OK] Framework loaded");

      $("btnRun").disabled = false;
      $("btnDumpCandle").disabled = false;
      $("btnClearLog").disabled = false;

      $("btnRun").onclick = function () {
        runBacktest(log, setStatus);
      };
      $("btnDumpCandle").onclick = function () {
        dumpSampleCandle(log);
      };
      $("btnClearLog").onclick = function () {
        $("log").textContent = "";
      };

      try {
        window.LCPro.MarketData.requestPrices([getInputs().instrumentId]);
      } catch (e) {}
      refreshPx();

      setInterval(function () {
        try {
          window.LCPro.MarketData.requestPrices([getInputs().instrumentId]);
          refreshPx();
        } catch (e) {}
      }, 1000);

      $("sym").addEventListener("change", function () {
        try {
          window.LCPro.MarketData.requestPrices([getInputs().instrumentId]);
        } catch (e) {}
        refreshPx();
      });
    };

    Framework.OnPriceChange = function () {
      refreshPx();
    };

    window.LCPro.App = {
      refreshPx,
      runBacktest: function () {
        return runBacktest(log, setStatus);
      },
      dumpSampleCandle: function () {
        return dumpSampleCandle(log);
      }
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  } else {
    setup();
  }
})();
