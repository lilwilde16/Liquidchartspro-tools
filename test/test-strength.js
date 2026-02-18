// Simple test to verify the strength meter logic works
const fs = require('fs');
const path = require('path');

// Mock DOM elements
global.document = {
  getElementById: function(id) {
    const mockElements = {
      'pairs': { value: 'EUR/USD\nGBP/USD\nUSD/JPY\nAUD/USD' },
      'strengthStatus': { textContent: '' },
      'strengthTable': { innerHTML: '' },
      'strengthBestPairs': { innerHTML: '', textContent: '' },
      'statusPill': { textContent: '', className: '' },
      'log': { textContent: '' }
    };
    return mockElements[id] || { textContent: '', innerHTML: '', value: '' };
  }
};

// Mock window.LC
global.window = {
  LC: {
    log: function(msg) { console.log('[LOG]', msg); },
    setStatus: function(text, kind) { console.log('[STATUS]', text, kind); },
    requestCandles: async function(pair, timeframe, count) {
      console.log(`[REQUEST] ${pair} @ ${timeframe}s x ${count}`);
      const candles = [];
      
      // Create more realistic trending data
      let price = 1.1000 + Math.random() * 0.05;
      const trend = (Math.random() - 0.5) * 0.0002; // Add a trend
      const volatility = 0.0008 + Math.random() * 0.0012; // Higher volatility
      
      for(let i = 0; i < count; i++) {
        const noise = (Math.random() - 0.5) * volatility;
        const change = trend + noise;
        price = price + change;
        const spread = Math.abs(change) * (1 + Math.random());
        const high = price + spread * Math.random();
        const low = price - spread * Math.random();
        
        candles.push({
          o: price - change,
          h: high,
          l: low,
          c: price
        });
      }
      
      return { candles: candles };
    }
  }
};

console.log('Loading util-indicators.js...');
eval(fs.readFileSync(path.join(__dirname, '../js/util-indicators.js'), 'utf8'));

console.log('Checking UTIL functions...');
console.log('window.UTIL.sma:', typeof global.window.UTIL.sma);
console.log('window.UTIL.atr:', typeof global.window.UTIL.atr);
console.log('window.UTIL.linregSlope:', typeof global.window.UTIL.linregSlope);

// Test SMA
const testData = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const smaResult = global.window.UTIL.sma(testData, 3);
console.log('SMA test result:', smaResult);

// Test linregSlope
const slopeResult = global.window.UTIL.linregSlope(testData, 5);
console.log('Slope test result:', slopeResult);

console.log('\nLoading engine-strength.js...');
eval(fs.readFileSync(path.join(__dirname, '../js/engine-strength.js'), 'utf8'));

console.log('Checking ENG.Strength...');
console.log('window.ENG.Strength.run:', typeof global.window.ENG.Strength.run);
console.log('window.ENG.Strength.init:', typeof global.window.ENG.Strength.init);
console.log('window.ENG.Strength.getSnapshot:', typeof global.window.ENG.Strength.getSnapshot);

console.log('\nRunning strength calculation...');
global.window.ENG.Strength.run().then(() => {
  console.log('\n✅ Strength calculation completed!');
  const snapshot = global.window.ENG.Strength.getSnapshot();
  console.log('\nSnapshot:', JSON.stringify(snapshot, null, 2));
}).catch((err) => {
  console.error('\n❌ Error:', err.message);
  console.error(err.stack);
});
