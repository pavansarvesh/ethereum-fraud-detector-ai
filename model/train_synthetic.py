"""
TRAIN SYNTHETIC MODEL — Generates realistic phishing wallet data and trains XGBoost.
Used when MulDiGraph.pkl is not available.

This script creates synthetic wallet behavior data matching the 24 features
the pipeline expects, with realistic phishing vs normal patterns:
  - Phishing wallets: high fan-out, one-directional flow, night activity,
    large/volatile amounts, many unique receivers
  - Normal wallets: balanced send/recv, consistent amounts, regular hours

Run:
  python model/train_synthetic.py
"""

import os
import sys
import warnings
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    classification_report, confusion_matrix,
    roc_auc_score, average_precision_score
)
warnings.filterwarnings("ignore")

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    from sklearn.ensemble import RandomForestClassifier
    HAS_XGB = False
    print("[WARN] XGBoost not found — using RandomForest")

MODEL_DIR     = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH    = os.path.join(MODEL_DIR, "fraud_model.pkl")
FEATURES_PATH = os.path.join(MODEL_DIR, "feature_columns.pkl")
SCALER_PATH   = os.path.join(MODEL_DIR, "scaler.pkl")

FEATURE_COLS = [
    'sent_count', 'sent_total', 'sent_mean', 'sent_max', 'sent_min', 'sent_std',
    'sent_unique_recv', 'recv_count', 'recv_total', 'recv_mean', 'recv_max',
    'recv_unique_send', 'sent_active_span', 'recv_active_span',
    'night_sent_count', 'total_tx_count', 'sent_recv_ratio',
    'unique_counterparts', 'large_tx_flag', 'zero_recv_flag',
    'high_fan_out', 'high_activity', 'night_ratio', 'amount_volatility',
]


def generate_normal_wallet():
    """Generate a single normal wallet's feature vector."""
    sent_count = np.random.randint(1, 200)
    recv_count = max(1, int(sent_count * np.random.uniform(0.3, 1.5)))
    sent_mean  = np.random.uniform(0.01, 8.0)
    sent_std   = sent_mean * np.random.uniform(0.1, 0.8)
    sent_total = sent_count * sent_mean
    sent_max   = sent_mean + sent_std * np.random.uniform(1, 3)
    sent_min   = max(0.001, sent_mean - sent_std * np.random.uniform(0.5, 1.5))

    recv_mean  = np.random.uniform(0.01, 8.0)
    recv_total = recv_count * recv_mean
    recv_max   = recv_mean * np.random.uniform(1, 3)

    sent_unique_recv = min(sent_count, np.random.randint(1, min(40, sent_count + 1)))
    recv_unique_send = min(recv_count, np.random.randint(1, min(30, recv_count + 1)))

    sent_active_span = np.random.uniform(0, 20)
    recv_active_span = np.random.uniform(0, 18)

    night_sent_count = int(sent_count * np.random.uniform(0, 0.15))
    total_tx_count   = sent_count + recv_count
    sent_recv_ratio  = sent_count / max(recv_count, 1)
    unique_counterparts = sent_unique_recv + recv_unique_send

    large_tx_flag  = 1 if sent_max > 10 else 0
    zero_recv_flag = 0  # Normal wallets receive
    high_fan_out   = 1 if sent_unique_recv > 50 else 0
    high_activity  = 1 if sent_count > 100 else 0
    night_ratio    = night_sent_count / max(sent_count, 1)
    amount_volatility = sent_std / max(sent_mean, 1e-6)

    return {
        'sent_count': sent_count, 'sent_total': sent_total,
        'sent_mean': sent_mean, 'sent_max': sent_max,
        'sent_min': sent_min, 'sent_std': sent_std,
        'sent_unique_recv': sent_unique_recv,
        'recv_count': recv_count, 'recv_total': recv_total,
        'recv_mean': recv_mean, 'recv_max': recv_max,
        'recv_unique_send': recv_unique_send,
        'sent_active_span': sent_active_span,
        'recv_active_span': recv_active_span,
        'night_sent_count': night_sent_count,
        'total_tx_count': total_tx_count,
        'sent_recv_ratio': sent_recv_ratio,
        'unique_counterparts': unique_counterparts,
        'large_tx_flag': large_tx_flag,
        'zero_recv_flag': zero_recv_flag,
        'high_fan_out': high_fan_out,
        'high_activity': high_activity,
        'night_ratio': night_ratio,
        'amount_volatility': amount_volatility,
        'label': 0,
    }


