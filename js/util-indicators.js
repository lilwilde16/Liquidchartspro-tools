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

   // RSI using Wilder's smoothing method (7-period default)
   function rsi(close, len=7){
         const n=close.length;
         const out=new Array(n).fill(null);
         if(n<len+1) return out;

         let avgGain=0, avgLoss=0;
         for(let i=1;i<=len;i++){
                 const delta = close[i]-close[i-1];
                 if(delta>0) avgGain += delta;
                 else avgLoss += Math.abs(delta);
         }
         avgGain /= len;
         avgLoss /= len;

         const rs = avgLoss===0 ? 100 : avgGain/avgLoss;
         out[len] = 100 - (100/(1+rs));

         for(let i=len+1;i<n;i++){
                 const delta = close[i]-close[i-1];
                 const gain = delta>0 ? delta : 0;
                 const loss = delta<0 ? Math.abs(delta) : 0;

                 avgGain = ((avgGain*(len-1)) + gain) / len;
                 avgLoss = ((avgLoss*(len-1)) + loss) / len;

                 const rs2 = avgLoss===0 ? 100 : avgGain/avgLoss;
                 out[i] = 100 - (100/(1+rs2));
         }
         return out;
   }

   // Linear regression slope
   function linregSlope(values, len){
         const n=values.length;
         const out=new Array(n).fill(null);
         for(let i=len-1;i<n;i++){
                 let sumX=0, sumY=0, sumXY=0, sumX2=0;
                 for(let j=0;j<len;j++){
                         const x=j;
                         const y=values[i-len+1+j];
                         sumX += x;
                         sumY += y;
                         sumXY += x*y;
                         sumX2 += x*x;
                 }
                 const slope = (len*sumXY - sumX*sumY) / (len*sumX2 - sumX*sumX);
                 out[i] = slope;
         }
         return out;
   }

   window.UTIL = window.UTIL || {};
    window.UTIL.toChron = toChron;
    window.UTIL.sma = sma;
    window.UTIL.atr = atr;
    window.UTIL.rsi = rsi;
    window.UTIL.linregSlope = linregSlope;
})();
