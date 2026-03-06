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