def generate_phishing_wallet():
    """Generate a single phishing wallet's feature vector."""
    # Phishing wallets have distinct patterns
    pattern = np.random.choice(['drainer', 'spreader', 'night_ops', 'whale'])

    if pattern == 'drainer':
        # High volume, one-directional, many receivers
        sent_count = np.random.randint(50, 500)
        recv_count = np.random.randint(0, 3)
        sent_mean  = np.random.uniform(0.1, 15.0)
        sent_std   = sent_mean * np.random.uniform(1.5, 4.0)
        sent_unique_recv = np.random.randint(min(30, sent_count), max(min(200, sent_count), min(30, sent_count) + 1))
        night_pct  = np.random.uniform(0.3, 0.8)
    elif pattern == 'spreader':
        # Moderate volume, very high fan-out
        sent_count = np.random.randint(20, 300)
        recv_count = np.random.randint(0, 5)
        sent_mean  = np.random.uniform(0.5, 5.0)
        sent_std   = sent_mean * np.random.uniform(0.8, 3.0)
        sent_unique_recv = np.random.randint(min(40, sent_count), max(min(300, sent_count + 1), min(40, sent_count) + 1))
        night_pct  = np.random.uniform(0.2, 0.6)
    elif pattern == 'night_ops':
        # Night-time operations
        sent_count = np.random.randint(10, 150)
        recv_count = np.random.randint(0, 8)
        sent_mean  = np.random.uniform(1.0, 20.0)
        sent_std   = sent_mean * np.random.uniform(1.0, 3.0)
        sent_unique_recv = np.random.randint(min(5, sent_count), max(min(80, sent_count + 1), min(5, sent_count) + 1))
        night_pct  = np.random.uniform(0.5, 0.95)
    else:  # whale
        # Large amounts, few transactions
        sent_count = np.random.randint(3, 30)
        recv_count = np.random.randint(0, 2)
        sent_mean  = np.random.uniform(10.0, 100.0)
        sent_std   = sent_mean * np.random.uniform(0.5, 2.5)
        sent_unique_recv = np.random.randint(1, max(min(20, sent_count + 1), 2))
        night_pct  = np.random.uniform(0.2, 0.7)

    sent_total = sent_count * sent_mean
    sent_max   = sent_mean + sent_std * np.random.uniform(2, 5)
    sent_min   = max(0.001, sent_mean * np.random.uniform(0.01, 0.3))

    recv_mean  = np.random.uniform(0, 2.0) if recv_count > 0 else 0
    recv_total = recv_count * recv_mean
    recv_max   = recv_mean * np.random.uniform(1, 2) if recv_count > 0 else 0
    recv_unique_send = min(recv_count, np.random.randint(0, max(recv_count, 1) + 1))

    sent_active_span = np.random.uniform(0, 8)  # Compressed time window
    recv_active_span = np.random.uniform(0, 3)

    night_sent_count = int(sent_count * night_pct)
    total_tx_count   = sent_count + recv_count
    sent_recv_ratio  = sent_count / max(recv_count, 1)
    unique_counterparts = sent_unique_recv + recv_unique_send

    large_tx_flag  = 1 if sent_max > 10 else 0
    zero_recv_flag = 1 if recv_count == 0 else 0
    high_fan_out   = 1 if sent_unique_recv > 50 else 0
    high_activity  = 1 if sent_count > 100 else 0
    night_ratio    = night_sent_count / max(sent_count, 1)
    amount_volatility = sent_std / max(sent_mean, 1e-6)

    return {
        'sent_count': sent_count, 'sent_total': sent_total,
        'sent_mean': sent_mean, 'sent_max': sent_max,
        'sent_min': sent_min, 'sent_std': sent_std,
        'sent_unique_recv': sent_unique_recv,
        'recv_count': recv_count, 'recv_total': recv_total,
        'recv_mean': recv_mean, 'recv_max': recv_max,
        'recv_unique_send': recv_unique_send,
        'sent_active_span': sent_active_span,
        'recv_active_span': recv_active_span,
        'night_sent_count': night_sent_count,
        'total_tx_count': total_tx_count,
        'sent_recv_ratio': sent_recv_ratio,
        'unique_counterparts': unique_counterparts,
        'large_tx_flag': large_tx_flag,
        'zero_recv_flag': zero_recv_flag,
        'high_fan_out': high_fan_out,
        'high_activity': high_activity,
        'night_ratio': night_ratio,
        'amount_volatility': amount_volatility,
        'label': 1,
    }


