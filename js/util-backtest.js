(function(){
  "use strict";

  // === BACKTEST UTILITY FUNCTIONS ===

  // Calculate maximum drawdown from equity curve
  function maxDrawdown(equityCurve){
    if(!Array.isArray(equityCurve) || equityCurve.length === 0) return 0;
    
    let peak = equityCurve[0];
    let maxDD = 0;
    
    for(let i = 0; i < equityCurve.length; i++){
      const equity = equityCurve[i];
      if(equity > peak) peak = equity;
      const dd = peak > 0 ? ((peak - equity) / peak) : 0;
      if(dd > maxDD) maxDD = dd;
    }
    
    return maxDD;
  }

  // Calculate maximum drawdown percentage from trade records
  function maxDrawdownPct(trades, startingBalance){
    if(!Array.isArray(trades) || trades.length === 0) return 0;
    
    let peak = startingBalance;
    let maxDD = 0;
    
    trades.forEach((trade)=>{
      const balance = Number(trade.balance || 0);
      if(balance > peak) peak = balance;
      if(peak > 0){
        const dd = ((peak - balance) / peak) * 100;
        if(dd > maxDD) maxDD = dd;
      }
    });
    
    return maxDD;
  }

  // Calculate win rate from trades
  function winRate(trades){
    if(!Array.isArray(trades) || trades.length === 0) return 0;
    const wins = trades.filter((t)=>(t.pnl || 0) > 0).length;
    return (wins / trades.length) * 100;
  }

  // Calculate expectancy (average R-multiple)
  function expectancy(trades){
    if(!Array.isArray(trades) || trades.length === 0) return 0;
    const totalR = trades.reduce((sum, t)=>(sum + (t.netR || t.grossR || 0)), 0);
    return totalR / trades.length;
  }

  // Calculate profit factor
  function profitFactor(trades){
    if(!Array.isArray(trades) || trades.length === 0) return 0;
    
    let grossProfit = 0;
    let grossLoss = 0;
    
    trades.forEach((t)=>{
      const pnl = Number(t.pnl || 0);
      if(pnl > 0) grossProfit += pnl;
      else if(pnl < 0) grossLoss += Math.abs(pnl);
    });
    
    return grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  }

  // Calculate Sharpe ratio (simplified, using daily returns)
  function sharpeRatio(equityCurve, riskFreeRate = 0){
    if(!Array.isArray(equityCurve) || equityCurve.length < 2) return 0;
    
    const returns = [];
    for(let i = 1; i < equityCurve.length; i++){
      if(equityCurve[i - 1] > 0){
        returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
      }
    }
    
    if(returns.length === 0) return 0;
    
    const avgReturn = returns.reduce((a, b)=>a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r)=>sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev > 0 ? (avgReturn - riskFreeRate) / stdDev : 0;
  }

  // Get pip size for an instrument
  function pipSize(pair){
    if(!pair) return 0.0001;
    const p = String(pair).toUpperCase();
    return (p.includes("JPY") || p.endsWith("JPY")) ? 0.01 : 0.0001;
  }

  // Convert price difference to pips
  function priceToPips(priceDiff, pair){
    const ps = pipSize(pair);
    return ps > 0 ? priceDiff / ps : 0;
  }

  // Convert pips to price difference
  function pipsToPrice(pips, pair){
    return pips * pipSize(pair);
  }

  // Round price to tick size
  function roundToTick(price, pair){
    const ps = pipSize(pair);
    if(!Number.isFinite(price) || !Number.isFinite(ps) || ps <= 0) return price;
    return Math.round(price / ps) * ps;
  }

  // Calculate lot size for position sizing
  function calculateLotSize(balance, riskPercent, slPips, pair){
    if(!Number.isFinite(balance) || balance <= 0) return 0;
    if(!Number.isFinite(riskPercent) || riskPercent <= 0) return 0;
    if(!Number.isFinite(slPips) || slPips <= 0) return 0;
    
    const riskAmount = balance * (riskPercent / 100);
    const ps = pipSize(pair);
    
    // Standard lot value per pip (approximate for forex)
    const pipValue = 10; // $10 per pip for 1 standard lot on most pairs
    const lotSize = riskAmount / (slPips * pipValue);
    
    // Round to 0.01 lot increments
    return Math.max(0.01, Math.round(lotSize * 100) / 100);
  }

  // Format timestamp
  function formatTimestamp(ms){
    if(!Number.isFinite(ms)) return "N/A";
    const d = new Date(ms);
    return d.toISOString().replace("T", " ").substring(0, 19);
  }

  // Format duration in milliseconds to human readable
  function formatDuration(ms){
    if(!Number.isFinite(ms) || ms < 0) return "0s";
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if(days > 0) return `${days}d ${hours % 24}h`;
    if(hours > 0) return `${hours}h ${minutes % 60}m`;
    if(minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // Calculate trade statistics summary
  function calculateTradeStats(trades, startingBalance){
    if(!Array.isArray(trades) || trades.length === 0){
      return {
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        expectancy: 0,
        profitFactor: 0,
        maxDD: 0,
        finalBalance: startingBalance || 0,
        totalPnL: 0
      };
    }
    
    const wins = trades.filter((t)=>(t.pnl || 0) > 0).length;
    const losses = trades.filter((t)=>(t.pnl || 0) < 0).length;
    const finalBalance = trades[trades.length - 1]?.balance || startingBalance || 0;
    const totalPnL = finalBalance - (startingBalance || 0);
    
    return {
      totalTrades: trades.length,
      wins,
      losses,
      winRate: winRate(trades),
      expectancy: expectancy(trades),
      profitFactor: profitFactor(trades),
      maxDD: maxDrawdownPct(trades, startingBalance || 0),
      finalBalance,
      totalPnL
    };
  }

  // Export public API
  window.UTIL = window.UTIL || {};
  window.UTIL.BT = {
    maxDrawdown,
    maxDrawdownPct,
    winRate,
    expectancy,
    profitFactor,
    sharpeRatio,
    pipSize,
    priceToPips,
    pipsToPrice,
    roundToTick,
    calculateLotSize,
    formatTimestamp,
    formatDuration,
    calculateTradeStats
  };
})();
