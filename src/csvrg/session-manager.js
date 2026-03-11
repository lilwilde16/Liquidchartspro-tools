(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  LCPro.CSVRG = LCPro.CSVRG || {};

  function hmToMinutes(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ""));
    if (!m) return 0;
    const h = Math.max(0, Math.min(23, Number(m[1])));
    const mm = Math.max(0, Math.min(59, Number(m[2])));
    return h * 60 + mm;
  }

  function nyParts(nowMs) {
    const d = new Date(nowMs || Date.now());
    const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });
    const hmFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const weekday = weekdayFmt.format(d);
    const parts = hmFmt.formatToParts(d);
    let h = 0;
    let m = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].type === "hour") h = Number(parts[i].value || 0);
      if (parts[i].type === "minute") m = Number(parts[i].value || 0);
    }
    return { weekday, minutes: h * 60 + m };
  }

  function is_friday_shutdown_time(settings, nowMs) {
    const p = nyParts(nowMs);
    return p.weekday === "Fri" && p.minutes >= hmToMinutes(settings.friday_close_all_time_ny);
  }

  function is_sunday_resume_time(settings, nowMs) {
    const p = nyParts(nowMs);
    return p.weekday === "Sun" && p.minutes >= hmToMinutes(settings.sunday_resume_time_ny);
  }

  function is_valid_session(settings, nowMs) {
    const p = nyParts(nowMs);

    if (p.weekday === "Sat") return false;
    if (p.weekday === "Sun" && !is_sunday_resume_time(settings, nowMs)) return false;
    if (is_friday_shutdown_time(settings, nowMs)) return false;

    const start = hmToMinutes(settings.trading_start_ny);
    const end = hmToMinutes(settings.trading_end_ny);
    return p.minutes >= start && p.minutes <= end;
  }

  function handle_session_state(state) {
    const s = state.settings;
    const now = Date.now();

    if (is_friday_shutdown_time(s, now)) {
      state.bot_enabled = false;
      return { bot_enabled: false, reason: "FRIDAY_SHUTDOWN" };
    }

    if (is_sunday_resume_time(s, now)) {
      state.bot_enabled = true;
    }

    return {
      bot_enabled: state.bot_enabled,
      valid_session: is_valid_session(s, now)
    };
  }

  LCPro.CSVRG.SessionManager = {
    is_valid_session,
    is_friday_shutdown_time,
    is_sunday_resume_time,
    handle_session_state
  };
})();
