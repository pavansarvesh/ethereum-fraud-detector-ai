import os, joblib
import numpy as np

MODEL_DIR     = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH    = os.path.join(MODEL_DIR, "fraud_model.pkl")
FEATURES_PATH = os.path.join(MODEL_DIR, "feature_columns.pkl")
SCALER_PATH   = os.path.join(MODEL_DIR, "scaler.pkl")

_model = _features = _scaler = None

def load_artifacts():
    global _model, _features, _scaler
    if _model is not None: return True
    if not os.path.exists(MODEL_PATH):
        print("[MODEL] fraud_model.pkl not found — run: python model/train_model.py")
        return False
    _model    = joblib.load(MODEL_PATH)
    _features = joblib.load(FEATURES_PATH) if os.path.exists(FEATURES_PATH) else None
    _scaler   = joblib.load(SCALER_PATH)   if os.path.exists(SCALER_PATH)   else None
    print(f"[MODEL] XGBoost loaded | Features: {len(_features) if _features else '?'}")
    return True

def build_feature_vector(tx):
    feat_list = _features or [
        'sent_count','sent_total','sent_mean','sent_max','sent_min','sent_std',
        'sent_unique_recv','recv_count','recv_total','recv_mean','recv_max',
        'recv_unique_send','sent_active_span','recv_active_span','night_sent_count',
        'total_tx_count','sent_recv_ratio','unique_counterparts','large_tx_flag',
        'zero_recv_flag','high_fan_out','high_activity','night_ratio','amount_volatility'
    ]
    vec = np.array([float(tx.get(f,0)) for f in feat_list], dtype=np.float32).reshape(1,-1)
    if _scaler is not None: vec = _scaler.transform(vec)
    return vec

def rule_based_fallback(tx):
    score = 0.0
    amt = float(tx.get('amount', 0)); hour = int(tx.get('hour', 12))
    if amt > 10: score += 0.35
    elif amt > 5: score += 0.20
    if hour < 6 or hour > 22: score += 0.25
    if tx.get('high_activity'): score += 0.20
    if tx.get('large_tx_flag'): score += 0.15
    if tx.get('zero_recv_flag'): score += 0.10
    return min(score, 1.0)

def predict_fraud(tx):
    loaded = load_artifacts()
    if loaded and _model:
        try:
            proba = _model.predict_proba(build_feature_vector(tx))[0]
            return {"fraud_probability": round(float(proba[1]),4),
                    "normal_probability": round(float(proba[0]),4),
                    "model_used": "XGBoost (Ethereum Phishing Dataset)"}
        except Exception as e:
            print(f"[MODEL] Error: {e}")
    fp = rule_based_fallback(tx)
    return {"fraud_probability": round(fp,4),
            "normal_probability": round(1-fp,4),
            "model_used": "RuleBasedFallback"}