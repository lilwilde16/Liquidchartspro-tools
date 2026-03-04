/**
 * signals-display.js — Last 5 Signals Display
 *
 * Provides window.SignalsDisplay with helpers to store, retrieve, and render
 * the last 5 trading signals emitted by any strategy engine.
 *
 * HOW TO CONNECT A LIVE STRATEGY:
 * ─────────────────────────────────
 * After a strategy produces a signal object, call:
 *
 *   window.SignalsDisplay.push({
 *     pair:       "EUR/USD",       // instrument name
 *     dir:        1,               // 1 = BUY, -1 = SELL
 *     confidence: 0.82,            // 0–1 score
 *     reason:     "SMA crossover", // short human-readable reason
 *     time:       Date.now()       // Unix ms timestamp
 *   });
 *
 * The display element (id="lastSignalsTable") in index.html is automatically
 * populated. You can also call window.SignalsDisplay.render() at any time to
 * refresh the table.
 *
 * EXAMPLE — wiring to the AutoTrader engine:
 *   Inside engine-autotrader.js, after building `candidate`, add:
 *     window.SignalsDisplay.push({
 *       pair: candidate.pair, dir: candidate.dir,
 *       confidence: candidate.confidence, reason: candidate.reason,
 *       time: Date.now()
 *     });
 */
(function () {
  "use strict";

  const MAX_SIGNALS = 5;
  const STORAGE_KEY = "lc.lastSignals.v1";

  // ── Storage helpers ─────────────────────────────────────────────────────────

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  function save(signals) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(signals));
    } catch (_) {}
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let signals = load();

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Add a signal to the top of the list. Keeps the last MAX_SIGNALS entries.
   * @param {{ pair:string, dir:number, confidence:number, reason:string, time:number }} sig
   */
  function push(sig) {
    if (!sig || !sig.pair) return;
    signals.unshift({
      pair:       String(sig.pair),
      dir:        Number(sig.dir) === 1 ? 1 : -1,
      confidence: Number.isFinite(sig.confidence) ? sig.confidence : 0,
      reason:     String(sig.reason || ""),
      time:       Number.isFinite(sig.time) ? sig.time : Date.now()
    });
    if (signals.length > MAX_SIGNALS) signals = signals.slice(0, MAX_SIGNALS);
    save(signals);
    render();
  }

  /** Clear all stored signals. */
  function clear() {
    signals = [];
    save(signals);
    render();
  }

  /** Return the current list of signals (newest first). */
  function getAll() {
    return signals.slice();
  }

  /**
   * Render the last N signals into the element with id="lastSignalsTable".
   * If the element is not present, this is a no-op.
   */
  function render() {
    const el = document.getElementById("lastSignalsTable");
    if (!el) return;

    if (signals.length === 0) {
      el.innerHTML = "<p class='noSignals'>No signals yet — start the AutoTrader or run a scan.</p>";
      return;
    }

    const rows = signals.map(function (s) {
      const dirLabel = s.dir === 1 ? "▲ BUY" : "▼ SELL";
      const dirClass = s.dir === 1 ? "bull" : "bear";
      const conf     = (s.confidence * 100).toFixed(0) + "%";
      const dt       = new Date(s.time);
      const pad      = function (n) { return String(n).padStart(2, "0"); };
      const timeStr  =
        dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate()) +
        " " + pad(dt.getUTCHours()) + ":" + pad(dt.getUTCMinutes()) + " UTC";

      return (
        "<tr>" +
          "<td>" + s.pair + "</td>" +
          "<td class='" + dirClass + "'>" + dirLabel + "</td>" +
          "<td>" + conf + "</td>" +
          "<td>" + s.reason + "</td>" +
          "<td style='font-size:10px;color:#aaa'>" + timeStr + "</td>" +
        "</tr>"
      );
    }).join("");

    el.innerHTML =
      "<table class='signalsTable'>" +
        "<thead><tr>" +
          "<th>Pair</th><th>Signal</th><th>Conf</th><th>Reason</th><th>Time (UTC)</th>" +
        "</tr></thead>" +
        "<tbody>" + rows + "</tbody>" +
      "</table>";
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  // Render any persisted signals as soon as the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  // ── Expose ────────────────────────────────────────────────────────────────────
  window.SignalsDisplay = { push: push, clear: clear, getAll: getAll, render: render };
})();
