(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let uiInitialized = false;

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
    const tabs = ["Home", "Strategy", "Backtester", "Tools"];
    tabs.forEach((name) => {
      const tabEl = $("tab" + name);
      const pageEl = $("page" + name);
      if (tabEl) tabEl.classList.toggle("active", name === tabName);
      if (pageEl) pageEl.classList.toggle("hidden", name !== tabName);
    });
  }

  function initTabs() {
    ["Home", "Strategy", "Backtester", "Tools"].forEach((name) => {
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

  function renderSignals(signals, targetId) {
    const target = $(targetId || "results");
    if (!target) return;

    if (!signals.length) {
      target.innerHTML = '<div class="small">No signals found. Try increasing lookback or adjusting strategy params.</div>';
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
    target.innerHTML = html;
  }

  function initBacktesterTab() {
    const strategySelect = $("btStrategySelect");
    const strategyInfo = $("btInfo");
    const paramsInput = $("btParams");
    const btnRun = $("btnRunStrategyBacktest");
    const btnReset = $("btnResetBtParams");
    const statusEl = $("btStatus");
    const log = window.LCPro.Debug.createLogger($("btLog"));
    const setStatus = (text, cls) => window.LCPro.Debug.setStatus(statusEl, text, cls);

    const strategyApi = window.LCPro.Strategy;
    const registry = strategyApi && strategyApi.STRATEGIES;
    if (!strategySelect || !strategyInfo || !paramsInput || !btnRun || !btnReset || !registry) return;

    const items = Object.keys(registry).map((k) => registry[k]);
    strategySelect.innerHTML = items
      .map((s) => '<option value="' + s.id + '">' + s.name + "</option>")
      .join("");

    function getBacktestInputs() {
      let params = {};
      const raw = paramsInput.value || "{}";
      try {
        params = JSON.parse(raw);
      } catch (e) {
        throw new Error("Params JSON is invalid");
      }

      return {
        strategyId: strategySelect.value,
        instrumentId: $("btSym") ? $("btSym").value : "NAS100",
        timeframeSec: parseInt($("btTfSec") ? $("btTfSec").value : "900", 10),
        lookback: Math.max(200, parseInt($("btLookback") ? $("btLookback").value || "900" : "900", 10)),
        keepN: Math.max(1, parseInt($("btKeepN") ? $("btKeepN").value || "5" : "5", 10)),
        params
      };
    }

    function updateStrategyInfo() {
      const s = strategyApi.getStrategy(strategySelect.value);
      if (!s) {
        strategyInfo.textContent = "No strategy selected.";
        return;
      }

      strategyInfo.textContent =
        "ID: " + s.id + " | " + (s.notes || "No notes") + " | defaultParams=" + JSON.stringify(s.defaultParams || {});
    }

    function resetParamsToDefault() {
      const s = strategyApi.getStrategy(strategySelect.value);
      paramsInput.value = JSON.stringify((s && s.defaultParams) || {}, null, 0);
      updateStrategyInfo();
    }

    async function runSelectedStrategyBacktest() {
      setStatus("Running...", "warn");
      try {
        const input = getBacktestInputs();
        log(
          "Backtest run: " +
            input.strategyId +
            " " +
            input.instrumentId +
            " tf=" +
            input.timeframeSec +
            " lookback=" +
            input.lookback +
            " keep=" +
            input.keepN
        );

        const signals = await strategyApi.runSignals(input.strategyId, input);
        renderSignals(signals, "btResults");
        setStatus("Done", "ok");
        log("Backtest done. Found " + signals.length + " signals.");
      } catch (e) {
        setStatus("Failed", "bad");
        log("[ERR] " + (e && e.message ? e.message : String(e)));
      }
    }

    strategySelect.addEventListener("change", function () {
      resetParamsToDefault();
    });
    btnRun.addEventListener("click", runSelectedStrategyBacktest);
    btnReset.addEventListener("click", resetParamsToDefault);

    updateStrategyInfo();
    if (!paramsInput.value || paramsInput.value.trim() === "") resetParamsToDefault();

    window.LCPro.AppBacktester = {
      run: runSelectedStrategyBacktest,
      resetParams: resetParamsToDefault,
      setEnabled: function (enabled) {
        btnRun.disabled = !enabled;
      },
      setStatus
    };
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

    write("Tools ready. Use buttons to run checks or test orders.");

    const btnHealthCheck = $("btnHealthCheck");
    const btnDumpState = $("btnDumpState");
    const btnRefreshOrders = $("btnRefreshOrders");
    const btnTestCalc = $("btnTestCalc");
    const btnTestBuyTpSl = $("btnTestBuyTpSl");
    const btnTestSellTpSl = $("btnTestSellTpSl");
    const btnChangeTpSlSelected = $("btnChangeTpSlSelected");
    const btnCloseAllPositions = $("btnCloseAllPositions");
    const btnCloseOrderById = $("btnCloseOrderById");
    const toolOrderId = $("toolOrderId");
    let entrySubmitInFlight = false;

    function readToolTradeInput() {
      return {
        instrument: $("toolInstrument") ? $("toolInstrument").value : "NAS100",
        lots: $("toolLots") ? Number($("toolLots").value) : 0.01,
        side: $("toolSide") ? $("toolSide").value : "BUY",
        tpTicks: $("toolTpTicks") ? Number($("toolTpTicks").value) : 55,
        slTicks: $("toolSlTicks") ? Number($("toolSlTicks").value) : 55,
        tickSize: $("toolTickSize") ? Number($("toolTickSize").value) : 1
      };
    }

    function inferOrderSide(orderRaw, fallbackSide) {
      if (!orderRaw || typeof orderRaw !== "object") return fallbackSide;
      const dir = String(orderRaw.direction || orderRaw.side || "").toUpperCase();
      if (dir === "BUY" || dir === "LONG") return "BUY";
      if (dir === "SELL" || dir === "SHORT") return "SELL";

      const action = Number(orderRaw.tradingAction || orderRaw.orderType || NaN);
      if (action === 1) return "BUY";
      if (action === 2) return "SELL";
      return fallbackSide;
    }

    function inferOrderSideLabel(orderRaw) {
      const side = inferOrderSide(orderRaw, "");
      if (side === "BUY" || side === "SELL") return side;
      return "UNKNOWN";
    }

    async function runEntryWithTpSlTest(side) {
      if (entrySubmitInFlight) {
        write("Entry already in progress. Please wait.");
        return;
      }
      entrySubmitInFlight = true;

      const input = readToolTradeInput();

      // Price refresh before absolute TP/SL calculation
      try {
        window.LCPro.MarketData.requestPrices([input.instrument]);
      } catch (e) {}

      write("Submitting " + side + " entry, then applying TP/SL via CHANGE 101...");
      try {
        // Ensure framework exists at click time so failures are visible to user.
        window.LCPro.Core.ensureFramework();
        const res = await window.LCPro.Trading.entryThenModify(
          input.instrument,
          side,
          input.lots,
          input.tpTicks,
          input.slTicks,
          input.tickSize
        );
        write({
          action: side + " entry_then_change_101",
          instrument: input.instrument,
          lots: input.lots,
          tpTicks: input.tpTicks,
          slTicks: input.slTicks,
          tickSize: input.tickSize,
          result: res
        });
        setTimeout(refreshOrderDropdown, 700);
      } catch (e) {
        write({
          action: side + " entry_then_change_101",
          error: e && e.message ? e.message : String(e)
        });
      } finally {
        entrySubmitInFlight = false;
      }
    }

    async function changeTpSlSelectedOrder() {
      const input = readToolTradeInput();
      const id = toolOrderId ? toolOrderId.value : "";
      if (!id) {
        write("Select an order id first.");
        return;
      }

      try {
        window.LCPro.Core.ensureFramework();
        const orderRaw = window.LCPro.Trading.getOrder(id);
        const instrument =
          (orderRaw && (orderRaw.instrumentId || orderRaw.instrument || orderRaw.symbol)) || input.instrument;
        const side = inferOrderSide(orderRaw, input.side || "BUY");

        const calc = window.LCPro.Trading.calcTpSlAbsolute(
          instrument,
          side,
          input.tpTicks,
          input.slTicks,
          input.tickSize
        );
        if (!calc.ok) {
          write({ action: "change_tpsl_selected", orderId: id, reason: calc.reason });
          return;
        }

        const mod = await window.LCPro.Trading.modifyOrderTpSl(id, calc.tp, calc.sl);
        write({
          action: "change_tpsl_selected",
          orderId: id,
          instrument,
          side,
          tp: calc.tp,
          sl: calc.sl,
          result: mod
        });
      } catch (e) {
        write({
          action: "change_tpsl_selected",
          orderId: id,
          error: e && e.message ? e.message : String(e)
        });
      }
    }

    function refreshOrderDropdown() {
      if (!toolOrderId) return;

      let orders = [];
      try {
        orders = window.LCPro.Trading.listOpenOrdersDetailed();
      } catch (e) {
        toolOrderId.innerHTML = '<option value="">-- Orders unavailable --</option>';
        return;
      }

      if (!orders.length) {
        toolOrderId.innerHTML = '<option value="">-- No open orders --</option>';
        return;
      }

      const prev = toolOrderId.value;
      const opts = ['<option value="">-- Select order --</option>'];
      for (let i = 0; i < orders.length; i++) {
        const id = String(orders[i].orderId || "");
        const instrument = orders[i].instrumentId || "Unknown";
        const side = inferOrderSideLabel(orders[i].raw);
        if (!id) continue;
        opts.push('<option value="' + id + '">' + instrument + " | " + side + " | #" + id + "</option>");
      }
      toolOrderId.innerHTML = opts.join("");
      if (prev && orders.some((o) => String(o.orderId) === prev)) toolOrderId.value = prev;
    }

    if (btnHealthCheck) {
      btnHealthCheck.addEventListener("click", function () {
        write(window.LCPro.Debug.healthCheck());
      });
    }

    if (btnDumpState) {
      btnDumpState.addEventListener("click", function () {
        write(window.LCPro.Debug.dumpOrderPositionState());
        refreshOrderDropdown();
      });
    }

    if (btnRefreshOrders) {
      btnRefreshOrders.addEventListener("click", function () {
        refreshOrderDropdown();
        write("Order dropdown refreshed.");
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
      btnTestBuyTpSl.onclick = async function () {
        btnTestBuyTpSl.disabled = true;
        try {
          await runEntryWithTpSlTest("BUY");
        } finally {
          btnTestBuyTpSl.disabled = false;
        }
      };
    }

    if (btnTestSellTpSl) {
      btnTestSellTpSl.onclick = async function () {
        btnTestSellTpSl.disabled = true;
        try {
          await runEntryWithTpSlTest("SELL");
        } finally {
          btnTestSellTpSl.disabled = false;
        }
      };
    }

    if (btnChangeTpSlSelected) {
      btnChangeTpSlSelected.addEventListener("click", function () {
        changeTpSlSelectedOrder();
      });
    }

    if (btnCloseAllPositions) {
      btnCloseAllPositions.addEventListener("click", async function () {
        write("Closing all open positions...");
        try {
          const res = await window.LCPro.Trading.closeAllPositions();
          write({ action: "close_all_positions", result: res });
          refreshOrderDropdown();
        } catch (e) {
          write({ action: "close_all_positions", error: e && e.message ? e.message : String(e) });
        }
      });
    }

    if (btnCloseOrderById) {
      btnCloseOrderById.addEventListener("click", async function () {
        const id = toolOrderId ? toolOrderId.value : "";
        if (!id) {
          write("Select an order id first.");
          return;
        }
        write("Closing selected order id #" + id + " ...");
        try {
          const res = await window.LCPro.Trading.closeOrderById(id);
          write({
            action: "close_order_by_id",
            orderId: id,
            usedFallback: !!(res && res.fallbackUsed),
            result: res
          });
          refreshOrderDropdown();
        } catch (e) {
          write({ action: "close_order_by_id", orderId: id, error: e && e.message ? e.message : String(e) });
        }
      });
    }

    refreshOrderDropdown();
    setInterval(refreshOrderDropdown, 5000);
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

      const signals = await window.LCPro.Strategy.runSignals("sma_crossover", {
        strategyId: "sma_crossover",
        instrumentId: input.instrumentId,
        timeframeSec: input.timeframeSec,
        lookback: input.lookback,
        keepN: 5,
        params: {
          fastLen: input.fastLen,
          slowLen: input.slowLen
        }
      });

      renderSignals(signals, "results");
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
    const log = window.LCPro.Debug.createLogger($("log"));
    const setStatus = (text, cls) => window.LCPro.Debug.setStatus($("status"), text, cls);

    if (!uiInitialized) {
      initTabs();
      initStrategyTab();
      initBacktesterTab();
      initToolsTab();
      setTab("Home");
      uiInitialized = true;
    }

    let Framework = null;
    try {
      Framework = window.LCPro.Core.ensureFramework();
    } catch (e) {
      setStatus("Waiting for framework...", "warn");
      log("[WARN] Framework not ready yet: " + (e.message || String(e)));
      setTimeout(setup, 1000);
      return;
    }

    Framework.OnLoad = function () {
      setStatus("Connected", "ok");
      log("[OK] Framework loaded");

      $("btnRun").disabled = false;
      $("btnDumpCandle").disabled = false;
      $("btnClearLog").disabled = false;
      if (window.LCPro.AppBacktester) {
        window.LCPro.AppBacktester.setEnabled(true);
        window.LCPro.AppBacktester.setStatus("Connected", "ok");
      }

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
