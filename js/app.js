(function(){
    const $ = (id)=>document.getElementById(id);

   function ready(){
         $("btnStrengthRun").onclick = ()=>window.ENG.Strength.run();

      $("btnRunBt").onclick = ()=>window.ENG.Backtest.run();
         $("btnStopBt").onclick = ()=>window.ENG.Backtest.stop();
         $("btnClearBt").onclick = ()=>window.ENG.Backtest.clear();
   }

   // wait a bit because Framework loads async
   setTimeout(ready, 0);
})();
