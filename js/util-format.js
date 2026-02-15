(function(){
  function num(value, digits = 2){
    const n = Number(value);
    if(!Number.isFinite(n)) return "0";
    return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function pct(value, digits = 1){
    return `${num(value, digits)}%`;
  }

  function money(value, digits = 2){
    const n = Number(value);
    if(!Number.isFinite(n)) return "$0.00";
    return `$${n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
  }

  window.FMT = window.FMT || { num, pct, money };
})();
