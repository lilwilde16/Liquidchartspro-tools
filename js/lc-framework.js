(function(){
    const $ = (id)=>document.getElementById(id);

   const Framework = new Sway.Framework();
    window.LC = window.LC || {};
    window.LC.Framework = Framework;

   function ts(){
         const d=new Date(), pad=n=>(n<10?"0":"")+n;
         let h=d.getHours(), m=d.getMinutes(), s=d.getSeconds();
         const ampm=h>=12?"PM":"AM"; h=h%12; if(h===0) h=12;
         return `[${h}:${pad(m)}:${pad(s)} ${ampm}]`;
   }

   function log(msg){
         const box = $("log");
         box.textContent = `${ts()} ${msg}\n` + box.textContent;
   }

   function setStatus(text, kind){
         const pill=$("statusPill");
         pill.textContent=text;
         pill.className="pill " + (kind||"");
   }

   async function requestCandles(instrumentId, timeframe, count){
         if(Framework.pRequestCandles){
                 return await Framework.pRequestCandles({ instrumentId, timeframe, count, streaming:false });
         }
         return await new Promise((resolve) => {
                 Framework.RequestCandles({ instrumentId, timeframe, count, streaming:false }, (m)=>resolve(m));
         });
   }

   function requestPrices(list){
         try{ Framework.RequestPrices(list); }catch(e){}
   }

   Framework.OnLoad = function(){
         setStatus("Framework responding", "ok");
         log("✅ Framework loaded.");

         // enable core buttons
         $("btnPing").disabled = false;
         $("btnReqPrices").disabled = false;
         $("btnHealth").disabled = false;

         // enable engines (app.js will wire more)
         $("btnStrengthRun").disabled = false;
         $("btnRunBt").disabled = false;

         $("btnPing").onclick = ()=>{
                 log("Ping clicked.");
                 log("RequestPrices exists " + (typeof Framework.RequestPrices === "function" ? "✅" : "❌"));
         };

         $("btnReqPrices").onclick = ()=>{
                 const pairs = ($("pairs")?.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,5);
                 requestPrices(pairs);
                 log("✅ RequestPrices sent for: " + pairs.join(", "));
         };

         $("btnHealth").onclick = ()=>{
                 const hasCandles = !!(Framework.pRequestCandles || Framework.RequestCandles);
                 const hasPrices  = typeof Framework.RequestPrices === "function";
                 const hasSendOrder = typeof Framework.SendOrder === "function";
                 const hasOrders = !!Framework.Orders;
                 const hasPositions = !!Framework.Positions;
                 log("=== HEALTH CHECK ===");
                 log("Candles API: " + (hasCandles?"✅":"❌"));
                 log("RequestPrices: " + (hasPrices?"✅":"❌"));
                 log("SendOrder: " + (hasSendOrder?"✅":"❌"));
                 log("Orders: " + (hasOrders?"✅":"❌"));
                 log("Positions: " + (hasPositions?"✅":"❌"));
                 log("====================");
         };

         $("btnClearLog").onclick = ()=>{ $("log").textContent=""; };

         // best-effort chart context
         try{
                 const inst = (Framework.Chart && Framework.Chart.instrumentId) ? Framework.Chart.instrumentId : null;
                 const tf = (Framework.Chart && Framework.Chart.timeframe) ? Framework.Chart.timeframe : null;
                 if(inst) $("ctxInstrument").value = inst;
                 if(tf) $("ctxTf").value = String(tf);
         }catch(e){}
   };

   window.LC.log = log;
    window.LC.setStatus = setStatus;
    window.LC.requestCandles = requestCandles;
    window.LC.requestPrices = requestPrices;
})();
