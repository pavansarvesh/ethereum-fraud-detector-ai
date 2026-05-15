"""
TRAIN MODEL — Ethereum Phishing Transaction Network
Dataset: https://www.kaggle.com/datasets/xblock/ethereum-phishing-transaction-network

Dataset files (place in data/ folder):
  node_info.csv  — columns: address, label  (1=phishing, 0=normal)
  edge_info.csv  — columns: from_address, to_address, amount, timestamp, block_number

Pipeline:
  1. Load node + edge CSVs
  2. Engineer wallet-level features from transaction graph
  3. Handle severe class imbalance (1165 phishing vs 2.97M normal)
  4. Train XGBoost with cross-validation
  5. Save fraud_model.pkl + feature_columns.pkl + scaler.pkl

Run:
  python model/train_model.py
  python model/train_model.py --nodes data/node_info.csv --edges data/edge_info.csv
"""

import os, sys, argparse, warnings, joblib
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.model_selection import train_test_split, StratifiedKFold
from sklearn.metrics import (classification_report, confusion_matrix,
                              roc_auc_score, average_precision_score)
from sklearn.preprocessing import StandardScaler
warnings.filterwarnings("ignore")

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    from sklearn.ensemble import RandomForestClassifier
    HAS_XGB = False
    print("[WARN] XGBoost not installed. Using RandomForest fallback.")

MODEL_DIR     = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH    = os.path.join(MODEL_DIR, "fraud_model.pkl")
FEATURES_PATH = os.path.join(MODEL_DIR, "feature_columns.pkl")
SCALER_PATH   = os.path.join(MODEL_DIR, "scaler.pkl")


# ════════════════════════════════════════════════════════════════════
# STEP 1 — LOAD DATA
# ════════════════════════════════════════════════════════════════════
def load_dataset(nodes_path, edges_path):
    print(f"\n{'='*60}")
    print("  STEP 1 — Loading Dataset")
    print(f"{'='*60}")

    # Load nodes
    print(f"  Nodes file : {nodes_path}")
    nodes = pd.read_csv(nodes_path)
    nodes.columns = [c.strip().lower().replace(' ', '_') for c in nodes.columns]
    print(f"  Columns    : {list(nodes.columns)}")
    print(f"  Shape      : {nodes.shape}")

    # Auto-detect address & label columns
    addr_col  = next((c for c in nodes.columns if any(k in c for k in ['address','node','id','account'])), nodes.columns[0])
    label_col = next((c for c in nodes.columns if any(k in c for k in ['label','flag','phish','fraud','class','target'])), nodes.columns[-1])
    print(f"  Address col: '{addr_col}'   Label col: '{label_col}'")
    print(f"  Label dist :\n{nodes[label_col].value_counts().to_string()}")

    nodes = nodes.rename(columns={addr_col: 'address', label_col: 'label'})
    nodes['label'] = nodes['label'].astype(int)

    # Load edges
    print(f"\n  Edges file : {edges_path}")
    edges = pd.read_csv(edges_path)
    edges.columns = [c.strip().lower().replace(' ', '_') for c in edges.columns]
    print(f"  Columns    : {list(edges.columns)}")
    print(f"  Shape      : {edges.shape}")

    # Auto-detect edge columns
    from_col = next((c for c in edges.columns if any(k in c for k in ['from','sender','src','source'])), edges.columns[0])
    to_col   = next((c for c in edges.columns if any(k in c for k in ['to','receiver','dst','dest','target'])), edges.columns[1])
    amt_col  = next((c for c in edges.columns if any(k in c for k in ['amount','value','eth','wei'])), None)
    ts_col   = next((c for c in edges.columns if any(k in c for k in ['time','stamp','block_num','block'])), None)

    print(f"  From: '{from_col}'  To: '{to_col}'  Amount: '{amt_col}'  Time: '{ts_col}'")

    rename_map = {from_col: 'from_addr', to_col: 'to_addr'}
    if amt_col: rename_map[amt_col] = 'amount'
    if ts_col:  rename_map[ts_col]  = 'timestamp'
    edges = edges.rename(columns=rename_map)

    if 'amount'    not in edges.columns: edges['amount']    = 1.0
    if 'timestamp' not in edges.columns: edges['timestamp'] = 0

    edges['amount']    = pd.to_numeric(edges['amount'],    errors='coerce').fillna(0)
    edges['timestamp'] = pd.to_numeric(edges['timestamp'], errors='coerce').fillna(0)

    # Convert wei to ETH if values are very large
    if edges['amount'].median() > 1e15:
        print("  [INFO] Detected Wei values — converting to ETH (dividing by 1e18)")
        edges['amount'] = edges['amount'] / 1e18

    return nodes, edges


