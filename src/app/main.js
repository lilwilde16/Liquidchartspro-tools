(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let uiInitialized = false;
  let homeLiveController = null;
  let strategyLiveOverrides = {};

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
    const quickWrap = $("strategyQuickControls");
    const smaTfPreset = $("smaTfPreset");
    const smaFastPreset = $("smaFastPreset");
    const smaSlowPreset = $("smaSlowPreset");
    const smaTpPreset = $("smaTpPreset");
    const smaSlPreset = $("smaSlPreset");
    const liveParamsInput = $("strategyLiveParams");
    const btnSave = $("btnSaveStrategyLiveParams");
    const btnReset = $("btnResetStrategyLiveParams");
    const statusEl = $("strategyParamsStatus");
    const registry = window.LCPro.Strategy && window.LCPro.Strategy.STRATEGIES;

    if (!strategySelect || !strategyInfo || !liveParamsInput || !btnSave || !btnReset || !statusEl || !registry) return;

    const items = Object.keys(registry).map((k) => registry[k]);
    strategySelect.innerHTML = items
      .map((s) => '<option value="' + s.id + '">' + s.name + "</option>")
      .join("");

    function safeParseObject(raw) {
      try {
        const v = JSON.parse(raw || "{}");
        return v && typeof v === "object" ? v : {};
      } catch (e) {
        return {};
      }
    }

    function setSmaQuickVisibility(strategyId) {
      if (!quickWrap) return;
      quickWrap.style.display = strategyId === "sma_crossover" ? "block" : "none";
    }

    function syncQuickControlsFromParams(params) {
      if (!smaTfPreset || !smaFastPreset || !smaSlowPreset || !smaTpPreset || !smaSlPreset) return;
      const p = params || {};
      const tf = String(Number(p.timeframeSec) || 900);
      const fast = String(Number(p.fastLen) || 9);
      const slow = String(Number(p.slowLen) || 21);
      const tp = String(Math.max(0, Number(p.tpTicks) || 0));
      const sl = String(Math.max(0, Number(p.slTicks) || 0));
      if (smaTfPreset.querySelector('option[value="' + tf + '"]')) smaTfPreset.value = tf;
      if (smaFastPreset.querySelector('option[value="' + fast + '"]')) smaFastPreset.value = fast;
      if (smaSlowPreset.querySelector('option[value="' + slow + '"]')) smaSlowPreset.value = slow;
      if (smaTpPreset.querySelector('option[value="' + tp + '"]')) smaTpPreset.value = tp;
      if (smaSlPreset.querySelector('option[value="' + sl + '"]')) smaSlPreset.value = sl;
    }

    function applyQuickControlsToJson() {
      if (strategySelect.value !== "sma_crossover") return;
      const current = safeParseObject(liveParamsInput.value);
      current.timeframeSec = Number(smaTfPreset && smaTfPreset.value ? smaTfPreset.value : 900);
      current.fastLen = Number(smaFastPreset && smaFastPreset.value ? smaFastPreset.value : 9);
      current.slowLen = Number(smaSlowPreset && smaSlowPreset.value ? smaSlowPreset.value : 21);
      current.tpTicks = Math.max(0, Number(smaTpPreset && smaTpPreset.value ? smaTpPreset.value : 0));
      current.slTicks = Math.max(0, Number(smaSlPreset && smaSlPreset.value ? smaSlPreset.value : 0));
      liveParamsInput.value = JSON.stringify(current, null, 2);
      statusEl.textContent = "Unsaved Changes";
      statusEl.className = "pill warn";
    }

    function renderStrategyInfo() {
      const id = strategySelect.value;
      const selected = items.find((s) => s.id === id);
      if (!selected) {
        strategyInfo.textContent = "No strategy selected.";
        return;
      }
      setSmaQuickVisibility(id);
      strategyInfo.textContent = "ID: " + selected.id + " | " + (selected.notes || "No notes");

      const override = strategyLiveOverrides[id];
      const params = override || selected.defaultParams || {};
      liveParamsInput.value = JSON.stringify(params, null, 2);
      syncQuickControlsFromParams(params);
      statusEl.textContent = override ? "Override Saved" : "Using Defaults";
      statusEl.className = "pill " + (override ? "ok" : "warn");
    }

    function readJsonSafe(raw) {
      try {
        return { ok: true, value: JSON.parse(raw || "{}") };
      } catch (e) {
        return { ok: false, error: e && e.message ? e.message : String(e) };
      }
    }

    btnSave.addEventListener("click", function () {
      const id = strategySelect.value;
      const parsed = readJsonSafe(liveParamsInput.value || "{}");
      if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
        statusEl.textContent = "Invalid JSON";
        statusEl.className = "pill bad";
        return;
      }
      strategyLiveOverrides[id] = parsed.value;
      statusEl.textContent = "Override Saved";
      statusEl.className = "pill ok";
    });

    btnReset.addEventListener("click", function () {
      const id = strategySelect.value;
      delete strategyLiveOverrides[id];
      const selected = items.find((s) => s.id === id);
      const defaults = (selected && selected.defaultParams) || {};
      liveParamsInput.value = JSON.stringify(defaults, null, 2);
      syncQuickControlsFromParams(defaults);
      statusEl.textContent = "Using Defaults";
      statusEl.className = "pill warn";
    });

    if (smaTfPreset) smaTfPreset.addEventListener("change", applyQuickControlsToJson);
    if (smaFastPreset) smaFastPreset.addEventListener("change", applyQuickControlsToJson);
    if (smaSlowPreset) smaSlowPreset.addEventListener("change", applyQuickControlsToJson);
    if (smaTpPreset) smaTpPreset.addEventListener("change", applyQuickControlsToJson);
    if (smaSlPreset) smaSlPreset.addEventListener("change", applyQuickControlsToJson);

    strategySelect.addEventListener("change", renderStrategyInfo);
    renderStrategyInfo();

    window.LCPro.AppStrategyConfig = {
      getLiveParamsOverride: function (strategyId) {
        return strategyLiveOverrides[strategyId] || null;
      }
    };
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

  function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => (n < 10 ? "0" : "") + n;
    return pad(h) + ":" + pad(m) + ":" + pad(s);
  }

  function initHomeLiveControls(log) {
    const btnStart = $("btnStartLive");
    const btnStop = $("btnStopLive");
    const btnFlatten = $("btnFlattenLive");
    const btnSimulateTrade = $("btnSimulateLiveTrade");
    const statusEl = $("liveStatus");
    const timerEl = $("liveSessionTimer");
    const pairsEl = $("livePairs");
    const cycleMsEl = $("liveCycleMs");
    const maxPairsEl = $("liveMaxPairs");
    const execModeEl = $("liveExecMode");
    const liveStrategySelectEl = $("liveStrategySelect");
    const overviewEl = $("liveOverview");
    const metricSessionPnl = $("metricSessionPnl");
    const metricWins = $("metricWins");
    const metricLosses = $("metricLosses");
    const metricWinRate = $("metricWinRate");
    const metricOpenTrades = $("metricOpenTrades");
    const metricSelectedPairs = $("metricSelectedPairs");
    const recentTradesEl = $("liveRecentTrades");
    const equityCanvas = $("equityCanvas");
    const equityMetaEl = $("equityMeta");
    const liveDiagStatusEl = $("liveDiagStatus");
    const liveDiagPairStatusEl = $("liveDiagPairStatus");
    const liveDiagMarketMiniEl = $("liveDiagMarketMini");
    const historyRowsEl = $("liveSessionHistoryRows");
    const btnClearHistory = $("btnClearSessionHistory");
    const riskEnableDailyLossEl = $("riskEnableDailyLoss");
    const riskEnableDrawdownEl = $("riskEnableDrawdown");
    const riskEnableConsecLossEl = $("riskEnableConsecLoss");
    const riskMaxDailyLossEl = $("riskMaxDailyLoss");
    const riskMaxDrawdownEl = $("riskMaxDrawdown");
    const riskMaxConsecLossEl = $("riskMaxConsecLoss");

    if (
      !btnStart ||
      !btnStop ||
      !btnFlatten ||
      !btnSimulateTrade ||
      !statusEl ||
      !timerEl ||
      !pairsEl ||
      !cycleMsEl ||
      !maxPairsEl ||
      !execModeEl ||
      !liveStrategySelectEl ||
      !overviewEl ||
      !metricSessionPnl ||
      !metricWins ||
      !metricLosses ||
      !metricWinRate ||
      !metricOpenTrades ||
      !metricSelectedPairs ||
      !recentTradesEl ||
      !equityCanvas ||
      !equityMetaEl ||
      !liveDiagStatusEl ||
      !liveDiagPairStatusEl ||
      !liveDiagMarketMiniEl ||
      !historyRowsEl ||
      !btnClearHistory ||
      !riskEnableDailyLossEl ||
      !riskEnableDrawdownEl ||
      !riskEnableConsecLossEl ||
      !riskMaxDailyLossEl ||
      !riskMaxDrawdownEl ||
      !riskMaxConsecLossEl
    ) {
      return null;
    }

    const SESSION_HISTORY_KEY = "lcpro_live_session_history_v1";
    const MAX_HISTORY_ROWS = 20;
    const MAX_EQUITY_POINTS = 900;
    const FORCED_STRATEGY_TIMEFRAME_SEC = 60;
    const FORCED_STRATEGY_CYCLE_MS = 30000;
    const TRADE_EXECUTION_GRACE_MS = 700;
    const MIN_TRADE_GAP_MS = 2500;

    const live = {
      running: false,
      frameworkReady: false,
      engine: null,
      timerId: null,
      inFlight: false,
      cycleMs: FORCED_STRATEGY_CYCLE_MS,
      cycleCount: 0,
      lastCycleAt: 0,
      lastCycleDurationMs: 0,
      sessionStartMs: 0,
      sessionStopMs: 0,
      sessionPeakPnl: 0,
      lastError: "",
      equityPoints: [],
      sessionHistory: [],
      currentDiagnostic: null,
      strategyRuntime: {
        strategyId: "sma_crossover",
        params: {},
        instruments: ["NAS100"],
        timeframeSec: FORCED_STRATEGY_TIMEFRAME_SEC,
        lookback: 900,
        lots: 0.01,
        tpTicks: 55,
        slTicks: 55,
        selectedPairsTarget: 4,
        closedTrades: [],
        instrumentState: {},
        brokerPnlAtStart: null,
        brokerPnlNow: null
      }
    };
    let liveSimArmedUntilMs = 0;

    function populateLiveStrategyOptions() {
      const registry = window.LCPro && window.LCPro.Strategy && window.LCPro.Strategy.STRATEGIES;
      if (!registry) {
        liveStrategySelectEl.innerHTML =
          '<option value="sma_crossover">SMA Crossover</option>' +
          '<option value="nas100_momentum_scalper">NAS100 Momentum Scalper</option>' +
          '<option value="nas100_vwap_liquidity_sweep_fvg_scalper">NAS100 VWAP Liquidity Sweep FVG Scalper</option>';
        if (!liveStrategySelectEl.value) liveStrategySelectEl.value = "sma_crossover";
        return false;
      }

      const items = Object.keys(registry).map(function (k) {
        return registry[k];
      });
      if (!items.length) {
        liveStrategySelectEl.innerHTML =
          '<option value="sma_crossover">SMA Crossover</option>' +
          '<option value="nas100_momentum_scalper">NAS100 Momentum Scalper</option>' +
          '<option value="nas100_vwap_liquidity_sweep_fvg_scalper">NAS100 VWAP Liquidity Sweep FVG Scalper</option>';
        if (!liveStrategySelectEl.value) liveStrategySelectEl.value = "sma_crossover";
        return false;
      }
      liveStrategySelectEl.innerHTML = items
        .map(function (s) {
          return '<option value="' + s.id + '">' + s.name + "</option>";
        })
        .join("");

      if (items.some(function (s) { return s.id === "sma_crossover"; })) {
        liveStrategySelectEl.value = "sma_crossover";
      }
      return true;
    }

    const strategyRegistryReady = populateLiveStrategyOptions();
    if (!strategyRegistryReady) {
      let attempts = 0;
      const retryId = setInterval(function retryLiveStrategyPopulate() {
        attempts += 1;
        if (populateLiveStrategyOptions() || attempts >= 12) {
          clearInterval(retryId);
        }
      }, 500);
    }

    function resolveStrategyRuntimeDefaults(strategy) {
      const ld = (strategy && strategy.liveDefaults) || {};
      const p = (strategy && strategy.defaultParams) || {};
      const tm = (strategy && strategy.tradeManagementDefaults) || {};

      const timeframeFromString = {
        "1m": 60,
        "5m": 300,
        "15m": 900,
        "30m": 1800,
        "1h": 3600
      };
      const tfRaw = String(ld.timeframe || p.timeframe || "").toLowerCase();
      const tfFromParams = timeframeFromString[tfRaw] || Number(ld.timeframeSec || 0);

      return {
        instrumentId: String(ld.instrumentId || p.symbol || "NAS100"),
        timeframeSec: Math.max(60, Number(tfFromParams || 900)),
        lookback: Math.max(200, Number(ld.lookback || 900)),
        lots: Math.max(0.01, Number(ld.lots || 0.01)),
        tpTicks: Math.max(0, Number(ld.tpTicks != null ? ld.tpTicks : tm.tpTicks != null ? tm.tpTicks : 0)),
        slTicks: Math.max(0, Number(ld.slTicks != null ? ld.slTicks : tm.slTicks != null ? tm.slTicks : 0)),
        tickSize: Math.max(0.00001, Number(ld.tickSize || p.tickSize || p.tick_size || tm.tickSize || 1))
      };
    }

    function smaSeries(values, len) {
      const out = new Array(values.length).fill(null);
      if (!values.length || len < 1) return out;
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        const v = Number(values[i]);
        if (!Number.isFinite(v)) {
          out[i] = i > 0 ? out[i - 1] : null;
          continue;
        }
        sum += v;
        if (i >= len) sum -= Number(values[i - len]) || 0;
        if (i >= len - 1) out[i] = sum / len;
      }
      return out;
    }

    function emaSeries(values, len) {
      const out = new Array(values.length).fill(null);
      if (!values.length || len < 1) return out;
      const alpha = 2 / (len + 1);
      let prev = Number(values[0]);
      if (!Number.isFinite(prev)) return out;
      out[0] = prev;
      for (let i = 1; i < values.length; i++) {
        const v = Number(values[i]);
        if (!Number.isFinite(v)) {
          out[i] = out[i - 1];
          continue;
        }
        prev = alpha * v + (1 - alpha) * prev;
        out[i] = prev;
      }
      return out;
    }

    function buildStrategyMetrics(rt, candlesChron, signals) {
      const strategyId = String(rt.strategyId || "");
      const closes = (candlesChron || []).map(function (c) {
        return Number(c && c.c);
      });
      const n = closes.length;
      if (!n) return { strategyId, status: "waiting_for_candles" };

      const latestSignal = signals && signals.length ? signals[0] : null;
      const common = {
        strategyId,
        candlesClosed: n,
        lastClose: Number(closes[n - 1] || 0),
        latestSignal: latestSignal
          ? { type: latestSignal.type, time: latestSignal.time, price: latestSignal.price }
          : null
      };

      if (strategyId === "sma_crossover") {
        const fastLen = Number((rt.params && rt.params.fastLen) || 9);
        const slowLen = Number((rt.params && rt.params.slowLen) || 21);
        const fast = smaSeries(closes, fastLen);
        const slow = smaSeries(closes, slowLen);
        const currFast = Number(fast[n - 1]);
        const currSlow = Number(slow[n - 1]);
        const prevFast = Number(fast[n - 2]);
        const prevSlow = Number(slow[n - 2]);
        const currDiff = currFast - currSlow;
        const prevDiff = prevFast - prevSlow;
        let waitingFor = "insufficient_ma_data";
        if (Number.isFinite(currDiff) && Number.isFinite(prevDiff)) {
          if (prevDiff <= 0 && currDiff > 0) waitingFor = "buy_cross_triggered";
          else if (prevDiff >= 0 && currDiff < 0) waitingFor = "sell_cross_triggered";
          else waitingFor = currDiff > 0 ? "waiting_for_sell_cross" : "waiting_for_buy_cross";
        }
        return Object.assign({}, common, {
          fastLen,
          slowLen,
          prevFast,
          prevSlow,
          currFast,
          currSlow,
          prevDiff,
          currDiff,
          waitingFor
        });
      }

      if (strategyId === "nas100_momentum_scalper") {
        const fastEma = Number((rt.params && rt.params.fastEma) || 18);
        const slowEma = Number((rt.params && rt.params.slowEma) || 55);
        const eFast = emaSeries(closes, fastEma);
        const eSlow = emaSeries(closes, slowEma);
        const ef = Number(eFast[n - 1]);
        const es = Number(eSlow[n - 1]);
        return Object.assign({}, common, {
          fastEma,
          slowEma,
          emaFast: ef,
          emaSlow: es,
          trendBias: Number.isFinite(ef) && Number.isFinite(es) ? (ef >= es ? "bull" : "bear") : "unknown",
          waitingFor: latestSignal ? "signal_ready" : "waiting_for_momentum_breakout"
        });
      }

      return Object.assign({}, common, {
        waitingFor: latestSignal ? "signal_ready" : "waiting_for_strategy_conditions"
      });
    }

    function formatDiagStatusLabel(pair) {
      if (!pair) return "n/a";
      if (pair.signal && pair.signal.isNewSignal) {
        return String(pair.signal.type || "SIGNAL") + " trigger";
      }

      const waiting = String((pair.gate && pair.gate.waitingFor) || "");
      if (waiting === "waiting_for_buy_cross") return "Waiting for BUY cross";
      if (waiting === "waiting_for_sell_cross") return "Waiting for SELL cross";
      if (waiting === "buy_cross_triggered") return "BUY trigger";
      if (waiting === "sell_cross_triggered") return "SELL trigger";
      if (pair.gate && pair.gate.waitingForNextClose && waiting === "signal_ready") {
        return "Waiting for verified close";
      }
      if (waiting === "signal_ready") return "Signal ready";
      if (waiting === "waiting_for_momentum_breakout") return "Waiting for breakout";
      if (waiting === "waiting_for_strategy_conditions") return "Waiting for strategy conditions";
      if (waiting === "insufficient_ma_data") return "Waiting for MA data";
      return waiting ? waiting.replace(/_/g, " ") : "Waiting for data";
    }

    function diagStatusClass(pair, statusText) {
      const txt = String(statusText || "").toLowerCase();
      if (txt.indexOf("sell") >= 0) return "sell";
      if (txt.indexOf("buy") >= 0) return "buy";
      const signalType = String((pair && pair.signal && pair.signal.type) || "").toUpperCase();
      if (signalType === "BUY") return "buy";
      if (signalType === "SELL") return "sell";
      if (txt.indexOf("verified close") >= 0 || txt.indexOf("trigger") >= 0 || txt.indexOf("ready") >= 0) return "warn";
      return "";
    }

    function formatLastSignal(pair) {
      const s = (pair && pair.lastSignal) || (pair && pair.signal);
      if (!s || !s.type) return { text: "-", cls: "" };
      const side = String(s.type || "").toUpperCase();
      const tRaw = s.time || s.t || s.ts || s.date || (pair && pair.market && pair.market.lastClosedBarTime);
      const t = tRaw ? fmtTime(tRaw) : "";
      const pRaw = s.price != null ? s.price : s.px;
      const p = Number.isFinite(Number(pRaw)) ? Number(pRaw).toFixed(5) : "";
      let text = side;
      if (p) text += " @ " + p;
      if (t) text += " | " + t;
      return {
        text,
        cls: side === "BUY" ? "buy" : side === "SELL" ? "sell" : ""
      };
    }

    function fmtDiagNum(v, digits) {
      const n = Number(v);
      return Number.isFinite(n) ? n.toFixed(Number.isFinite(Number(digits)) ? Number(digits) : 5) : "-";
    }

    function normalizeSignalSide(raw) {
      const s = String(raw || "").toUpperCase();
      if (s === "BUY" || s === "LONG") return "BUY";
      if (s === "SELL" || s === "SHORT") return "SELL";
      return "";
    }

    function renderCurrentDiagnostic() {
      if (!live.currentDiagnostic) {
        liveDiagStatusEl.textContent = "Live now: waiting for first cycle.";
        liveDiagPairStatusEl.innerHTML = '<tr><td colspan="3" class="small">Waiting for first cycle...</td></tr>';
        liveDiagMarketMiniEl.innerHTML = '<tr><td colspan="5" class="small">Waiting for first cycle...</td></tr>';
        return;
      }

      const d = live.currentDiagnostic;
      liveDiagStatusEl.textContent =
        "Live now: " +
        fmtTime(d.ts) +
        " | strategy=" +
        (d.strategyId || "n/a") +
        " | pairs=" +
        Number(d.pairCount || 0) +
        " | latency=" +
        Number(d.cycleLatencyMs || 0) +
        "ms";

      const pairs = Array.isArray(d.pairs) ? d.pairs : [];
      if (!pairs.length) {
        liveDiagPairStatusEl.innerHTML = '<tr><td colspan="3" class="small">No pair diagnostics yet.</td></tr>';
        liveDiagMarketMiniEl.innerHTML = '<tr><td colspan="5" class="small">No pair diagnostics yet.</td></tr>';
        return;
      }

      let statusHtml = "";
      let marketHtml = "";
      pairs.forEach(function (pair) {
        const instrumentId = String(pair.instrumentId || "-");
        const statusText = formatDiagStatusLabel(pair);
        const statusCls = diagStatusClass(pair, statusText);
        const lastSignal = formatLastSignal(pair);
        statusHtml +=
          "<tr><td>" +
          instrumentId +
          "</td><td class=\"" +
          lastSignal.cls +
          "\">" +
          lastSignal.text +
          "</td><td class=\"" +
          statusCls +
          "\">" +
          statusText +
          "</td></tr>";

        const metrics = pair.metrics || {};
        const fast = metrics.currFast != null ? metrics.currFast : metrics.emaFast;
        const slow = metrics.currSlow != null ? metrics.currSlow : metrics.emaSlow;
        marketHtml +=
          "<tr><td>" +
          instrumentId +
          "</td><td>" +
          fmtDiagNum(pair.market && pair.market.bid, 5) +
          "</td><td>" +
          fmtDiagNum(pair.market && pair.market.ask, 5) +
          "</td><td>" +
          fmtDiagNum(fast, 5) +
          "</td><td>" +
          fmtDiagNum(slow, 5) +
          "</td></tr>";
      });

      liveDiagPairStatusEl.innerHTML = statusHtml;
      liveDiagMarketMiniEl.innerHTML = marketHtml;
    }

    function setCurrentDiagnostic(diagnostic) {
      live.currentDiagnostic = diagnostic || null;
      renderCurrentDiagnostic();
    }

    const strategyTabSelectEl = $("strategySelect");
    if (strategyTabSelectEl) {
      if (strategyTabSelectEl.value && liveStrategySelectEl.querySelector('option[value="' + strategyTabSelectEl.value + '"]')) {
        liveStrategySelectEl.value = strategyTabSelectEl.value;
      }

      strategyTabSelectEl.addEventListener("change", function () {
        if (live.running) return;
        const v = strategyTabSelectEl.value;
        if (liveStrategySelectEl.querySelector('option[value="' + v + '"]')) {
          liveStrategySelectEl.value = v;
        }
      });

      liveStrategySelectEl.addEventListener("change", function () {
        if (live.running) return;
        if (strategyTabSelectEl.querySelector('option[value="' + liveStrategySelectEl.value + '"]')) {
          strategyTabSelectEl.value = liveStrategySelectEl.value;
          strategyTabSelectEl.dispatchEvent(new Event("change"));
        }
      });
    }

    function parsePairs(raw) {
      const cleaned = String(raw || "")
        .replace(/[\n;|]/g, ",")
        .split(",")
        .map((x) => x.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean);

      // Keep FX-style pairs plus common index symbols if typed.
      const valid = cleaned.filter(function (s) {
        return /^[A-Z]{6}$/.test(s) || /^[A-Z]{2,8}[0-9]{0,3}$/.test(s);
      });

      // De-duplicate while preserving order.
      const seen = {};
      return valid.filter(function (s) {
        if (seen[s]) return false;
        seen[s] = true;
        return true;
      });
    }

    function sumUnrealized(state) {
      if (!state && live.strategyRuntime) {
        const rt = live.strategyRuntime;
        const keys = Object.keys(rt.instrumentState || {});
        let totalRt = 0;
        for (let i = 0; i < keys.length; i++) {
          const st = rt.instrumentState[keys[i]];
          const t = st && st.openTrade;
          if (!t) continue;
          const px = window.LCPro.MarketData.getBidAsk(t.instrumentId);
          if (!px || !px.ok) continue;
          const exitPx = t.side === "BUY" ? Number(px.bid) : Number(px.ask);
          if (!Number.isFinite(exitPx)) continue;
          if (t.side === "BUY") totalRt += (exitPx - Number(t.entryPrice || exitPx)) * Number(t.lots || 0);
          else totalRt += (Number(t.entryPrice || exitPx) - exitPx) * Number(t.lots || 0);
        }
        return totalRt;
      }

      const pairs = Object.keys((state && state.pair_states) || {});
      let total = 0;
      for (let i = 0; i < pairs.length; i++) {
        const ps = state.pair_states[pairs[i]];
        total += Number(ps && ps.unrealized_pnl) || 0;
      }
      return total;
    }

    function getSessionClosedTrades(state) {
      if (!state) {
        return (live.strategyRuntime.closedTrades || []).filter(function (t) {
          const ts = Date.parse(t.time || "");
          return Number.isFinite(ts) && ts >= live.sessionStartMs;
        });
      }

      const events = ((state && state.analytics && state.analytics.events) || []).filter(function (e) {
        if (!e || e.type !== "TRADE_CLOSE") return false;
        const ts = Date.parse(e.timestamp || "");
        return Number.isFinite(ts) && ts >= live.sessionStartMs;
      });

      return events.map(function (e) {
        const trade = e.trade || {};
        return {
          time: e.timestamp,
          pair: e.pair || "-",
          side: trade.side || "-",
          reason: trade.reason_for_exit || "-",
          pnl: Number(trade.pnl) || 0
        };
      });
    }

    function computeConsecutiveLosses(closedTrades) {
      let count = 0;
      for (let i = closedTrades.length - 1; i >= 0; i--) {
        if (closedTrades[i].pnl < 0) {
          count += 1;
          continue;
        }
        break;
      }
      return count;
    }

    function getStatsSnapshot() {
      const strategyDriver = !!(live.engine && live.engine.driverType === "strategy");
      const state = strategyDriver ? null : live.engine ? live.engine.state : null;
      const closedTrades = getSessionClosedTrades(state);
      const wins = closedTrades.filter((t) => t.pnl > 0).length;
      const losses = closedTrades.filter((t) => t.pnl < 0).length;
      const realizedPnl = closedTrades.reduce((acc, t) => acc + t.pnl, 0);
      const unrealizedPnl = sumUnrealized(state);
      let sessionPnl = realizedPnl + unrealizedPnl;

      // In live strategy mode, prefer broker-reported account P/L so this matches platform display.
      if (!state && String(execModeEl.value || "paper").toLowerCase() === "live") {
        const brokerPnl = Number(live.strategyRuntime.brokerPnlNow);
        const brokerStart = Number(live.strategyRuntime.brokerPnlAtStart);
        if (Number.isFinite(brokerPnl) && Number.isFinite(brokerStart)) {
          sessionPnl = brokerPnl - brokerStart;
        } else if (Number.isFinite(brokerPnl)) {
          sessionPnl = brokerPnl;
        }
      }
      const totalClosed = wins + losses;
      const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
      const selectedPairs = state
        ? (state.selected_pairs && state.selected_pairs.length) || 0
        : Number(live.strategyRuntime.selectedPairsTarget || 0) > 0
          ? Number(live.strategyRuntime.selectedPairsTarget || 0)
          : 0;
      const openTrades = state
        ? (state.portfolio && Number(state.portfolio.total_open_trades)) ||
          Object.keys((state.pair_states || {})).reduce(function (acc, pair) {
            const ps = state.pair_states[pair];
            return acc + ((ps && ps.positions && ps.positions.length) || 0);
          }, 0)
        : Object.keys((live.strategyRuntime && live.strategyRuntime.instrumentState) || {}).reduce(function (acc, k) {
            const st = live.strategyRuntime.instrumentState[k];
            return acc + (st && st.openTrade ? 1 : 0);
          }, 0);
      const drawdownPct = (state && state.portfolio && Number(state.portfolio.total_drawdown_pct)) || 0;
      const marginPct = (state && state.portfolio && Number(state.portfolio.margin_used_pct)) || 0;
      const consecutiveLosses = computeConsecutiveLosses(closedTrades);

      return {
        state,
        closedTrades,
        wins,
        losses,
        realizedPnl,
        unrealizedPnl,
        sessionPnl,
        totalClosed,
        winRate,
        selectedPairs,
        openTrades,
        drawdownPct,
        marginPct,
        consecutiveLosses
      };
    }

    function loadHistory() {
      try {
        const raw = localStorage.getItem(SESSION_HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    }

    function saveHistory() {
      try {
        localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(live.sessionHistory.slice(0, MAX_HISTORY_ROWS)));
      } catch (e) {}
    }

    function renderHistory() {
      if (!live.sessionHistory.length) {
        historyRowsEl.innerHTML = '<tr><td colspan="8" class="small">No saved sessions yet.</td></tr>';
        return;
      }

      let html = "";
      live.sessionHistory.slice(0, MAX_HISTORY_ROWS).forEach(function (s) {
        html +=
          "<tr><td>" +
          fmtTime(s.startMs) +
          "</td><td>" +
          fmtTime(s.endMs) +
          "</td><td>" +
          formatDuration((s.endMs || 0) - (s.startMs || 0)) +
          "</td><td class=\"" +
          (Number(s.sessionPnl || 0) >= 0 ? "buy" : "sell") +
          "\">" +
          Number(s.sessionPnl || 0).toFixed(2) +
          "</td><td>" +
          Number(s.wins || 0) +
          "</td><td>" +
          Number(s.losses || 0) +
          "</td><td>" +
          Number(s.winRate || 0).toFixed(1) +
          "%</td><td>" +
          (s.stopReason || "MANUAL_STOP") +
          "</td></tr>";
      });
      historyRowsEl.innerHTML = html;
    }

    function pushSessionHistory(stopReason) {
      if (!live.sessionStartMs) return;
      const stats = getStatsSnapshot();
      const endMs = Date.now();
      const item = {
        startMs: live.sessionStartMs,
        endMs,
        sessionPnl: stats.sessionPnl,
        wins: stats.wins,
        losses: stats.losses,
        winRate: stats.winRate,
        cycles: live.cycleCount,
        stopReason: stopReason || "MANUAL_STOP"
      };
      live.sessionHistory.unshift(item);
      if (live.sessionHistory.length > MAX_HISTORY_ROWS) {
        live.sessionHistory = live.sessionHistory.slice(0, MAX_HISTORY_ROWS);
      }
      saveHistory();
      renderHistory();
    }

    function drawEquity() {
      const canvas = equityCanvas;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width || 320));
      const height = Math.max(180, Math.floor(rect.height || 180));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#fbfdff";
      ctx.fillRect(0, 0, width, height);

      const points = live.equityPoints;
      if (!points.length) {
        ctx.fillStyle = "#5b6678";
        ctx.font = "12px ui-monospace";
        ctx.fillText("No data yet", 12, 20);
        equityMetaEl.textContent = "Starts plotting after session start.";
        return;
      }

      const values = points.map((p) => p.v);
      const minV = Math.min.apply(null, values);
      const maxV = Math.max.apply(null, values);
      const padV = maxV === minV ? 1 : (maxV - minV) * 0.1;
      const lo = minV - padV;
      const hi = maxV + padV;

      const left = 32;
      const top = 12;
      const right = width - 8;
      const bottom = height - 24;
      const w = right - left;
      const h = bottom - top;

      ctx.strokeStyle = "#d6dde8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();

      const yZero = top + (hi - 0) * (h / (hi - lo));
      if (yZero >= top && yZero <= bottom) {
        ctx.strokeStyle = "#e7ecf3";
        ctx.beginPath();
        ctx.moveTo(left, yZero);
        ctx.lineTo(right, yZero);
        ctx.stroke();
      }

      ctx.strokeStyle = values[values.length - 1] >= 0 ? "#169f5f" : "#c93434";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = left + (i / Math.max(1, points.length - 1)) * w;
        const y = top + (hi - points[i].v) * (h / (hi - lo));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      const last = points[points.length - 1];
      equityMetaEl.textContent =
        "Points: " +
        points.length +
        " | Peak P/L: " +
        Number(live.sessionPeakPnl || 0).toFixed(2) +
        " | Current P/L: " +
        Number(last.v || 0).toFixed(2);
    }

    function appendEquityPoint(value) {
      if (!live.sessionStartMs) return;
      const now = Date.now();
      const prev = live.equityPoints.length ? live.equityPoints[live.equityPoints.length - 1] : null;
      if (prev && now - prev.t < 900) return;

      live.equityPoints.push({ t: now, v: Number(value) || 0 });
      if (live.equityPoints.length > MAX_EQUITY_POINTS) {
        live.equityPoints.shift();
      }
    }

    function readRiskRules() {
      return {
        dailyLossEnabled: !!riskEnableDailyLossEl.checked,
        drawdownEnabled: !!riskEnableDrawdownEl.checked,
        consecLossEnabled: !!riskEnableConsecLossEl.checked,
        maxDailyLoss: Math.max(0, Number(riskMaxDailyLossEl.value || 0)),
        maxDrawdown: Math.max(0, Number(riskMaxDrawdownEl.value || 0)),
        maxConsecLoss: Math.max(1, parseInt(riskMaxConsecLossEl.value || "1", 10))
      };
    }

    function maybeAutoStop(stats) {
      if (!live.running) return false;
      const rules = readRiskRules();
      const sessionDrawdown = Math.max(0, Number(live.sessionPeakPnl || 0) - Number(stats.sessionPnl || 0));

      if (rules.dailyLossEnabled && rules.maxDailyLoss > 0 && stats.sessionPnl <= -rules.maxDailyLoss) {
        stopLive("AUTO_STOP_DAILY_LOSS", true);
        return true;
      }
      if (rules.drawdownEnabled && rules.maxDrawdown > 0 && sessionDrawdown >= rules.maxDrawdown) {
        stopLive("AUTO_STOP_MAX_DRAWDOWN", true);
        return true;
      }
      if (rules.consecLossEnabled && rules.maxConsecLoss > 0 && stats.consecutiveLosses >= rules.maxConsecLoss) {
        stopLive("AUTO_STOP_CONSEC_LOSSES", true);
        return true;
      }
      return false;
    }

    function updateMetrics() {
      const stats = getStatsSnapshot();
      const state = stats.state;
      const now = Date.now();

      if (!live.sessionStartMs) {
        timerEl.textContent = "Session 00:00:00";
      } else {
        const endTs = !live.running && live.sessionStopMs ? live.sessionStopMs : now;
        timerEl.textContent = "Session " + formatDuration(endTs - live.sessionStartMs);
      }

      if (live.sessionStartMs) {
        live.sessionPeakPnl = Math.max(Number(live.sessionPeakPnl || 0), Number(stats.sessionPnl || 0));
        // Equity curve is realized-only to avoid oscillation from open-trade unrealized P/L.
        appendEquityPoint(stats.realizedPnl);
      }

      metricSessionPnl.textContent = stats.sessionPnl.toFixed(2);
      metricSessionPnl.classList.toggle("pos", stats.sessionPnl > 0);
      metricSessionPnl.classList.toggle("neg", stats.sessionPnl < 0);
      metricWins.textContent = String(stats.wins);
      metricLosses.textContent = String(stats.losses);
      metricWinRate.textContent = stats.winRate.toFixed(1) + "%";
      metricOpenTrades.textContent = String(stats.openTrades);
      metricSelectedPairs.textContent = String(stats.selectedPairs);

      const lastCycleLabel = live.lastCycleAt ? fmtTime(live.lastCycleAt) : "n/a";
      const sessionState = live.running ? "enabled" : "disabled";
      const modeLabel = state
        ? ((state.settings && state.settings.execution_mode) || "paper").toUpperCase()
        : String(execModeEl.value || "paper").toUpperCase();
      const driverLabel = state ? "CSVRG" : "STRATEGY";
      const rt = live.strategyRuntime || {};
      const strategySummary =
        (rt.strategyId || "n/a") +
        " @ " +
        (rt.instruments && rt.instruments.length ? rt.instruments.join(",") : "n/a") +
        " tf=" +
        Number(rt.timeframeSec || 0);
      const sessionDrawdown = Math.max(0, Number(live.sessionPeakPnl || 0) - Number(stats.sessionPnl || 0));
      overviewEl.textContent =
        "Autotrader: " +
        (live.running ? "RUNNING" : "STOPPED") +
        " | Driver: " +
        driverLabel +
        " | Strategy: " +
        strategySummary +
        " | Mode: " +
        modeLabel +
        " | Engine bot flag: " +
        sessionState +
        " | Cycles: " +
        live.cycleCount +
        " | Last cycle: " +
        lastCycleLabel +
        " (" +
        live.lastCycleDurationMs +
        " ms)" +
        " | Realized: " +
        stats.realizedPnl.toFixed(2) +
        " | Unrealized: " +
        stats.unrealizedPnl.toFixed(2) +
        " | Session DD: " +
        sessionDrawdown.toFixed(2) +
        " | Drawdown: " +
        stats.drawdownPct.toFixed(2) +
        "% | Margin: " +
        stats.marginPct.toFixed(2) +
        "% | Consec Losses: " +
        stats.consecutiveLosses +
        (live.lastError ? " | Last error: " + live.lastError : "");

      if (!stats.closedTrades.length) {
        recentTradesEl.innerHTML = '<tr><td colspan="5" class="small">No closed trades in this session yet.</td></tr>';
      } else {
        const rows = stats.closedTrades.slice(-8).reverse();
        let html = "";
        rows.forEach(function (t) {
          html +=
            "<tr><td>" +
            fmtTime(t.time) +
            "</td><td>" +
            t.pair +
            "</td><td>" +
            t.side +
            "</td><td>" +
            t.reason +
            "</td><td class=\"" +
            (t.pnl >= 0 ? "buy" : "sell") +
            "\">" +
            t.pnl.toFixed(2) +
            "</td></tr>";
        });
        recentTradesEl.innerHTML = html;
      }

      drawEquity();
      maybeAutoStop(stats);
    }

    function setControls() {
      btnStart.disabled = !live.frameworkReady || live.running;
      btnStop.disabled = !live.frameworkReady || !live.running;
      btnFlatten.disabled = !live.frameworkReady || !live.engine;
      btnSimulateTrade.disabled = !live.frameworkReady || live.running;
      pairsEl.disabled = live.running;
      cycleMsEl.disabled = live.running;
      maxPairsEl.disabled = live.running;
      execModeEl.disabled = live.running;
      liveStrategySelectEl.disabled = live.running;
      btnClearHistory.disabled = live.running;
    }

    function setLiveStatus(text, cls) {
      window.LCPro.Debug.setStatus(statusEl, text, cls);
    }

    function clearTimer() {
      if (live.timerId) {
        clearTimeout(live.timerId);
        live.timerId = null;
      }
    }

    function scheduleNextCycle() {
      clearTimer();
      if (!live.running) return;
      live.timerId = setTimeout(runCycle, live.cycleMs);
    }

    function finalizeRunningSession(stopReason) {
      if (!live.sessionStartMs) return;
      pushSessionHistory(stopReason);
    }

    function ensureInstrumentState(instrumentId) {
      const rt = live.strategyRuntime;
      rt.instrumentState = rt.instrumentState || {};
      if (!rt.instrumentState[instrumentId]) {
        rt.instrumentState[instrumentId] = {
          instrumentId,
          lastSignalKey: "",
          lastSignal: null,
          lastProcessedCloseMs: 0,
          lastSignals: [],
          openTrade: null,
          lastTradeActionMs: 0,
          lastExecutionNote: "",
          lastDataHealth: "unverified",
          lastOrderAck: null,
          lastReadout: null
        };
      }
      return rt.instrumentState[instrumentId];
    }

    async function closeStrategyTrade(reason, instrumentId) {
      const rt = live.strategyRuntime;
      const keys = instrumentId
        ? [instrumentId]
        : Object.keys((rt && rt.instrumentState) || {});
      let closed = 0;

      for (let i = 0; i < keys.length; i++) {
        const st = ensureInstrumentState(keys[i]);
        const t = st.openTrade;
        if (!t) continue;

        const px = window.LCPro.MarketData.getBidAsk(t.instrumentId);
        const exitPx = px && px.ok ? (t.side === "BUY" ? Number(px.bid) : Number(px.ask)) : Number(t.entryPrice || 0);
        const pnl =
          t.side === "BUY"
            ? (exitPx - Number(t.entryPrice || exitPx)) * t.lots
            : (Number(t.entryPrice || exitPx) - exitPx) * t.lots;

        if (String(execModeEl.value || "paper").toLowerCase() === "live") {
          try {
            if (window.LCPro.Trading && typeof window.LCPro.Trading.executeAction === "function") {
              await window.LCPro.Trading.executeAction("CLOSE_SIDE", {
                instrumentId: t.instrumentId,
                side: t.side
              });
            } else {
              await window.LCPro.Trading.closeSideOnInstrument(t.instrumentId, t.side);
            }
          } catch (e) {
            log("[LIVE][WARN] Close side failed: " + (e && e.message ? e.message : String(e)));
          }
        }

        rt.closedTrades.push({
          time: new Date().toISOString(),
          pair: t.instrumentId,
          side: t.side,
          reason: reason || "CLOSE",
          pnl: Number.isFinite(pnl) ? pnl : 0
        });
        st.openTrade = null;
        st.lastTradeActionMs = Date.now();
        closed += 1;
      }

      return closed;
    }

    async function openStrategyTrade(instrumentId, side, signal) {
      const rt = live.strategyRuntime;
      const st = ensureInstrumentState(instrumentId);
      const normSide = normalizeSignalSide(side);
      if (!normSide) throw new Error("Invalid trade side: " + String(side || ""));
      const lots = rt.lots;
      const tpTicks = rt.tpTicks;
      const slTicks = rt.slTicks;
      const tickSize = Math.max(0.00001, Number(rt.tickSize || 1));

      const px = window.LCPro.MarketData.getBidAsk(instrumentId);
      const entryPx = px && px.ok ? (normSide === "BUY" ? Number(px.ask) : Number(px.bid)) : Number(signal.price || 0);

      if (String(execModeEl.value || "paper").toLowerCase() === "live") {
        const orderStartedAt = Date.now();
        let res = null;
        if (window.LCPro.Trading && typeof window.LCPro.Trading.executeAction === "function") {
          if (tpTicks > 0 || slTicks > 0) {
            res = await window.LCPro.Trading.executeAction("MARKET_ORDER_TPSL", {
              instrumentId,
              side: normSide,
              lots,
              tpTicks: Math.max(0, tpTicks),
              slTicks: Math.max(0, slTicks),
              tickSize
            });
          } else {
            res = await window.LCPro.Trading.executeAction(normSide, {
              instrumentId,
              lots
            });
          }
        } else {
          if (tpTicks > 0 || slTicks > 0) {
            res = await window.LCPro.Trading.sendMarketOrderWithTpSl(
              instrumentId,
              normSide,
              lots,
              Math.max(0, tpTicks),
              Math.max(0, slTicks),
              tickSize
            );
          } else {
            res = await window.LCPro.Trading.sendMarketOrder(instrumentId, normSide, lots);
          }
        }

        if (!res || res.ok !== true) {
          throw new Error((res && res.reason) || "Broker rejected live entry");
        }

        st.lastOrderAck = {
          at: Date.now(),
          latencyMs: Date.now() - orderStartedAt,
          side: normSide,
          instrumentId
        };
      }

      st.openTrade = {
        side: normSide,
        entryPrice: Number.isFinite(entryPx) ? entryPx : Number(signal.price || 0),
        lots,
        signalTime: signal.time,
        instrumentId,
        openedAt: Date.now()
      };
      st.lastTradeActionMs = Date.now();
    }

    async function executeStrategyEntry(instrumentId, side, signal, sourceTag) {
      const normSide = normalizeSignalSide(side);
      if (!normSide) throw new Error("Invalid execute side: " + String(side || ""));
      const st = ensureInstrumentState(instrumentId);

      await openStrategyTrade(instrumentId, normSide, signal);
      st.lastExecutionNote = "OPENED_" + normSide;

      const rt = live.strategyRuntime || {};
      const tpTicks = Number(rt.tpTicks || 0);
      const slTicks = Number(rt.slTicks || 0);
      log(
        "[LIVE][EXEC] Opened " +
          normSide +
          " on " +
          instrumentId +
          " via " +
          String(sourceTag || "STRATEGY") +
          " | tpTicks=" +
          tpTicks +
          " | slTicks=" +
          slTicks
      );
    }

    async function executeBuy(instrumentId, signal, sourceTag) {
      return executeStrategyEntry(instrumentId, "BUY", signal, sourceTag || "STRATEGY");
    }

    async function executeSell(instrumentId, signal, sourceTag) {
      return executeStrategyEntry(instrumentId, "SELL", signal, sourceTag || "STRATEGY");
    }

    function getTradingActionNames() {
      if (!window.LCPro || !window.LCPro.Trading || typeof window.LCPro.Trading.listActions !== "function") return [];
      const list = window.LCPro.Trading.listActions();
      if (!Array.isArray(list)) return [];
      return list
        .map(function (name) {
          return String(name || "").toUpperCase();
        })
        .filter(Boolean);
    }

    function getStrategyActionHandlers() {
      const handlers = {
        BUY: async function (payload) {
          return executeBuy(payload.instrumentId, payload.signal, payload.sourceTag || "STRATEGY");
        },
        SELL: async function (payload) {
          return executeSell(payload.instrumentId, payload.signal, payload.sourceTag || "STRATEGY");
        },
        CLOSE_OPPOSITE: async function (payload) {
          return closeStrategyTrade(payload.reason || "OPPOSITE_SIGNAL", payload.instrumentId);
        },
        CLOSE_ALL: async function (payload) {
          return closeStrategyTrade(payload.reason || "MANUAL_CLOSE_ALL");
        }
      };

      const tradingActionNames = getTradingActionNames();
      for (let i = 0; i < tradingActionNames.length; i++) {
        const actionName = tradingActionNames[i];
        if (handlers[actionName]) continue;
        handlers[actionName] = async function (payload) {
          if (!window.LCPro || !window.LCPro.Trading || typeof window.LCPro.Trading.executeAction !== "function") {
            throw new Error("Trading action executor unavailable");
          }
          return window.LCPro.Trading.executeAction(actionName, payload || {});
        };
      }

      return handlers;
    }

    function listStrategyActions() {
      return Object.keys(getStrategyActionHandlers()).sort();
    }

    async function runStrategyAction(actionName, payload) {
      const key = String(actionName || "").toUpperCase();
      const actions = getStrategyActionHandlers();
      if (!actions[key]) {
        throw new Error("Unknown strategy action: " + key);
      }
      return actions[key](payload || {});
    }

    async function executeSignalTrigger(instrumentId, st, executionSignal, closeMs) {
      log(
        "[LIVE][TRIGGER] " +
          instrumentId +
          " " +
          executionSignal.type +
          " on closed candle " +
          fmtTime(closeMs || executionSignal.time || Date.now())
      );

      const sinceLastActionMs = Date.now() - Number(st.lastTradeActionMs || 0);
      if (sinceLastActionMs < MIN_TRADE_GAP_MS) {
        await new Promise(function (resolve) {
          setTimeout(resolve, MIN_TRADE_GAP_MS - sinceLastActionMs);
        });
      }
      await new Promise(function (resolve) {
        setTimeout(resolve, TRADE_EXECUTION_GRACE_MS);
      });

      if (st.openTrade && st.openTrade.side !== executionSignal.type) {
        await runStrategyAction("CLOSE_OPPOSITE", {
          instrumentId,
          reason: "OPPOSITE_SIGNAL"
        });
      }

      if (!st.openTrade) {
        await runStrategyAction(String(executionSignal.type || ""), {
          instrumentId,
          signal: executionSignal,
          sourceTag: "TRIGGER"
        });
      } else {
        st.lastExecutionNote = "ALREADY_OPEN_" + st.openTrade.side;
        log("[LIVE][EXEC] Skipped open on " + instrumentId + " because " + st.openTrade.side + " is already open.");
      }
    }

    async function runStrategyCycle() {
      const rt = live.strategyRuntime;
      const strategyApi = window.LCPro.Strategy;
      const strategy = strategyApi && strategyApi.getStrategy ? strategyApi.getStrategy(rt.strategyId) : null;
      if (!strategy) throw new Error("Selected strategy not found: " + rt.strategyId);

      const instruments = Array.isArray(rt.instruments) && rt.instruments.length ? rt.instruments.slice(0) : ["NAS100"];

      const cycleStartedAt = Date.now();
      try {
        window.LCPro.MarketData.requestPrices(instruments);
      } catch (e) {}
      const accountSnap = window.LCPro.MarketData.getAccountSnapshot ? window.LCPro.MarketData.getAccountSnapshot() : null;
      if (accountSnap) {
        const pnlRaw = Number(accountSnap.profitLoss);
        const pnlFromEqBal =
          Number.isFinite(Number(accountSnap.equity)) && Number.isFinite(Number(accountSnap.balance))
            ? Number(accountSnap.equity) - Number(accountSnap.balance)
            : NaN;
        if (Number.isFinite(pnlRaw)) rt.brokerPnlNow = pnlRaw;
        else if (Number.isFinite(pnlFromEqBal)) rt.brokerPnlNow = pnlFromEqBal;
      }

      const perPair = [];
      let signalCount = 0;
      let newSignalCount = 0;

      for (let i = 0; i < instruments.length; i++) {
        const instrumentId = instruments[i];
        const st = ensureInstrumentState(instrumentId);
        const bidAsk = window.LCPro.MarketData.getBidAsk(instrumentId);
        const candleMsg = await window.LCPro.MarketData.requestCandles(instrumentId, rt.timeframeSec, rt.lookback);
        const newestFirst = (candleMsg && candleMsg.candles) || [];
        const closed = newestFirst.slice(1);
        const candlesChron = window.LCPro.MarketData.candlesToChron
          ? window.LCPro.MarketData.candlesToChron(closed)
          : closed.slice().reverse();

        const newestClosed = closed[0] || null;
        const rawTs = newestClosed ? newestClosed.date || newestClosed.t || newestClosed.ts || newestClosed.time : 0;
        const closeMs = Number(rawTs) > 0 ? (Number(rawTs) < 1e12 ? Number(rawTs) * 1000 : Number(rawTs)) : 0;
        const maxLagMs = Math.max(120000, rt.timeframeSec * 2000);
        const dataFresh = closeMs > 0 ? Date.now() - closeMs <= maxLagMs : false;
        const candleCountOk = candlesChron.length >= Math.min(200, rt.lookback - 5);
        st.lastDataHealth = bidAsk && bidAsk.ok && dataFresh && candleCountOk ? "verified" : "degraded";

        const hasClosedBar = Number.isFinite(closeMs) && closeMs > 0;
        const isNewClosedBar = hasClosedBar && closeMs !== Number(st.lastProcessedCloseMs || 0);
        const shouldEvaluateSignals = isNewClosedBar || !Array.isArray(st.lastSignals) || !st.lastSignals.length;

        let signals = Array.isArray(st.lastSignals) ? st.lastSignals : [];
        if (shouldEvaluateSignals) {
          signals = await strategyApi.runSignals(rt.strategyId, {
            strategyId: rt.strategyId,
            instrumentId,
            timeframeSec: rt.timeframeSec,
            lookback: rt.lookback,
            keepN: 2,
            params: rt.params
          });
          st.lastSignals = Array.isArray(signals) ? signals.slice(0, 2) : [];
          if (hasClosedBar) st.lastProcessedCloseMs = closeMs;
        }

        const newest = signals && signals.length ? signals[0] : null;
        const newestType = normalizeSignalSide(newest && newest.type);
        const newestNorm = newestType ? Object.assign({}, newest, { type: newestType }) : null;
        const metrics = buildStrategyMetrics(rt, candlesChron, signals || []);

        let executionSignal = newestNorm;
        if (shouldEvaluateSignals && rt.strategyId === "sma_crossover") {
          const crossSide =
            metrics.waitingFor === "buy_cross_triggered"
              ? "BUY"
              : metrics.waitingFor === "sell_cross_triggered"
                ? "SELL"
                : "";
          if (crossSide) {
            const lastClosePx =
              candlesChron && candlesChron.length ? Number(candlesChron[candlesChron.length - 1].c) : Number.NaN;
            executionSignal = {
              type: crossSide,
              time: closeMs || Date.now(),
              price: Number.isFinite(lastClosePx) ? lastClosePx : Number(crossSide === "BUY" ? bidAsk.ask : bidAsk.bid),
              synthetic: true
            };
          } else if (!executionSignal) {
            executionSignal = null;
          }
        }

        const key = executionSignal
          ? String(executionSignal.type || "") +
            "|" +
            String(
              rt.strategyId === "sma_crossover" && shouldEvaluateSignals
                ? closeMs || executionSignal.time || executionSignal.idx || ""
                : executionSignal.time || executionSignal.idx || ""
            )
          : "";
        const signalTsRaw = executionSignal ? executionSignal.time || executionSignal.t || executionSignal.ts || executionSignal.date : 0;
        const signalMs = Number(signalTsRaw)
          ? Number(signalTsRaw) < 1e12
            ? Number(signalTsRaw) * 1000
            : Number(signalTsRaw)
          : Date.parse(String(signalTsRaw || ""));
        const signalOnLatestClose =
          Number.isFinite(signalMs) && Number.isFinite(closeMs)
            ? Math.abs(signalMs - closeMs) <= Math.max(1000, Math.floor(rt.timeframeSec * 250))
            : false;
        const isNewSignal =
          rt.strategyId === "sma_crossover"
            ? !!(executionSignal && shouldEvaluateSignals && key !== st.lastSignalKey)
            : !!(executionSignal && shouldEvaluateSignals && signalOnLatestClose && key !== st.lastSignalKey);
        if (executionSignal) signalCount += 1;
        if (isNewSignal) newSignalCount += 1;

        if (executionSignal && isNewSignal) {
          try {
            await executeSignalTrigger(instrumentId, st, executionSignal, closeMs);
          } catch (e) {
            st.lastExecutionNote = "OPEN_FAILED";
            log(
              "[LIVE][ERR] Open failed on " +
                instrumentId +
                " for " +
                executionSignal.type +
                ": " +
                (e && e.message ? e.message : String(e))
            );
            throw e;
          }

          st.lastSignalKey = key;
        }
        if (executionSignal) {
          st.lastSignal = {
            type: executionSignal.type,
            time: executionSignal.time,
            price: executionSignal.price
          };
        }
        let tpSlPreview = null;
        if (Number(rt.tpTicks || 0) > 0 || Number(rt.slTicks || 0) > 0) {
          tpSlPreview = window.LCPro.Trading.calcTpSlAbsolute(
            instrumentId,
            st.openTrade ? st.openTrade.side : executionSignal ? executionSignal.type : "BUY",
            Math.max(0, Number(rt.tpTicks || 0)),
            Math.max(0, Number(rt.slTicks || 0)),
            Math.max(0.00001, Number(rt.tickSize || 1))
          );
        }

        const pairReadout = {
          instrumentId,
          timeframeSec: rt.timeframeSec,
          dataHealth: st.lastDataHealth,
          market: {
            bid: bidAsk && Number.isFinite(Number(bidAsk.bid)) ? Number(bidAsk.bid) : null,
            ask: bidAsk && Number.isFinite(Number(bidAsk.ask)) ? Number(bidAsk.ask) : null,
            spread: bidAsk && bidAsk.ok ? Number(bidAsk.ask) - Number(bidAsk.bid) : null,
            lastClosedBarTime: closeMs || null,
            dataFresh,
            candleCountClosed: candlesChron.length,
            candleCountOk
          },
          signal: executionSignal
            ? {
                type: executionSignal.type,
                time: executionSignal.time,
                price: executionSignal.price,
                isNewSignal,
                onLatestClosedBar: signalOnLatestClose,
                evaluatedThisCycle: shouldEvaluateSignals
              }
            : null,
          lastSignal: st.lastSignal || null,
          gate: {
            waitingFor: metrics.waitingFor,
            hasOpenTrade: !!st.openTrade,
            openTradeSide: st.openTrade ? st.openTrade.side : null,
            actionsAvailable: listStrategyActions(),
            lastSignalKey: st.lastSignalKey,
            lastExecutionNote: st.lastExecutionNote || null,
            lastProcessedCloseMs: st.lastProcessedCloseMs || null,
            waitingForNextClose: !shouldEvaluateSignals && hasClosedBar
          },
          metrics,
          risk: {
            lots: rt.lots,
            tpTicks: rt.tpTicks,
            slTicks: rt.slTicks,
            tpSlPreview
          },
          broker: {
            mode: String(execModeEl.value || "paper"),
            lastOrderAck: st.lastOrderAck || null
          }
        };

        st.lastReadout = pairReadout;
        perPair.push(pairReadout);
      }

      setCurrentDiagnostic({
        ts: Date.now(),
        strategyId: rt.strategyId,
        pairCount: instruments.length,
        cycleLatencyMs: Date.now() - cycleStartedAt,
        summary: {
          signalsFound: signalCount,
          newSignals: newSignalCount,
          openTrades: perPair.filter(function (p) {
            return p.gate && p.gate.hasOpenTrade;
          }).length
        },
        pairs: perPair,
        broker: {
          mode: String(execModeEl.value || "paper"),
          accountSnapshot: accountSnap,
          brokerPnlAtStart: rt.brokerPnlAtStart,
          brokerPnlNow: rt.brokerPnlNow
        }
      });

      return {
        ok: true,
        reason: newSignalCount > 0 ? "SIGNAL_PROCESSED" : signalCount > 0 ? "NO_NEW_SIGNAL" : "NO_SIGNAL"
      };
    }

    async function primeStrategySignalBaseline() {
      const rt = live.strategyRuntime;
      const strategyApi = window.LCPro.Strategy;
      if (!rt || !strategyApi || typeof strategyApi.runSignals !== "function") return;

      try {
        const instruments = Array.isArray(rt.instruments) && rt.instruments.length ? rt.instruments : ["NAS100"];
        for (let i = 0; i < instruments.length; i++) {
          const instrumentId = instruments[i];
          const st = ensureInstrumentState(instrumentId);

          const candleMsg = await window.LCPro.MarketData.requestCandles(
            instrumentId,
            rt.timeframeSec,
            Math.min(rt.lookback, 400)
          );
          const newestFirst = (candleMsg && candleMsg.candles) || [];
          const newestClosed = newestFirst.length > 1 ? newestFirst[1] : null;
          const closed = newestFirst.slice(1);
          const candlesChron = window.LCPro.MarketData.candlesToChron
            ? window.LCPro.MarketData.candlesToChron(closed)
            : closed.slice().reverse();
          const rawTs = newestClosed ? newestClosed.date || newestClosed.t || newestClosed.ts || newestClosed.time : 0;
          const closeMs = Number(rawTs) > 0 ? (Number(rawTs) < 1e12 ? Number(rawTs) * 1000 : Number(rawTs)) : 0;
          if (closeMs > 0) st.lastProcessedCloseMs = closeMs;

          const signals = await strategyApi.runSignals(rt.strategyId, {
            strategyId: rt.strategyId,
            instrumentId,
            timeframeSec: rt.timeframeSec,
            lookback: rt.lookback,
            keepN: 1,
            params: rt.params
          });

          const newest = signals && signals.length ? signals[0] : null;
          const newestType = normalizeSignalSide(newest && newest.type);
          const newestNorm = newestType ? Object.assign({}, newest, { type: newestType }) : null;
          const metrics = buildStrategyMetrics(rt, candlesChron, signals || []);

          let baselineSignal = newestNorm;
          if (rt.strategyId === "sma_crossover") {
            const crossSide =
              metrics.waitingFor === "buy_cross_triggered"
                ? "BUY"
                : metrics.waitingFor === "sell_cross_triggered"
                  ? "SELL"
                  : "";
            if (crossSide) {
              const lastClosePx =
                candlesChron && candlesChron.length ? Number(candlesChron[candlesChron.length - 1].c) : Number.NaN;
              baselineSignal = {
                type: crossSide,
                time: closeMs || Date.now(),
                price: Number.isFinite(lastClosePx) ? lastClosePx : Number.NaN,
                synthetic: true
              };
            }
          }

          if (baselineSignal) {
            st.lastSignal = {
              type: baselineSignal.type,
              time: baselineSignal.time,
              price: baselineSignal.price
            };
          }

          if (rt.strategyId === "sma_crossover" && closeMs > 0 && baselineSignal) {
            st.lastSignalKey = String(baselineSignal.type || "") + "|" + String(closeMs);
          } else if (baselineSignal) {
            st.lastSignalKey = String(baselineSignal.type || "") + "|" + String(baselineSignal.time || baselineSignal.idx || "");
          } else {
            st.lastSignalKey = "";
          }

          st.lastSignals = Array.isArray(signals) ? signals.slice(0, 2) : [];
        }
        log("[LIVE] Primed startup signal baseline for " + instruments.length + " pair(s).");
      } catch (e) {
        log("[LIVE][WARN] Could not prime signal baseline: " + (e && e.message ? e.message : String(e)));
      }
    }

    async function runCycle() {
      if (!live.running || !live.engine || live.inFlight) return;
      live.inFlight = true;
      try {
        const started = Date.now();
        const result = live.engine.driverType === "strategy" ? await runStrategyCycle() : await live.engine.run_cycle();
        live.lastCycleDurationMs = Date.now() - started;
        live.lastCycleAt = Date.now();
        live.cycleCount += 1;
        live.lastError = "";

        if (result && result.reason === "FRIDAY_SHUTDOWN") {
          setLiveStatus("Stopped: Friday Shutdown", "warn");
          log("[LIVE] Friday shutdown triggered, stopping loop.");
          stopLive("FRIDAY_SHUTDOWN", true);
          return;
        }
      } catch (e) {
        live.lastError = e && e.message ? e.message : String(e);
        setLiveStatus("Cycle Error", "bad");
        log("[LIVE][ERR] " + live.lastError);
      } finally {
        live.inFlight = false;
        updateMetrics();
        setControls();
        if (live.running) scheduleNextCycle();
      }
    }

    function createEngineFromInputs() {
      const strategyApi = window.LCPro.Strategy;
      const strategyId = String(liveStrategySelectEl.value || "sma_crossover");
      const strategy = strategyApi && strategyApi.getStrategy ? strategyApi.getStrategy(strategyId) : null;
      if (!strategy) throw new Error("Strategy unavailable: " + strategyId);
      const sd = resolveStrategyRuntimeDefaults(strategy);
      const inputPairs = parsePairs(pairsEl.value);
      const maxPairCount = Math.max(1, parseInt(maxPairsEl.value || "4", 10));
      const instruments = inputPairs.length ? inputPairs.slice(0, maxPairCount) : [sd.instrumentId];
      const overrideParams =
        window.LCPro && window.LCPro.AppStrategyConfig && window.LCPro.AppStrategyConfig.getLiveParamsOverride
          ? window.LCPro.AppStrategyConfig.getLiveParamsOverride(strategyId)
          : null;
      const mergedParams = Object.assign({}, strategy.defaultParams || {}, overrideParams || {});
      const paramTpTicks = Number(mergedParams.tpTicks);
      const paramSlTicks = Number(mergedParams.slTicks);
      mergedParams.timeframeSec = FORCED_STRATEGY_TIMEFRAME_SEC;

      live.strategyRuntime = {
        strategyId,
        params: mergedParams,
        instruments,
        timeframeSec: FORCED_STRATEGY_TIMEFRAME_SEC,
        lookback: sd.lookback,
        lots: sd.lots,
        tpTicks: Number.isFinite(paramTpTicks) ? Math.max(0, paramTpTicks) : sd.tpTicks,
        slTicks: Number.isFinite(paramSlTicks) ? Math.max(0, paramSlTicks) : sd.slTicks,
        tickSize: sd.tickSize,
        selectedPairsTarget: instruments.length,
        instrumentState: {},
        closedTrades: [],
        brokerPnlAtStart: null,
        brokerPnlNow: null
      };

      live.cycleMs = FORCED_STRATEGY_CYCLE_MS;
      cycleMsEl.value = String(FORCED_STRATEGY_CYCLE_MS);

      const customSettings = {
        execution_mode: String(execModeEl.value || "paper").toLowerCase() === "live" ? "live" : "paper"
      };

      return {
        driverType: "strategy",
        state: null,
        settings: { execution_mode: customSettings.execution_mode },
        run_cycle: function () {
          return runStrategyCycle();
        },
        close_all_positions: async function () {
          let closed = 0;
          if (window.LCPro && window.LCPro.Trading) {
            try {
              if (typeof window.LCPro.Trading.executeAction === "function") {
                await window.LCPro.Trading.executeAction("CLOSE_ALL", {});
              } else if (typeof window.LCPro.Trading.closeAllPositions === "function") {
                await window.LCPro.Trading.closeAllPositions();
              }
            } catch (e) {}
          }
          closed += await closeStrategyTrade("MANUAL_CLOSE_ALL");
          return closed;
        }
      };
    }

    async function startLive() {
      if (live.running) return;
      try {
        live.engine = createEngineFromInputs();
        live.cycleCount = 0;
        live.lastCycleAt = 0;
        live.lastCycleDurationMs = 0;
        live.lastError = "";
        live.sessionStartMs = Date.now();
        live.sessionStopMs = 0;
        live.sessionPeakPnl = 0;
        live.equityPoints = [];
        live.currentDiagnostic = null;
        renderCurrentDiagnostic();
        live.running = true;
        if (String(execModeEl.value || "paper").toLowerCase() === "live" && window.LCPro.MarketData.getAccountSnapshot) {
          const snap = window.LCPro.MarketData.getAccountSnapshot();
          if (snap) {
            const startPnlRaw = Number(snap.profitLoss);
            const startPnlEqBal =
              Number.isFinite(Number(snap.equity)) && Number.isFinite(Number(snap.balance))
                ? Number(snap.equity) - Number(snap.balance)
                : NaN;
            const startPnl = Number.isFinite(startPnlRaw) ? startPnlRaw : startPnlEqBal;
            if (Number.isFinite(startPnl)) {
              live.strategyRuntime.brokerPnlAtStart = startPnl;
              live.strategyRuntime.brokerPnlNow = startPnl;
            }
          }
        }
        setLiveStatus("Running", "ok");
        log("[LIVE] Autotrader started.");
        log("[LIVE] Strategy action registry ready: " + listStrategyActions().join(", "));
        setControls();
        updateMetrics();
        await primeStrategySignalBaseline();
        await runCycle();
      } catch (e) {
        live.running = false;
        live.lastError = e && e.message ? e.message : String(e);
        setLiveStatus("Start Failed", "bad");
        overviewEl.textContent = "Start failed: " + live.lastError;
        log("[LIVE][ERR] Failed to start: " + live.lastError);
        setControls();
        updateMetrics();
      }
    }

    function stopLive(reason, isAutoStop) {
      if (!live.running) return;
      live.running = false;
      live.sessionStopMs = Date.now();
      clearTimer();
      const stopReason = reason || "MANUAL_STOP";
      if (live.engine && live.engine.driverType === "strategy") {
        closeStrategyTrade(stopReason).catch(function () {});
      }
      setLiveStatus(isAutoStop ? "Auto-stopped" : "Stopped", isAutoStop ? "bad" : "warn");
      log("[LIVE] Autotrader stopped. reason=" + stopReason);
      finalizeRunningSession(stopReason);
      setControls();
      updateMetrics();
    }

    function flattenPositions() {
      if (!live.engine) return;
      Promise.resolve(live.engine.close_all_positions())
        .then(function (closed) {
          log("[LIVE] Closed positions: " + closed);
        })
        .catch(function (e) {
          log("[LIVE][ERR] Close all failed: " + (e && e.message ? e.message : String(e)));
        })
        .finally(function () {
          updateMetrics();
        });
    }

    async function simulateTradePathOnce() {
      if (!live.frameworkReady) {
        throw new Error("Framework not ready");
      }
      if (live.running) {
        throw new Error("Stop autotrader before running simulation");
      }

      const mode = String(execModeEl.value || "paper").toLowerCase();

      live.engine = createEngineFromInputs();
      const rt = live.strategyRuntime;
      const instrumentId =
        Array.isArray(rt.instruments) && rt.instruments.length ? String(rt.instruments[0]) : String(rt.instrumentId || "NAS100");
      const st = ensureInstrumentState(instrumentId);

      async function waitForBidAsk(maxWaitMs) {
        const started = Date.now();
        while (Date.now() - started < maxWaitMs) {
          try {
            window.LCPro.MarketData.requestPrices([instrumentId]);
          } catch (e) {}
          const p = window.LCPro.MarketData.getBidAsk(instrumentId);
          if (p && p.ok && Number.isFinite(Number(p.bid)) && Number.isFinite(Number(p.ask))) return p;
          await new Promise(function (resolve) {
            setTimeout(resolve, 250);
          });
        }
        return null;
      }

      const px = await waitForBidAsk(5000);
      if (!px || !px.ok) {
        throw new Error("No bid/ask available for " + instrumentId);
      }

      const lastSignalType =
        st && st.lastSignals && st.lastSignals.length && st.lastSignals[0] && st.lastSignals[0].type
          ? String(st.lastSignals[0].type).toUpperCase()
          : "";
      const side = lastSignalType === "SELL" ? "SELL" : "BUY";
      const signal = {
        type: side,
        time: new Date().toISOString(),
        price: Number(side === "BUY" ? px.ask : px.bid) || 0
      };

      const listPositions =
        window.LCPro && window.LCPro.Trading && typeof window.LCPro.Trading.listOpenPositionsDetailed === "function"
          ? window.LCPro.Trading.listOpenPositionsDetailed
          : null;
      const countPositionsForInstrument = function () {
        if (!listPositions) return null;
        return listPositions().filter(function (p) {
          return String((p && p.instrumentId) || "").toUpperCase() === instrumentId.toUpperCase();
        }).length;
      };

      const startedAt = Date.now();
      const beforeCount = countPositionsForInstrument();
      log("[LIVE] Simulation opening " + side + " on " + instrumentId + "...");
      if (mode !== "live") {
        log("[LIVE][SIM] Execution mode is PAPER. This validates logic path only and does not place broker orders.");
      }
      await runStrategyAction(side, {
        instrumentId,
        signal,
        sourceTag: "SIMULATION"
      });
      const openedAt = Date.now();
      const afterOpenCount = countPositionsForInstrument();
      await new Promise(function (resolve) {
        setTimeout(resolve, mode === "live" ? 2500 : 500);
      });
      const closeCount = await closeStrategyTrade("SIMULATED_TRADE_PATH", instrumentId);
      const finishedAt = Date.now();
      const afterCloseCount = countPositionsForInstrument();

      setCurrentDiagnostic({
        ts: Date.now(),
        strategyId: rt.strategyId,
        probe: {
          type: "trade_path_simulation",
          instrumentId,
          mode,
          side,
          opened: !!st.lastOrderAck || mode !== "live",
          closed: closeCount > 0,
          positionsBefore: beforeCount,
          positionsAfterOpen: afterOpenCount,
          positionsAfterClose: afterCloseCount,
          openLatencyMs: openedAt - startedAt,
          closeLatencyMs: finishedAt - openedAt,
          totalLatencyMs: finishedAt - startedAt,
          orderAck: st.lastOrderAck || null
        }
      });

      return {
        ok: true,
        instrumentId,
        mode,
        closeCount,
        positionsBefore: beforeCount,
        positionsAfterOpen: afterOpenCount,
        positionsAfterClose: afterCloseCount,
        openLatencyMs: openedAt - startedAt,
        closeLatencyMs: finishedAt - openedAt,
        totalLatencyMs: finishedAt - startedAt
      };
    }

    btnStart.addEventListener("click", function () {
      startLive();
    });
    btnStop.addEventListener("click", function () {
      stopLive("MANUAL_STOP", false);
    });
    btnFlatten.addEventListener("click", function () {
      flattenPositions();
    });
    btnSimulateTrade.addEventListener("click", function () {
      const mode = String(execModeEl.value || "paper").toLowerCase();
      if (mode === "live") {
        const now = Date.now();
        if (now > liveSimArmedUntilMs) {
          liveSimArmedUntilMs = now + 10000;
          log("[LIVE] Live simulation armed. Click Simulate Trade Path again within 10s to execute real open+close test.");
          return;
        }
      } else {
        liveSimArmedUntilMs = 0;
      }

      btnSimulateTrade.disabled = true;
      simulateTradePathOnce()
        .then(function (res) {
          liveSimArmedUntilMs = 0;
          log(
            "[LIVE] Trade path simulation OK | instrument=" +
              res.instrumentId +
              " | mode=" +
              res.mode +
              " | pos(before/open/close)=" +
              (res.positionsBefore == null ? "n/a" : String(res.positionsBefore)) +
              "/" +
              (res.positionsAfterOpen == null ? "n/a" : String(res.positionsAfterOpen)) +
              "/" +
              (res.positionsAfterClose == null ? "n/a" : String(res.positionsAfterClose)) +
              " | open=" +
              res.openLatencyMs +
              "ms | close=" +
              res.closeLatencyMs +
              "ms | total=" +
              res.totalLatencyMs +
              "ms"
          );
        })
        .catch(function (e) {
          const msg = e && e.message ? e.message : String(e);
          log("[LIVE][ERR] Trade path simulation failed: " + msg);
          setLiveStatus("Simulation Failed", "bad");
        })
        .finally(function () {
          updateMetrics();
          setControls();
        });
    });
    btnClearHistory.addEventListener("click", function () {
      live.sessionHistory = [];
      saveHistory();
      renderHistory();
    });

    live.sessionHistory = loadHistory();
    renderHistory();
    renderCurrentDiagnostic();
    setLiveStatus("Disconnected", "warn");
    setControls();
    updateMetrics();
    setInterval(updateMetrics, 1000);

    return {
      setFrameworkReady: function (ready) {
        live.frameworkReady = !!ready;
        if (!live.frameworkReady && live.running) stopLive("FRAMEWORK_DISCONNECTED", true);
        if (!live.running) {
          setLiveStatus(live.frameworkReady ? "Ready" : "Disconnected", live.frameworkReady ? "ok" : "warn");
        }
        setControls();
      },
      stop: function () {
        stopLive("MANUAL_STOP", false);
      },
      getState: function () {
        return live;
      }
    };
  }

  function initBacktesterTab() {
    const strategySelect = $("btStrategySelect");
    const strategyInfo = $("btInfo");
    const paramsInput = $("btParams");
    const tradeMgmtInput = $("btTradeMgmt");
    const rangePresetEl = $("btRangePreset");
    const summaryEl = $("btSummary");
    const verificationEl = $("btVerification");
    const optimizerReportEl = $("btOptimizerReport");
    const showVerificationEl = $("btShowVerification");
    const btnRun = $("btnRunStrategyBacktest");
    const btnOptimize = $("btnOptimizeBacktest");
    const btnReset = $("btnResetBtParams");
    const targetWinRateEl = $("btTargetWinRate");
    const maxCandidatesEl = $("btMaxCandidates");
    const execModeEl = $("btExecMode");
    const statusEl = $("btStatus");
    const log = window.LCPro.Debug.createLogger($("btLog"));
    const setStatus = (text, cls) => window.LCPro.Debug.setStatus(statusEl, text, cls);

    const strategyApi = window.LCPro.Strategy;
    const registry = strategyApi && strategyApi.STRATEGIES;
    if (
      !strategySelect ||
      !strategyInfo ||
      !paramsInput ||
      !tradeMgmtInput ||
      !rangePresetEl ||
      !summaryEl ||
      !verificationEl ||
      !optimizerReportEl ||
      !btnRun ||
      !btnOptimize ||
      !btnReset ||
      !targetWinRateEl ||
      !maxCandidatesEl ||
      !execModeEl ||
      !registry
    )
      return;

    const items = Object.keys(registry).map((k) => registry[k]);
    strategySelect.innerHTML = items
      .map((s) => '<option value="' + s.id + '">' + s.name + "</option>")
      .join("");

    function parseJsonField(raw, label) {
      try {
        return JSON.parse(raw || "{}");
      } catch (e) {
        throw new Error(label + " JSON is invalid");
      }
    }

    function getBacktestInputs() {
      const params = parseJsonField(paramsInput.value || "{}", "Strategy params");
      const tradeManagement = parseJsonField(tradeMgmtInput.value || "{}", "Trade management");
      if (execModeEl && execModeEl.value) {
        params.strategy_execution_mode = execModeEl.value;
      }

      return {
        strategyId: strategySelect.value,
        instrumentId: $("btSym") ? $("btSym").value : "NAS100",
        timeframeSec: parseInt($("btTfSec") ? $("btTfSec").value : "900", 10),
        rangePreset: rangePresetEl.value || "week",
        lookback: Math.max(200, parseInt($("btLookback") ? $("btLookback").value || "900" : "900", 10)),
        keepN: Math.max(1, parseInt($("btKeepN") ? $("btKeepN").value || "5" : "5", 10)),
        params,
        tradeManagement
      };
    }

    function updateStrategyInfo() {
      const s = strategyApi.getStrategy(strategySelect.value);
      if (!s) {
        strategyInfo.textContent = "No strategy selected.";
        return;
      }

      strategyInfo.textContent =
        "ID: " +
        s.id +
        " | " +
        (s.notes || "No notes") +
        " | defaultParams=" +
        JSON.stringify(s.defaultParams || {}) +
        " | tradeDefaults=" +
        JSON.stringify(s.tradeManagementDefaults || {});
    }

    function resetParamsToDefault() {
      const s = strategyApi.getStrategy(strategySelect.value);
      paramsInput.value = JSON.stringify((s && s.defaultParams) || {}, null, 0);
      tradeMgmtInput.value = JSON.stringify((s && s.tradeManagementDefaults) || {}, null, 0);
      updateStrategyInfo();
    }

    function renderSummary(report) {
      const s = report.summary || {};
      let html =
        "<strong>Trades:</strong> " +
        (s.totalTrades || 0) +
        " | <strong>Wins:</strong> " +
        (s.wins || 0) +
        " | <strong>Losses:</strong> " +
        (s.losses || 0) +
        " | <strong>Win rate:</strong> " +
        Number(s.winRate || 0).toFixed(1) +
        "%" +
        "<br><strong>Gross Ticks:</strong> " +
        Number(s.grossTicks || 0).toFixed(1) +
        " | <strong>Avg R:</strong> " +
        Number(s.avgR || 0).toFixed(2) +
        "<br><strong>Range:</strong> " +
        (report.rangePreset || "week") +
        " | <strong>Strategy:</strong> " +
        (report.strategyName || report.strategyId || "n/a");

      if (s.bySystem && (s.bySystem.MAIN || s.bySystem.BURST)) {
        const m = s.bySystem.MAIN || {};
        const b = s.bySystem.BURST || {};
        html +=
          '<br><div style="margin-top:8px;overflow-x:auto;"><table><thead><tr><th>System</th><th>Trades</th><th>Wins</th><th>Losses</th><th>Win Rate</th><th>Gross Ticks</th><th>Gross Currency</th></tr></thead><tbody>' +
          "<tr><td>MAIN</td><td>" +
          Number(m.totalTrades || 0) +
          "</td><td>" +
          Number(m.wins || 0) +
          "</td><td>" +
          Number(m.losses || 0) +
          "</td><td>" +
          Number(m.winRate || 0).toFixed(1) +
          "%</td><td>" +
          Number(m.grossTicks || 0).toFixed(1) +
          "</td><td>" +
          Number(m.grossCurrency || 0).toFixed(2) +
          "</td></tr>" +
          "<tr><td>BURST</td><td>" +
          Number(b.totalTrades || 0) +
          "</td><td>" +
          Number(b.wins || 0) +
          "</td><td>" +
          Number(b.losses || 0) +
          "</td><td>" +
          Number(b.winRate || 0).toFixed(1) +
          "%</td><td>" +
          Number(b.grossTicks || 0).toFixed(1) +
          "</td><td>" +
          Number(b.grossCurrency || 0).toFixed(2) +
          "</td></tr>" +
          "</tbody></table></div>";
      }

      summaryEl.innerHTML = html;
    }

    function renderTrades(report) {
      const rows = (report.trades || []).slice(-200).reverse();
      if (!rows.length) {
        $("btResults").innerHTML = '<div class="small">No trades generated for selected range/settings.</div>';
        return;
      }

      let html =
        '<div style="overflow-x:auto;"><table><thead><tr><th>#</th><th>System</th><th>Label</th><th>Side</th><th>Entry Time</th><th>Entry</th><th>Exit Time</th><th>Exit</th><th>Reason</th><th>PnL Ticks</th><th>R</th></tr></thead><tbody>';

      rows.forEach((t) => {
        html +=
          "<tr><td>" +
          t.trade +
          "</td><td>" +
          (t.system || "-") +
          "</td><td>" +
          (t.entryLabel || "-") +
          "</td><td>" +
          t.side +
          "</td><td>" +
          fmtTime(t.entryTime) +
          "</td><td>" +
          Number(t.entryPrice).toFixed(5) +
          "</td><td>" +
          fmtTime(t.exitTime) +
          "</td><td>" +
          Number(t.exitPrice).toFixed(5) +
          "</td><td>" +
          t.exitReason +
          "</td><td>" +
          Number(t.pnlTicks).toFixed(1) +
          "</td><td>" +
          Number(t.pnlR).toFixed(2) +
          "</td></tr>";
      });

      html += "</tbody></table></div>";
      $("btResults").innerHTML = html;
    }

    function renderVerification(report) {
      const v = report.verification || {};
      const show = !showVerificationEl || !!showVerificationEl.checked;
      if (!show) {
        verificationEl.textContent = "Verification diagnostics hidden.";
        return;
      }

      verificationEl.textContent = JSON.stringify(
        {
          rangePreset: v.rangePreset,
          rangeFrom: fmtTime(v.rangeFrom || 0),
          rangeTo: fmtTime(v.rangeTo || 0),
          candlesReceived: v.candlesReceived,
          candlesClosed: v.candlesClosed,
          candlesInRange: v.candlesInRange,
          signalsTotal: v.signalsTotal,
          signalsInRange: v.signalsInRange,
          monotonicTime: v.monotonicTime,
          missingTimeCount: v.missingTimeCount,
          tradeManagement: report.tradeManagement,
          params: report.params
        },
        null,
        2
      );
    }

    function renderOptimizerReport(text) {
      optimizerReportEl.textContent = text || "No optimizer output yet.";
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
            " range=" +
            input.rangePreset +
            " lookback=" +
            input.lookback +
            " keep=" +
            input.keepN
        );

        const report = await strategyApi.runBacktest(input.strategyId, input);
        renderSummary(report);
        renderTrades(report);
        renderVerification(report);
        setStatus("Done", "ok");
        log(
          "Backtest done. trades=" +
            ((report.summary && report.summary.totalTrades) || 0) +
            " winRate=" +
            Number((report.summary && report.summary.winRate) || 0).toFixed(1) +
            "%"
        );
      } catch (e) {
        setStatus("Failed", "bad");
        log("[ERR] " + (e && e.message ? e.message : String(e)));
      }
    }

    async function runOptimizer() {
      setStatus("Optimizing...", "warn");
      renderOptimizerReport("Optimizer running...");

      try {
        const input = getBacktestInputs();
        const targetWinRate = Number(targetWinRateEl.value || 60);
        const maxCandidates = Number(maxCandidatesEl.value || 120);

        log(
          "Optimizer run: " +
            input.strategyId +
            " targetWinRate=" +
            targetWinRate +
            " maxCandidates=" +
            maxCandidates
        );

        const result = await strategyApi.optimizeBacktest(input.strategyId, input, {
          targetWinRate,
          maxCandidates
        });

        paramsInput.value = JSON.stringify(result.bestParams || {}, null, 0);
        tradeMgmtInput.value = JSON.stringify(result.bestTradeManagement || {}, null, 0);

        if (result.best) {
          renderSummary(result.best);
          renderTrades(result.best);
          renderVerification(result.best);
        }

        renderOptimizerReport(result.explanation || "Optimizer completed.");
        setStatus("Optimized", "ok");
        log(
          "Optimizer done. evaluated=" +
            Number(result.evaluated || 0) +
            " baselineWinRate=" +
            Number((result.baseline && result.baseline.summary && result.baseline.summary.winRate) || 0).toFixed(1) +
            "% optimizedWinRate=" +
            Number((result.best && result.best.summary && result.best.summary.winRate) || 0).toFixed(1) +
            "%"
        );
      } catch (e) {
        setStatus("Optimize failed", "bad");
        const msg = e && e.message ? e.message : String(e);
        renderOptimizerReport("Optimizer failed:\n" + msg);
        log("[ERR] Optimizer failed: " + msg);
      }
    }

    strategySelect.addEventListener("change", function () {
      resetParamsToDefault();
    });
    btnRun.addEventListener("click", runSelectedStrategyBacktest);
    btnOptimize.addEventListener("click", runOptimizer);
    btnReset.addEventListener("click", resetParamsToDefault);

    updateStrategyInfo();
    if (!paramsInput.value || paramsInput.value.trim() === "") resetParamsToDefault();

    window.LCPro.AppBacktester = {
      run: runSelectedStrategyBacktest,
      resetParams: resetParamsToDefault,
      setEnabled: function (enabled) {
        btnRun.disabled = !enabled;
        btnOptimize.disabled = !enabled;
      },
      setStatus
    };

    if (showVerificationEl) {
      showVerificationEl.addEventListener("change", function () {
        if (!showVerificationEl.checked) verificationEl.textContent = "Verification diagnostics hidden.";
      });
    }
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

    write("Tools ready (build 20260317-4). Use buttons to run checks or test orders.");

    const btnHealthCheck = $("btnHealthCheck");
    const btnDumpState = $("btnDumpState");
    const btnRefreshOrders = $("btnRefreshOrders");
    const btnTestCalc = $("btnTestCalc");
    const btnTestBuyTpSl = $("btnTestBuyTpSl");
    const btnTestSellTpSl = $("btnTestSellTpSl");
    const btnChangeTpSlSelected = $("btnChangeTpSlSelected");
    const btnCloseAllPositions = $("btnCloseAllPositions");
    const btnCloseOrderById = $("btnCloseOrderById");
    const btnRefreshActionButtons = $("btnRefreshActionButtons");
    const btnCheckHarnessConnection = $("btnCheckHarnessConnection");
    const btnCopyToolsOutput = $("btnCopyToolsOutput");
    const toolActionButtons = $("toolActionButtons");
    const toolActionPayload = $("toolActionPayload");
    const toolActionStatus = $("toolActionStatus");
    const toolOrderId = $("toolOrderId");
    let entrySubmitInFlight = false;
    const actionControls = {
      closeSideSelect: null,
      closeOrderSelect: null,
      marketSideSelect: null,
      marketTpInput: null,
      marketSlInput: null,
      marketTickInput: null,
      marketLotsInput: null
    };

    function getHarnessConnectionDiagnostics() {
      const lc = window.LCPro || null;
      const core = lc && lc.Core ? lc.Core : null;
      const marketData = lc && lc.MarketData ? lc.MarketData : null;
      const trading = lc && lc.Trading ? lc.Trading : null;
      const strategy = lc && lc.Strategy ? lc.Strategy : null;

      let frameworkStatus = { ok: false, error: "Core unavailable" };
      if (core && typeof core.ensureFramework === "function") {
        try {
          const fw = core.ensureFramework();
          frameworkStatus = {
            ok: !!fw,
            hasOrders: !!(fw && fw.Orders),
            hasPositions: !!(fw && fw.Positions)
          };
        } catch (e) {
          frameworkStatus = { ok: false, error: e && e.message ? e.message : String(e) };
        }
      }

      return {
        ts: new Date().toISOString(),
        hasLCPro: !!lc,
        modules: {
          Core: !!core,
          MarketData: !!marketData,
          Trading: !!trading,
          Strategy: !!strategy
        },
        framework: frameworkStatus,
        tradingMethods: {
          executeAction: !!(trading && typeof trading.executeAction === "function"),
          listActions: !!(trading && typeof trading.listActions === "function"),
          sendMarketOrder: !!(trading && typeof trading.sendMarketOrder === "function"),
          entryThenModify: !!(trading && typeof trading.entryThenModify === "function"),
          closeOrderById: !!(trading && typeof trading.closeOrderById === "function"),
          closeAllPositions: !!(trading && typeof trading.closeAllPositions === "function"),
          closeSideOnInstrument: !!(trading && typeof trading.closeSideOnInstrument === "function")
        }
      };
    }

    function readToolTradeInput() {
      return {
        instrument: $("toolActionInstrument")
          ? $("toolActionInstrument").value
          : $("toolInstrument")
            ? $("toolInstrument").value
            : "NAS100",
        lots: $("toolActionLots")
          ? Number($("toolActionLots").value)
          : $("toolLots")
            ? Number($("toolLots").value)
            : 0.01,
        side: $("toolSide") ? $("toolSide").value : "BUY",
        tpTicks: $("toolTpTicks") ? Number($("toolTpTicks").value) : 0,
        slTicks: $("toolSlTicks") ? Number($("toolSlTicks").value) : 0,
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
        if (!res || res.ok !== true) {
          write({
            action: side + " entry_then_change_101",
            instrument: input.instrument,
            error: (res && res.reason) || "Trade could not be started",
            details: res || null
          });
          return;
        }
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
      if (!toolOrderId && !actionControls.closeOrderSelect) return;

      let trades = [];
      try {
        trades =
          window.LCPro.Trading && typeof window.LCPro.Trading.listActiveTradesDetailed === "function"
            ? window.LCPro.Trading.listActiveTradesDetailed()
            : window.LCPro.Trading.listOpenOrdersDetailed();
      } catch (e) {
        if (toolOrderId) toolOrderId.innerHTML = '<option value="">-- Orders unavailable --</option>';
        if (actionControls.closeOrderSelect) {
          actionControls.closeOrderSelect.innerHTML = '<option value="">-- Orders unavailable --</option>';
        }
        return;
      }

      if (!trades.length) {
        if (toolOrderId) toolOrderId.innerHTML = '<option value="">-- No open orders --</option>';
        if (actionControls.closeOrderSelect) {
          actionControls.closeOrderSelect.innerHTML = '<option value="">-- No open orders --</option>';
        }
        return;
      }

      const prev = toolOrderId ? toolOrderId.value : "";
      const opts = ['<option value="">-- Select order --</option>'];
      for (let i = 0; i < trades.length; i++) {
        const id = String(trades[i].tradeId || trades[i].orderId || "");
        const instrument = trades[i].instrumentId || "Unknown";
        const side = inferOrderSideLabel(trades[i].raw);
        const source = String(trades[i].source || "trade").toUpperCase();
        if (!id) continue;
        opts.push(
          '<option value="' + id + '">' + instrument + " | " + side + " | " + source + " | #" + id + "</option>"
        );
      }
      if (toolOrderId) {
        toolOrderId.innerHTML = opts.join("");
        if (prev && trades.some((o) => String(o.tradeId || o.orderId) === prev)) toolOrderId.value = prev;
      }

      if (actionControls.closeOrderSelect) {
        const prevHarness = actionControls.closeOrderSelect.value;
        actionControls.closeOrderSelect.innerHTML = opts.join("");
        if (prevHarness && trades.some((o) => String(o.tradeId || o.orderId) === prevHarness)) {
          actionControls.closeOrderSelect.value = prevHarness;
        }
      }
    }

    function readToolActionOverridePayload() {
      if (!toolActionPayload) return {};
      const raw = String(toolActionPayload.value || "{}").trim();
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          write("Payload override must be a JSON object.");
          return null;
        }
        return parsed;
      } catch (e) {
        write("Invalid payload override JSON: " + (e && e.message ? e.message : String(e)));
        return null;
      }
    }

    function buildDefaultActionPayload(actionName) {
      const input = readToolTradeInput();
      const action = String(actionName || "").toUpperCase();
      if (action === "BUY" || action === "SELL") {
        return {
          instrumentId: input.instrument,
          lots: input.lots
        };
      }
      if (action === "MARKET_ORDER_TPSL") {
        return {
          instrumentId: input.instrument,
          side: actionControls.marketSideSelect ? String(actionControls.marketSideSelect.value || input.side) : input.side,
          lots: actionControls.marketLotsInput ? Number(actionControls.marketLotsInput.value || input.lots) : input.lots,
          tpTicks: Math.max(
            0,
            actionControls.marketTpInput ? Number(actionControls.marketTpInput.value || input.tpTicks || 0) : Number(input.tpTicks || 0)
          ),
          slTicks: Math.max(
            0,
            actionControls.marketSlInput ? Number(actionControls.marketSlInput.value || input.slTicks || 0) : Number(input.slTicks || 0)
          ),
          tickSize: Math.max(
            0.00001,
            actionControls.marketTickInput
              ? Number(actionControls.marketTickInput.value || input.tickSize || 1)
              : Number(input.tickSize || 1)
          )
        };
      }
      if (action === "CLOSE_SIDE") {
        return {
          instrumentId: input.instrument,
          side: actionControls.closeSideSelect ? String(actionControls.closeSideSelect.value || input.side) : input.side
        };
      }
      if (action === "CLOSE_ORDER") {
        return {
          orderId:
            actionControls.closeOrderSelect && actionControls.closeOrderSelect.value
              ? String(actionControls.closeOrderSelect.value)
              : toolOrderId && toolOrderId.value
                ? String(toolOrderId.value)
                : ""
        };
      }
      if (action === "CLOSE_ALL") {
        return {};
      }
      return {
        instrumentId: input.instrument,
        side: input.side,
        lots: input.lots,
        tpTicks: Math.max(0, Number(input.tpTicks || 0)),
        slTicks: Math.max(0, Number(input.slTicks || 0)),
        tickSize: Math.max(0.00001, Number(input.tickSize || 1)),
        orderId: toolOrderId && toolOrderId.value ? String(toolOrderId.value) : ""
      };
    }

    async function runRegisteredAction(actionName) {
      const action = String(actionName || "").toUpperCase();
      let Trading = window.LCPro && window.LCPro.Trading ? window.LCPro.Trading : null;
      if (!Trading) {
        const deadline = Date.now() + 2000;
        while (!Trading && Date.now() < deadline) {
          await new Promise(function (r) {
            setTimeout(r, 100);
          });
          Trading = window.LCPro && window.LCPro.Trading ? window.LCPro.Trading : null;
        }
      }
      if (!Trading) {
        write({
          error: "Trading module is unavailable.",
          diagnostics: getHarnessConnectionDiagnostics(),
          hint: "Run Check Connection and confirm build stamp is latest."
        });
        return;
      }

      const override = readToolActionOverridePayload();
      if (override == null) return;

      const payload = Object.assign({}, buildDefaultActionPayload(action), override);
      write({ action, payload, status: "running" });
      try {
        let result = null;
        if (typeof Trading.executeAction === "function") {
          result = await Trading.executeAction(action, payload);
        } else {
          if (action === "BUY" || action === "SELL") {
            const side = action;
            const lots = Number(payload.lots || payload.size_lots || payload.sizeLots || 0);
            if (!payload.instrumentId) throw new Error("Missing instrumentId");
            if (!Number.isFinite(lots) || lots <= 0) throw new Error("Invalid lots");
            result = await Trading.sendMarketOrder(String(payload.instrumentId), side, lots);
          } else if (action === "MARKET_ORDER_TPSL") {
            const side = String(payload.side || "").toUpperCase();
            const lots = Number(payload.lots || payload.size_lots || payload.sizeLots || 0);
            const tpTicks = Math.max(0, Number(payload.tpTicks || 0));
            const slTicks = Math.max(0, Number(payload.slTicks || 0));
            const tickSize = Math.max(0.00001, Number(payload.tickSize || 1));
            if (!payload.instrumentId) throw new Error("Missing instrumentId");
            if (side !== "BUY" && side !== "SELL") throw new Error("Missing/invalid side");
            if (!Number.isFinite(lots) || lots <= 0) throw new Error("Invalid lots");
            if (tpTicks > 0 || slTicks > 0) {
              result = await Trading.entryThenModify(String(payload.instrumentId), side, lots, tpTicks, slTicks, tickSize);
            } else {
              result = await Trading.sendMarketOrder(String(payload.instrumentId), side, lots);
            }
          } else if (action === "CLOSE_SIDE") {
            const side = String(payload.side || "").toUpperCase();
            if (!payload.instrumentId) throw new Error("Missing instrumentId");
            if (side !== "BUY" && side !== "SELL") throw new Error("Missing/invalid side");
            result = await Trading.closeSideOnInstrument(String(payload.instrumentId), side);
          } else if (action === "CLOSE_ALL") {
            result = await Trading.closeAllPositions();
          } else if (action === "CLOSE_ORDER") {
            if (!payload.orderId) throw new Error("Missing orderId");
            result = await Trading.closeOrderById(String(payload.orderId));
          } else {
            throw new Error("Unsupported action without executeAction: " + action);
          }
        }
        write({ action, payload, result });
        refreshOrderDropdown();
      } catch (e) {
        write({ action, payload, error: e && e.message ? e.message : String(e) });
      }
    }

    function renderActionButtons() {
      if (!toolActionButtons) return;
      const actions =
        window.LCPro && window.LCPro.Trading && typeof window.LCPro.Trading.listActions === "function"
          ? window.LCPro.Trading.listActions()
          : [];
      let names = Array.isArray(actions)
        ? actions
            .map(function (name) {
              return String(name || "").toUpperCase();
            })
            .filter(Boolean)
            .sort()
        : [];

      if (!names.length) {
        names = ["BUY", "SELL", "CLOSE_SIDE", "CLOSE_ALL", "CLOSE_ORDER", "MARKET_ORDER_TPSL"];
      }

      toolActionButtons.innerHTML = "";
      if (!names.length) {
        const msg = document.createElement("div");
        msg.className = "small";
        msg.textContent = "No trading actions found in registry.";
        toolActionButtons.appendChild(msg);
        if (toolActionStatus) toolActionStatus.textContent = "No actions found in registry.";
        return;
      }

      if (toolActionStatus) {
        toolActionStatus.textContent = "Loaded " + names.length + " action(s): " + names.join(", ");
      }

      actionControls.closeSideSelect = null;
      actionControls.closeOrderSelect = null;
      actionControls.marketSideSelect = null;
      actionControls.marketTpInput = null;
      actionControls.marketSlInput = null;
      actionControls.marketTickInput = null;
      actionControls.marketLotsInput = null;

      for (let i = 0; i < names.length; i++) {
        const actionName = names[i];
        const row = document.createElement("div");
        row.className = "row";
        row.style.width = "100%";
        row.style.gap = "8px";
        row.style.alignItems = "center";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "Test " + actionName;
        btn.addEventListener("click", async function () {
          btn.disabled = true;
          try {
            await runRegisteredAction(actionName);
          } finally {
            btn.disabled = false;
          }
        });
        row.appendChild(btn);

        if (actionName === "CLOSE_SIDE") {
          const sideSelect = document.createElement("select");
          sideSelect.style.width = "150px";
          sideSelect.innerHTML = '<option value="BUY">BUY</option><option value="SELL">SELL</option>';
          actionControls.closeSideSelect = sideSelect;
          row.appendChild(sideSelect);
        }

        if (actionName === "CLOSE_ORDER") {
          const orderSelect = document.createElement("select");
          orderSelect.style.minWidth = "260px";
          orderSelect.innerHTML = '<option value="">-- No open orders --</option>';
          actionControls.closeOrderSelect = orderSelect;
          row.appendChild(orderSelect);
        }

        if (actionName === "MARKET_ORDER_TPSL") {
          const sideSelect = document.createElement("select");
          sideSelect.style.width = "120px";
          sideSelect.innerHTML = '<option value="BUY">BUY</option><option value="SELL">SELL</option>';

          const lotsInput = document.createElement("input");
          lotsInput.type = "number";
          lotsInput.step = "0.01";
          lotsInput.min = "0.01";
          lotsInput.style.width = "120px";
          lotsInput.value = String(readToolTradeInput().lots || 0.01);
          lotsInput.title = "Lots";

          const tpInput = document.createElement("input");
          tpInput.type = "number";
          tpInput.style.width = "110px";
          tpInput.value = String(readToolTradeInput().tpTicks || 0);
          tpInput.title = "TP Ticks";

          const slInput = document.createElement("input");
          slInput.type = "number";
          slInput.style.width = "110px";
          slInput.value = String(readToolTradeInput().slTicks || 0);
          slInput.title = "SL Ticks";

          const tickInput = document.createElement("input");
          tickInput.type = "number";
          tickInput.step = "0.0001";
          tickInput.style.width = "110px";
          tickInput.value = String(readToolTradeInput().tickSize || 1);
          tickInput.title = "Tick Size";

          actionControls.marketSideSelect = sideSelect;
          actionControls.marketLotsInput = lotsInput;
          actionControls.marketTpInput = tpInput;
          actionControls.marketSlInput = slInput;
          actionControls.marketTickInput = tickInput;

          row.appendChild(sideSelect);
          row.appendChild(lotsInput);
          row.appendChild(tpInput);
          row.appendChild(slInput);
          row.appendChild(tickInput);
        }

        toolActionButtons.appendChild(row);
      }

      refreshOrderDropdown();
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
          const res =
            window.LCPro.Trading && typeof window.LCPro.Trading.executeAction === "function"
              ? await window.LCPro.Trading.executeAction("CLOSE_ALL", {})
              : await window.LCPro.Trading.closeAllPositions();
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

    if (btnRefreshActionButtons) {
      btnRefreshActionButtons.addEventListener("click", function () {
        renderActionButtons();
        const names =
          window.LCPro && window.LCPro.Trading && typeof window.LCPro.Trading.listActions === "function"
            ? window.LCPro.Trading.listActions()
            : [];
        const count = Array.isArray(names) ? names.length : 0;
        write("Action buttons refreshed from trading registry. Count=" + count);
      });
    }

    if (btnCheckHarnessConnection) {
      btnCheckHarnessConnection.addEventListener("click", function () {
        write({ action: "check_connection", diagnostics: getHarnessConnectionDiagnostics() });
      });
    }

    if (btnCopyToolsOutput) {
      btnCopyToolsOutput.addEventListener("click", async function () {
        const text = out ? String(out.textContent || "") : "";
        if (!text.trim()) {
          write("Nothing to copy yet.");
          return;
        }

        function tryLegacyCopy(value) {
          try {
            const ta = document.createElement("textarea");
            ta.value = value;
            ta.setAttribute("readonly", "readonly");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            const ok = document.execCommand("copy");
            document.body.removeChild(ta);
            return !!ok;
          } catch (e) {
            return false;
          }
        }

        function selectOutputForManualCopy() {
          try {
            if (!out) return false;
            const selection = window.getSelection ? window.getSelection() : null;
            if (!selection || !document.createRange) return false;
            const range = document.createRange();
            range.selectNodeContents(out);
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
          } catch (e) {
            return false;
          }
        }

        try {
          if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(text);
            write("Copied output to clipboard.");
            return;
          }
        } catch (e) {
          // Continue into legacy fallback path.
        }

        if (tryLegacyCopy(text)) {
          write("Copied output to clipboard (legacy fallback).");
          return;
        }

        if (selectOutputForManualCopy()) {
          write("Clipboard is blocked by page policy. Output was selected - press Ctrl+C (or Cmd+C). ");
          return;
        }

        write("Copy failed: Clipboard API blocked and fallback methods are unavailable in this context.");
      });
    }

    refreshOrderDropdown();
    renderActionButtons();
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
      homeLiveController = initHomeLiveControls(log);
      setTab("Home");
      uiInitialized = true;
    }

    let Framework = null;
    try {
      Framework = window.LCPro.Core.ensureFramework();
    } catch (e) {
      if (homeLiveController) homeLiveController.setFrameworkReady(false);
      setStatus("Waiting for framework...", "warn");
      log("[WARN] Framework not ready yet: " + (e.message || String(e)));
      setTimeout(setup, 1000);
      return;
    }

    Framework.OnLoad = function () {
      setStatus("Connected", "ok");
      log("[OK] Framework loaded");
      if (homeLiveController) homeLiveController.setFrameworkReady(true);

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
