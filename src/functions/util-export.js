(function(){
  "use strict";

  // === EXPORT UTILITIES ===

  // Convert array of objects to CSV string
  function toCSV(data, columns){
    if(!Array.isArray(data) || data.length === 0) return "";
    
    const cols = columns || Object.keys(data[0]);
    const header = cols.join(",");
    
    const rows = data.map((row)=>{
      return cols.map((col)=>{
        let val = row[col];
        if(val === null || val === undefined) val = "";
        
        // Escape values containing commas, quotes, or newlines
        val = String(val);
        if(val.includes(",") || val.includes('"') || val.includes("\n")){
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        
        return val;
      }).join(",");
    });
    
    return header + "\n" + rows.join("\n");
  }

  // Download CSV file
  function downloadCSV(data, filename, columns){
    const csv = toCSV(data, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    downloadBlob(blob, filename || "export.csv");
  }

  // Download JSON file
  function downloadJSON(data, filename){
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
    downloadBlob(blob, filename || "export.json");
  }

  // Download blob as file
  function downloadBlob(blob, filename){
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Clean up
    setTimeout(()=>URL.revokeObjectURL(url), 100);
  }

  // Export trades to CSV
  function exportTradesToCSV(trades, filename){
    if(!Array.isArray(trades) || trades.length === 0){
      console.warn("No trades to export");
      return;
    }
    
    const columns = [
      "trade",
      "pair",
      "direction",
      "entryTime",
      "entryPrice",
      "exitTime",
      "exitPrice",
      "tpPrice",
      "slPrice",
      "exitReason",
      "grossR",
      "netR",
      "pnl",
      "balance",
      "lotSize"
    ];
    
    downloadCSV(trades, filename || "backtest_trades.csv", columns);
  }

  // Export summary to JSON
  function exportSummaryToJSON(summary, filename){
    if(!summary){
      console.warn("No summary to export");
      return;
    }
    
    downloadJSON(summary, filename || "backtest_summary.json");
  }

  // Export full backtest results (trades + summary)
  function exportBacktestResults(trades, summary, baseFilename){
    const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
    const base = baseFilename || `backtest_${timestamp}`;
    
    if(trades && trades.length > 0){
      exportTradesToCSV(trades, `${base}_trades.csv`);
    }
    
    if(summary){
      const fullReport = {
        summary,
        trades
      };
      exportSummaryToJSON(fullReport, `${base}_full_report.json`);
    }
  }

  // Export public API
  window.UTIL = window.UTIL || {};
  window.UTIL.Export = {
    toCSV,
    downloadCSV,
    downloadJSON,
    downloadBlob,
    exportTradesToCSV,
    exportSummaryToJSON,
    exportBacktestResults
  };
})();