# ════════════════════════════════════════════════════════════════════
# STEP 2 — FEATURE ENGINEERING
# Converts graph structure into per-wallet feature vectors
# ════════════════════════════════════════════════════════════════════
def engineer_features(nodes, edges):
    print(f"\n{'='*60}")
    print("  STEP 2 — Engineering Wallet Features from Transaction Graph")
    print(f"{'='*60}")
    print(f"  Wallets: {len(nodes):,}   Transactions: {len(edges):,}")

    # ── Sent transaction features ────────────────────────────────────
    print("  Computing sent features ...")
    sent = edges.groupby('from_addr').agg(
        sent_count        = ('amount', 'count'),
        sent_total        = ('amount', 'sum'),
        sent_mean         = ('amount', 'mean'),
        sent_max          = ('amount', 'max'),
        sent_min          = ('amount', 'min'),
        sent_std          = ('amount', 'std'),
        sent_unique_recv  = ('to_addr', 'nunique'),
    ).reset_index().rename(columns={'from_addr': 'address'})

    # ── Received transaction features ────────────────────────────────
    print("  Computing received features ...")
    recv = edges.groupby('to_addr').agg(
        recv_count        = ('amount', 'count'),
        recv_total        = ('amount', 'sum'),
        recv_mean         = ('amount', 'mean'),
        recv_max          = ('amount', 'max'),
        recv_unique_send  = ('from_addr', 'nunique'),
    ).reset_index().rename(columns={'to_addr': 'address'})

    # ── Temporal features ─────────────────────────────────────────────
    if edges['timestamp'].max() > 0:
        print("  Computing temporal features ...")
        sent_t = edges.groupby('from_addr')['timestamp'].agg(['min','max']).reset_index()
        sent_t.columns = ['address','sent_first_ts','sent_last_ts']
        sent_t['sent_active_span'] = sent_t['sent_last_ts'] - sent_t['sent_first_ts']

        recv_t = edges.groupby('to_addr')['timestamp'].agg(['min','max']).reset_index()
        recv_t.columns = ['address','recv_first_ts','recv_last_ts']
        recv_t['recv_active_span'] = recv_t['recv_last_ts'] - recv_t['recv_first_ts']
    else:
        sent_t = pd.DataFrame(columns=['address','sent_active_span'])
        recv_t = pd.DataFrame(columns=['address','recv_active_span'])

    # ── Night transaction ratio ───────────────────────────────────────
    if edges['timestamp'].max() > 1e9:  # real unix timestamps
        edges['hour'] = pd.to_datetime(edges['timestamp'], unit='s').dt.hour
    else:
        edges['hour'] = (edges['timestamp'] % 24).astype(int)

    night_mask = (edges['hour'] < 6) | (edges['hour'] > 22)
    night_sent = edges[night_mask].groupby('from_addr').size().reset_index(name='night_sent_count')
    night_sent  = night_sent.rename(columns={'from_addr': 'address'})

    # ── Merge everything onto node list ──────────────────────────────
    feat = nodes[['address', 'label']].copy()
    for df in [sent, recv, sent_t[['address','sent_active_span']] if 'sent_active_span' in sent_t.columns else pd.DataFrame(),
               recv_t[['address','recv_active_span']] if 'recv_active_span' in recv_t.columns else pd.DataFrame(),
               night_sent]:
        if not df.empty and 'address' in df.columns:
            feat = feat.merge(df, on='address', how='left')

    feat = feat.fillna(0)

    # ── Derived features ──────────────────────────────────────────────
    sent_cnt = feat.get('sent_count', pd.Series(np.zeros(len(feat))))
    recv_cnt = feat.get('recv_count', pd.Series(np.zeros(len(feat))))

    feat['total_tx_count']      = sent_cnt + recv_cnt
    feat['sent_recv_ratio']     = sent_cnt / (recv_cnt + 1)
    feat['unique_counterparts'] = feat.get('sent_unique_recv', 0) + feat.get('recv_unique_send', 0)
    feat['large_tx_flag']       = (feat.get('sent_max', 0) > 10).astype(int)
    feat['zero_recv_flag']      = (recv_cnt == 0).astype(int)
    feat['high_fan_out']        = (feat.get('sent_unique_recv', 0) > 50).astype(int)
    feat['high_activity']       = (sent_cnt > 100).astype(int)
    feat['night_ratio']         = feat.get('night_sent_count', 0) / (sent_cnt + 1)
    feat['amount_volatility']   = feat.get('sent_std', 0) / (feat.get('sent_mean', 0) + 1e-6)

    # Drop raw timestamp and address columns
    drop_cols = ['address'] + [c for c in feat.columns if '_ts' in c or '_first_ts' in c or '_last_ts' in c]
    feat = feat.drop(columns=[c for c in drop_cols if c in feat.columns])

    feature_cols = [c for c in feat.columns if c != 'label']
    print(f"  Feature count  : {len(feature_cols)}")
    print(f"  Features       : {feature_cols}")
    print(f"  Final shape    : {feat.shape}")
    print(f"\n  Class distribution:")
    vc = feat['label'].value_counts()
    for k, v in vc.items():
        pct = v / len(feat) * 100
        print(f"    {'Phishing' if k==1 else 'Normal  '} ({k}): {v:>10,}  ({pct:.2f}%)")

    return feat