def main():
    print(f"\n{'='*60}")
    print("  Ethereum Phishing Fraud Detection — Synthetic Training")
    print(f"{'='*60}")

    # Generate synthetic dataset
    n_normal   = 10000
    n_phishing = 1200  # ~10:1 ratio similar to real dataset
    print(f"\n  Generating {n_normal:,} normal + {n_phishing:,} phishing wallets...")

    np.random.seed(42)
    rows = []
    for _ in range(n_normal):
        rows.append(generate_normal_wallet())
    for _ in range(n_phishing):
        rows.append(generate_phishing_wallet())

    df = pd.DataFrame(rows)
    df = df.sample(frac=1, random_state=42).reset_index(drop=True)

    print(f"  Dataset shape : {df.shape}")
    print(f"  Normal        : {(df['label']==0).sum():,}")
    print(f"  Phishing      : {(df['label']==1).sum():,}")

    # Prepare features
    X = df[FEATURE_COLS].values.astype(np.float32)
    y = df['label'].values.astype(int)

    # Scale
    scaler = StandardScaler()
    X = scaler.fit_transform(X)

    # Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    print(f"\n  Train : {len(X_train):,}   Test : {len(X_test):,}")

    # SMOTE oversampling
    try:
        from imblearn.over_sampling import SMOTE
        k = min(5, (y_train == 1).sum() - 1)
        smote = SMOTE(sampling_strategy=0.3, k_neighbors=k, random_state=42)
        X_train, y_train = smote.fit_resample(X_train, y_train)
        print(f"  After SMOTE: Normal={np.sum(y_train==0):,}  Phishing={np.sum(y_train==1):,}")
    except ImportError:
        print("  imbalanced-learn not installed — using class weights only")

    # Class weight
    n_neg = int(np.sum(y_train == 0))
    n_pos = int(np.sum(y_train == 1))
    spw   = n_neg / max(n_pos, 1)
    print(f"  scale_pos_weight = {spw:.2f}")

    # Train
    print(f"\n{'='*60}")
    print("  Training XGBoost...")
    print(f"{'='*60}")

    if HAS_XGB:
        model = xgb.XGBClassifier(
            n_estimators          = 300,
            max_depth             = 6,
            learning_rate         = 0.05,
            subsample             = 0.8,
            colsample_bytree      = 0.8,
            min_child_weight      = 5,
            reg_alpha             = 0.5,
            reg_lambda            = 1.0,
            scale_pos_weight      = spw,
            eval_metric           = 'aucpr',
            early_stopping_rounds = 20,
            random_state          = 42,
            n_jobs                = -1,
            verbosity             = 0,
        )
        model.fit(X_train, y_train,
                  eval_set=[(X_test, y_test)],
                  verbose=50)
    else:
        model = RandomForestClassifier(
            n_estimators=300, max_depth=10,
            class_weight='balanced', random_state=42, n_jobs=-1
        )
        model.fit(X_train, y_train)

    # Evaluate
    print(f"\n{'='*60}")
    print("  Evaluation")
    print(f"{'='*60}")

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    print("\n  Classification Report:")
    print(classification_report(y_test, y_pred,
                                target_names=['Normal', 'Phishing'], digits=4))

    cm = confusion_matrix(y_test, y_pred)
    print("  Confusion Matrix:")
    print(f"    TN={cm[0,0]:,}  FP={cm[0,1]:,}")
    print(f"    FN={cm[1,0]:,}  TP={cm[1,1]:,}")

    auc  = roc_auc_score(y_test, y_prob)
    aupr = average_precision_score(y_test, y_prob)
    print(f"\n  ROC-AUC  : {auc:.4f}")
    print(f"  PR-AUC   : {aupr:.4f}")

    # Feature importance
    if hasattr(model, 'feature_importances_'):
        imp = sorted(zip(FEATURE_COLS, model.feature_importances_), key=lambda x: -x[1])
        print("\n  Top 10 Feature Importances:")
        for name, score in imp[:10]:
            bar = '#' * int(score * 50)
            print(f"    {name:<28} {bar} {score:.4f}")

    # Save
    print(f"\n{'='*60}")
    print("  Saving Artifacts")
    print(f"{'='*60}")

    joblib.dump(model,        MODEL_PATH)
    joblib.dump(FEATURE_COLS, FEATURES_PATH)
    joblib.dump(scaler,       SCALER_PATH)

    print(f"  fraud_model.pkl     -> {MODEL_PATH}")
    print(f"  feature_columns.pkl -> {FEATURES_PATH}")
    print(f"  scaler.pkl          -> {SCALER_PATH}")
    print(f"\n  Model size: {os.path.getsize(MODEL_PATH) / 1024:.1f} KB")
    print("  All artifacts saved. Restart Flask: python app.py\n")


if __name__ == '__main__':
    main()
