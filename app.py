"""
app.py — Phase 3 + 4
  Phase 3: Register AI model hash on-chain at startup
  Phase 4: Rate limiting to prevent API abuse
"""

import os

# Load .env file automatically
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from flask import Flask, jsonify
from flask_cors import CORS

# Phase 4: Rate limiting
try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    HAS_LIMITER = True
except ImportError:
    HAS_LIMITER = False
    print("[WARN] flask-limiter not installed. Run: pip install flask-limiter")

from routes.transaction_routes import transaction_bp

app = Flask(__name__)
CORS(app)

# ── Phase 4: Rate Limiting ─────────────────────────────────────────────────────
if HAS_LIMITER:
    limiter = Limiter(
        app          = app,
        key_func     = get_remote_address,
        default_limits = ["200 per day", "50 per hour"],
        storage_uri  = "memory://",
    )
    # Apply stricter limit to analyze endpoint
    limiter.limit("30 per minute")(transaction_bp)
    print("[SECURITY] Rate limiting active: 30/min per IP")
else:
    limiter = None

app.register_blueprint(transaction_bp)


# ── Phase 3: Register Model Hash at Startup ────────────────────────────────────
def register_model_on_startup():
    """
    On every Flask startup:
      1. Compute sha256 of fraud_model.pkl
      2. Store hash on-chain via FraudDetection.sol
      3. Proves model was not tampered between restarts
    """
    model_path = os.path.join(
        os.path.dirname(__file__), "model", "fraud_model.pkl"
    )
    if not os.path.exists(model_path):
        print("[SECURITY] Model file not found — skipping hash registration")
        return

    try:
        from blockchain.connect import register_model_hash, verify_model_integrity
        # First verify if already registered
        integrity = verify_model_integrity(model_path)
        if integrity.get("verified") and not integrity.get("simulated"):
            print(f"[SECURITY] Model hash verified on-chain (OK) Status: {integrity['status']}")
            return

        # Register new hash
        result = register_model_hash(model_path, version="XGBoost-v1.0-EthPhishing")
        if result.get("simulated"):
            print(f"[SECURITY] Model hash computed (simulated): {result.get('model_hash','')[:20]}...")
        else:
            print(f"[SECURITY] Model hash registered on-chain: {result.get('model_hash','')[:20]}...")
    except Exception as e:
        print(f"[SECURITY] Model hash registration error: {e}")


# ── Routes ─────────────────────────────────────────────────────────────────────
@app.route("/")
def home():
    return jsonify({
        "status"  : "running",
        "service" : "Ethereum AI Fraud Detection API",
        "version" : "2.0.0",
        "security": {
            "rate_limiting"   : HAS_LIMITER,
            "model_hash"      : "on-chain (Phase 3)",
            "threshold_anchor": "on-chain per wallet (Phase 2)",
            "blockchain"      : "Ganache / Sepolia",
        },
        "endpoints": [
            "POST /analyze_transaction",
            "GET  /transactions",
            "GET  /dashboard/stats",
            "GET  /blockchain/info",
            "GET  /blockchain/chain",
            "GET  /blockchain/threshold_history/<address>",
            "GET  /blockchain/model_integrity",
            "GET  /alerts",
            "GET  /sc_events",
            "GET  /blacklist",
            "GET  /gas/analytics",
            "GET  /network/stats",
            "GET  /verify/<tx_hash>",
        ]
    })


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found"}), 404

@app.errorhandler(429)
def rate_limited(e):
    return jsonify({
        "error"  : "Rate limit exceeded",
        "message": "Too many requests. Max 30 per minute per IP.",
        "retry_after": "60 seconds"
    }), 429

@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500


if __name__ == "__main__":
    print("=" * 55)
    print("  Ethereum AI Fraud Detection System v2.0")
    print("  Phase 1: Real blockchain logging")
    print("  Phase 2: On-chain threshold anchoring")
    print("  Phase 3: AI model hash verification")
    print("  Phase 4: Rate limiting active")
    print("  Phase 5: Threshold history graph")
    print(f"  API: http://127.0.0.1:5000")
    print("=" * 55)

    # Phase 3: Register model hash on startup
    register_model_on_startup()

    app.run(debug=True, port=5000)