# ════════════════════════════════════════════════════════════════════
# STEP 3 — HANDLE IMBALANCE
# ════════════════════════════════════════════════════════════════════
def handle_imbalance(X_train, y_train):
    print(f"\n{'='*60}")
    print("  STEP 3 — Handling Class Imbalance")
    print(f"{'='*60}")

    counts = np.bincount(y_train)
    print(f"  Before: Normal={counts[0]:,}  Phishing={counts[1]:,}  Ratio={counts[0]/counts[1]:.1f}:1")

    minority = counts[1]
    if minority < 6:
        print("  Too few phishing samples for SMOTE — using class weights only")
        return X_train, y_train

    try:
        from imblearn.over_sampling import SMOTE
        # Target 10:1 ratio max to avoid over-generating synthetic samples
        target = min(0.1, minority * 10 / counts[0])
        k = min(5, minority - 1)
        smote = SMOTE(sampling_strategy=target, k_neighbors=k, random_state=42)
        X_res, y_res = smote.fit_resample(X_train, y_train)
        counts2 = np.bincount(y_res)
        print(f"  After : Normal={counts2[0]:,}  Phishing={counts2[1]:,}  Ratio={counts2[0]/counts2[1]:.1f}:1")
        return X_res, y_res
    except ImportError:
        print("  imbalanced-learn not found. Run: pip install imbalanced-learn")
        print("  Proceeding with class_weight='balanced' in model")
        return X_train, y_train


