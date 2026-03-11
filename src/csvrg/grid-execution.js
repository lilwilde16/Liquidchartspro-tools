(function () {
  "use strict";

  const LCPro = (window.LCPro = window.LCPro || {});
  LCPro.CSVRG = LCPro.CSVRG || {};

  function calculate_grid_spacing(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return null;
    const atr = Number(ps.indicators.ATR);
    if (!Number.isFinite(atr) || atr <= 0) return null;
    return atr * state.settings.grid_spacing_atr_multiplier;
  }

  function build_grid_levels(state, pair, side) {
    const ps = state.pair_states[pair];
    if (!ps) return [];

    const spacing = calculate_grid_spacing(state, pair);
    const center = Number(ps.mid);
    const maxLevels = Math.max(1, state.settings.max_grid_levels);
    if (!Number.isFinite(spacing) || !Number.isFinite(center) || spacing <= 0) return [];

    const levels = [];
    for (let i = 0; i < maxLevels; i++) {
      const step = i * spacing;
      const entry = side === "BUY" ? center - step : center + step;
      levels.push({
        level: i + 1,
        side,
        entry_price: entry,
        size_lots: state.settings.base_grid_lot,
        active: false
      });
    }

    return levels;
  }

  async function place_grid_orders(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps || !ps.grid.active) return [];

    // Pending-order placement differs by broker adapter. This keeps architecture bounded and deterministic.
    ps.grid.pending_orders = ps.grid.levels.map((x) => ({ level: x.level, entry_price: x.entry_price, side: x.side }));
    return ps.grid.pending_orders;
  }

  function cancel_grid_orders(state, pair) {
    const ps = state.pair_states[pair];
    if (!ps) return;
    ps.grid.pending_orders = [];
  }

  async function activate_grid(state, pair, side) {
    const ps = state.pair_states[pair];
    if (!ps || ps.grid.active) return false;

    const spacing = calculate_grid_spacing(state, pair);
    if (!Number.isFinite(spacing) || spacing <= 0) return false;

    ps.grid.active = true;
    ps.grid.side = side;
    ps.grid.center_price = ps.mid;
    ps.grid.spacing = spacing;
    ps.grid.levels = build_grid_levels(state, pair, side);

    await place_grid_orders(state, pair);
    return true;
  }

  LCPro.CSVRG.GridExecution = {
    calculate_grid_spacing,
    build_grid_levels,
    activate_grid,
    place_grid_orders,
    cancel_grid_orders
  };
})();
