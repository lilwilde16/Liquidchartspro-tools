"""
verify_candles_server.py — Optional local verification server.

Uses yfinance to fetch historical candles and returns them as normalized
ms-timestamp rows for manual comparison against window.LC.requestCandles.

Usage:
    pip install flask yfinance
    python tools/verify_candles_server.py

Endpoints:
    GET /api/candles?symbol=EURUSD&tf=M5&count=100
        Returns JSON: { "candles": [{ "t": <ms>, "o": ..., "h": ..., "l": ..., "c": ... }, ...] }

Supported tf values: M1, M5, M15, M30, H1, D1
Symbol mapping: append "=X" for forex pairs (e.g. EURUSD -> EURUSD=X).
                For indices use standard Yahoo symbols (e.g. ^FTSE).
"""

from flask import Flask, request, jsonify
import yfinance as yf
import math

app = Flask(__name__)

# Timeframe string -> yfinance interval
TF_MAP = {
    "M1":  "1m",
    "M5":  "5m",
    "M15": "15m",
    "M30": "30m",
    "H1":  "1h",
    "D1":  "1d",
}

# How many days of history to request per timeframe (yfinance window)
TF_PERIOD = {
    "M1":  "7d",
    "M5":  "60d",
    "M15": "60d",
    "M30": "60d",
    "H1":  "730d",
    "D1":  "5y",
}


def to_yahoo_symbol(symbol: str) -> str:
    """Convert a common pair/ticker string to a Yahoo Finance symbol."""
    s = symbol.upper().strip()
    # Forex pairs: 6-char string like EURUSD -> EURUSD=X
    if len(s) == 6 and s.isalpha() and "=X" not in s and "^" not in s and "." not in s:
        return s + "=X"
    return s


def candle_time_ms(t) -> int:
    """Convert a timestamp to milliseconds (mirrors CandleUtils.candleTimeMs)."""
    try:
        n = float(t)
        if not math.isfinite(n) or n <= 0:
            return 0
        return round(n * 1000) if n < 1e12 else round(n)
    except (TypeError, ValueError):
        return 0


@app.after_request
def add_cors(response):
    # CORS is permissive here because this server is intended for local development
    # only. Do not expose this server on a public network.
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.route("/api/candles")
def get_candles():
    symbol = request.args.get("symbol", "").strip()
    tf = request.args.get("tf", "M5").strip().upper()
    try:
        count = max(1, min(int(request.args.get("count", 100)), 10000))
    except (TypeError, ValueError):
        return jsonify({"error": "count must be an integer between 1 and 10000"}), 400

    if not symbol:
        return jsonify({"error": "symbol parameter is required"}), 400

    interval = TF_MAP.get(tf)
    if not interval:
        return jsonify({"error": f"Unsupported tf '{tf}'. Use one of: {', '.join(TF_MAP.keys())}"}), 400

    period = TF_PERIOD.get(tf, "60d")
    yahoo_sym = to_yahoo_symbol(symbol)

    try:
        ticker = yf.Ticker(yahoo_sym)
        df = ticker.history(period=period, interval=interval, auto_adjust=True)
    except Exception as exc:
        return jsonify({"error": f"yfinance error: {exc}"}), 500

    if df is None or df.empty:
        return jsonify({"error": f"No data returned for {yahoo_sym} ({interval})"}), 404

    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    df = df.tail(count)

    candles = []
    for ts, row in df.iterrows():
        # ts is a pandas Timestamp; convert to Unix ms
        epoch_s = ts.timestamp()
        t_ms = candle_time_ms(epoch_s)
        candles.append({
            "t": t_ms,
            "o": float(row["Open"]),
            "h": float(row["High"]),
            "l": float(row["Low"]),
            "c": float(row["Close"]),
        })

    return jsonify({"symbol": yahoo_sym, "tf": tf, "candles": candles})


if __name__ == "__main__":
    print("Candle verification server running at http://localhost:5050")
    print("Example: http://localhost:5050/api/candles?symbol=EURUSD&tf=M5&count=50")
    app.run(host="0.0.0.0", port=5050, debug=False)