# ════════════════════════════════════════════════════════════════════
# STEP 4 — TRAIN
# ════════════════════════════════════════════════════════════════════
def train(feat):
    print(f"\n{'='*60}")
    print("  STEP 4 — Training Model")
    print(f"{'='*60}")

    feature_cols = [c for c in feat.columns if c != 'label']
    X = feat[feature_cols].values.astype(np.float32)
    y = feat['label'].values.astype(int)

    # Scale
    scaler = StandardScaler()
    X = scaler.fit_transform(X)

    # Stratified split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, stratify=y, random_state=42
    )
    print(f"  Train: {len(X_train):,}   Test: {len(X_test):,}")

    # Oversample training set
    X_train, y_train = handle_imbalance(X_train, y_train)

    # Class weight for model
    n_neg = np.sum(y_train == 0)
    n_pos = np.sum(y_train == 1)
    spw   = n_neg / max(n_pos, 1)

    print(f"\n  Building {'XGBoost' if HAS_XGB else 'RandomForest'} ...")

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
        from sklearn.ensemble import RandomForestClassifier
        model = RandomForestClassifier(
            n_estimators = 300,
            max_depth    = 10,
            class_weight = 'balanced',
            random_state = 42,
            n_jobs       = -1,
        )
        model.fit(X_train, y_train)

    # ── Evaluate ──────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print("  STEP 5 — Evaluation")
    print(f"{'='*60}")

    y_pred = model.predict(X_test)
    y_prob = model.predict_proba(X_test)[:, 1]

    print("\n  Classification Report:")
    print(classification_report(y_test, y_pred, target_names=['Normal', 'Phishing'], digits=4))

    cm = confusion_matrix(y_test, y_pred)
    print("  Confusion Matrix:")
    print(f"    TN={cm[0,0]:,}  FP={cm[0,1]:,}")
    print(f"    FN={cm[1,0]:,}  TP={cm[1,1]:,}")

    if len(np.unique(y_test)) > 1:
        auc  = roc_auc_score(y_test, y_prob)
        aupr = average_precision_score(y_test, y_prob)
        print(f"\n  ROC-AUC  : {auc:.4f}")
        print(f"  PR-AUC   : {aupr:.4f}  ← key metric for imbalanced phishing detection")

    # Feature importance
    if hasattr(model, 'feature_importances_'):
        imp = sorted(zip(feature_cols, model.feature_importances_), key=lambda x: -x[1])
        print("\n  Top Feature Importances:")
        for name, score in imp[:10]:
            bar = '█' * int(score * 50)
            print(f"    {name:<30} {bar} {score:.4f}")

    return model, scaler, feature_cols


# ════════════════════════════════════════════════════════════════════
# STEP 6 — SAVE ARTIFACTS
# ════════════════════════════════════════════════════════════════════
def save_artifacts(model, scaler, feature_cols):
    print(f"\n{'='*60}")
    print("  STEP 6 — Saving Model Artifacts")
    print(f"{'='*60}")

    joblib.dump(model,        MODEL_PATH)
    joblib.dump(feature_cols, FEATURES_PATH)
    joblib.dump(scaler,       SCALER_PATH)

    print(f"  fraud_model.pkl      → {MODEL_PATH}")
    print(f"  feature_columns.pkl  → {FEATURES_PATH}")
    print(f"  scaler.pkl           → {SCALER_PATH}")
    print("\n  All artifacts saved successfully.")
    print("  Next step: python app.py")


# ════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--nodes', default='data/node_info.csv')
    parser.add_argument('--edges', default='data/edge_info.csv')
    args = parser.parse_args()

    for path, label in [(args.nodes, 'nodes'), (args.edges, 'edges')]:
        if not os.path.exists(path):
            print(f"\n[ERROR] {label} file not found: {path}")
            print("  Put your CSV files in the data/ folder and run:")
            print(f"  python model/train_model.py --nodes data/YOUR_NODES.csv --edges data/YOUR_EDGES.csv")
            sys.exit(1)

    t0 = datetime.now()
    print(f"\n  Started: {t0.strftime('%H:%M:%S')}")

    nodes, edges  = load_dataset(args.nodes, args.edges)
    feat           = engineer_features(nodes, edges)
    model, scaler, feature_cols = train(feat)
    save_artifacts(model, scaler, feature_cols)

    elapsed = (datetime.now() - t0).seconds
    print(f"\n  Finished in {elapsed}s\n")


if __name__ == '__main__':
    main()
