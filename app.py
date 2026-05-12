"""
app.py — Main Flask Entry Point
Ethereum AI Fraud Detection System

Run:
    python app.py

Endpoints:
    POST /analyze_transaction  — Full fraud analysis pipeline
    GET  /transactions         — Recent transactions
    GET  /dashboard/stats      — KPI stats
    GET  /blockchain/info      — Blockchain status
"""

from flask import Flask, jsonify
from flask_cors import CORS

from routes.transaction_routes import transaction_bp

app = Flask(__name__)
CORS(app)  # Allow React frontend on localhost:3000

# Register blueprints
app.register_blueprint(transaction_bp)


@app.route("/")
def home():
    return jsonify({
        "status" : "running",
        "service": "Ethereum AI Fraud Detection API",
        "version": "1.0.0",
        "endpoints": [
            "POST /analyze_transaction",
            "GET  /transactions",
            "GET  /dashboard/stats",
            "GET  /blockchain/info",
        ]
    })


@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Endpoint not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": "Internal server error", "detail": str(e)}), 500


if __name__ == "__main__":
    print("=" * 50)
    print(" Ethereum Fraud Detection Backend")
    print(" Running on http://127.0.0.1:5000")
    print("=" * 50)
    app.run(debug=True, port=5000)
