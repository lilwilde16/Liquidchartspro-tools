(function(){
    function toChron(arr){
          const out = new Array(arr.length);
          for(let i=0;i<arr.length;i++) out[i]=arr[arr.length-1-i];
          return out;
    }

   function sma(values, len){
         const n=values.length;
         const out=new Array(n).fill(null);
         let sum=0;
         for(let i=0;i<n;i++){
                 sum += values[i];
                 if(i>=len) sum -= values[i-len];
                 if(i>=len-1) out[i]=sum/len;
         }
         return out;
   }

   function atr(high, low, close, len){
         const n=close.length;
         const tr=new Array(n).fill(null);
         for(let i=1;i<n;i++){
                 const a = high[i]-low[i];
                 const b = Math.abs(high[i]-close[i-1]);
                 const c = Math.abs(low[i]-close[i-1]);
                 tr[i]=Math.max(a,b,c);
         }
         const out=new Array(n).fill(null);
         let sum=0;
         for(let i=1;i<=len;i++) sum += (tr[i] ?? 0);
         let prev = sum/len;
         out[len]=prev;
         for(let i=len+1;i<n;i++){
                 prev = ((prev*(len-1)) + (tr[i] ?? 0)) / len;
                 out[i]=prev;
         }
         return out;
   }

   window.UTIL = window.UTIL || {};
    window.UTIL.toChron = toChron;
    window.UTIL.sma = sma;
    window.UTIL.atr = atr;
})();
