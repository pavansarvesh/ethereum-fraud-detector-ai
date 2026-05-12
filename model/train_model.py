"""
TRAIN MODEL - Ethereum Phishing Detection
Dataset : MulDiGraph.pkl  (NetworkX MultiDiGraph)
Source  : https://www.kaggle.com/datasets/xblock/ethereum-phishing-transaction-network

The .pkl file contains a NetworkX MultiDiGraph where:
  - Nodes = Ethereum wallet addresses
  - Node attribute 'label' : 1 = phishing, 0 = normal
  - Edges = transactions with attributes: amount, timestamp, block_number

Pipeline:
  1. Load MulDiGraph.pkl
  2. Extract wallet-level features from graph structure
  3. Handle class imbalance (1165 phishing vs 2.97M normal)
  4. Train XGBoost
  5. Save fraud_model.pkl + feature_columns.pkl + scaler.pkl

Run:
  python model/train_model.py
  python model/train_model.py --graph model/data/MulDiGraph.pkl
"""

import os
import sys
import pickle
import argparse
import warnings
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    classification_report, confusion_matrix,
    roc_auc_score, average_precision_score
)
from sklearn.preprocessing import StandardScaler
warnings.filterwarnings("ignore")

try:
    import xgboost as xgb
    HAS_XGB = True
except ImportError:
    from sklearn.ensemble import RandomForestClassifier
    HAS_XGB = False
    print("[WARN] XGBoost not found - using RandomForest")

MODEL_DIR     = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH    = os.path.join(MODEL_DIR, "fraud_model.pkl")
FEATURES_PATH = os.path.join(MODEL_DIR, "feature_columns.pkl")
SCALER_PATH   = os.path.join(MODEL_DIR, "scaler.pkl")


# ════════════════════════════════════════════════════════════════════
# STEP 1 - LOAD GRAPH
# ════════════════════════════════════════════════════════════════════
def load_graph(graph_path: str):
    print(f"\n{'='*60}")
    print("  STEP 1 - Loading MulDiGraph.pkl")
    print(f"{'='*60}")
    print(f"  File : {graph_path}")
    print(f"  Size : {os.path.getsize(graph_path) / 1024 / 1024:.1f} MB")
    print("  Loading ... (this may take 1-2 minutes)")

    with open(graph_path, 'rb') as f:
        G = pickle.load(f)

    print(f"  Graph type : {type(G)}")
    print(f"  Nodes      : {G.number_of_nodes():,}")
    print(f"  Edges      : {G.number_of_edges():,}")

    # Check node attributes
    sample_nodes = list(G.nodes(data=True))[:3]
    print(f"  Sample node attrs: {sample_nodes[0] if sample_nodes else 'none'}")

    # Check edge attributes
    sample_edges = list(G.edges(data=True))[:2]
    print(f"  Sample edge attrs: {sample_edges[0] if sample_edges else 'none'}")

    # Count labels
    labels = [d.get('label', d.get('isp', d.get('flag', -1)))
              for _, d in G.nodes(data=True)]
    label_counts = pd.Series(labels).value_counts()
    print(f"\n  Node label distribution:\n{label_counts.to_string()}")

    return G


# ════════════════════════════════════════════════════════════════════
# STEP 2 - EXTRACT FEATURES FROM GRAPH
# ════════════════════════════════════════════════════════════════════
def extract_features(G) -> pd.DataFrame:
    print(f"\n{'='*60}")
    print("  STEP 2 - Extracting Wallet Features from Graph")
    print(f"{'='*60}")

    # Detect label attribute name
    sample_attrs = dict(list(G.nodes(data=True))[:10])
    label_key = None
    for candidate in ['label', 'isp', 'flag', 'phishing', 'fraud', 'class']:
        if any(candidate in attrs for attrs in sample_attrs.values()):
            label_key = candidate
            break
    if label_key is None:
        label_key = list(list(sample_attrs.values())[0].keys())[0] if sample_attrs else 'label'
    print(f"  Label attribute key: '{label_key}'")

    # Detect edge attribute names
    sample_edge_attrs = {}
    for u, v, d in list(G.edges(data=True))[:5]:
        sample_edge_attrs = d
        break
    print(f"  Edge attributes: {list(sample_edge_attrs.keys())}")

    amt_key = next((k for k in sample_edge_attrs if any(
        x in k.lower() for x in ['amount','value','eth','wei'])), None)
    ts_key  = next((k for k in sample_edge_attrs if any(
        x in k.lower() for x in ['time','stamp','block'])), None)
    print(f"  Amount key: '{amt_key}'   Timestamp key: '{ts_key}'")

    print(f"\n  Processing {G.number_of_nodes():,} nodes ...")
    rows = []
    total = G.number_of_nodes()
    step  = max(total // 10, 1)

    for i, (node, attrs) in enumerate(G.nodes(data=True)):
        if i % step == 0:
            print(f"    {i:>10,} / {total:,}  ({i*100//total}%)")

        label = int(attrs.get(label_key, 0))

        # Out-edges (sent transactions)
        out_edges = list(G.out_edges(node, data=True))
        # In-edges  (received transactions)
        in_edges  = list(G.in_edges(node, data=True))

        # Sent features
        sent_amounts = []
        sent_times   = []
        sent_receivers = set()
        for u, v, d in out_edges:
            if amt_key and amt_key in d:
                val = float(d[amt_key])
                # Convert wei to ETH if very large
                if val > 1e15:
                    val = val / 1e18
                sent_amounts.append(val)
            if ts_key and ts_key in d:
                sent_times.append(float(d[ts_key]))
            sent_receivers.add(v)

        # Received features
        recv_amounts = []
        recv_senders = set()
        for u, v, d in in_edges:
            if amt_key and amt_key in d:
                val = float(d[amt_key])
                if val > 1e15:
                    val = val / 1e18
                recv_amounts.append(val)
            recv_senders.add(u)

        # Compute stats
        def safe_stats(arr):
            if not arr:
                return 0, 0, 0, 0, 0, 0
            a = np.array(arr)
            return (len(a), float(a.sum()), float(a.mean()),
                    float(a.max()), float(a.min()),
                    float(a.std()) if len(a) > 1 else 0.0)

        sc, st, sm, sx, sn, ss = safe_stats(sent_amounts)
        rc, rt, rm, rx, rn, rs = safe_stats(recv_amounts)

        # Temporal features
        sent_span = (max(sent_times) - min(sent_times)) if len(sent_times) > 1 else 0
        recv_span = 0

        # Night transactions (hour 0-5 or 22-23)
        night_count = 0
        if sent_times and max(sent_times) > 1e9:
            for ts in sent_times:
                h = datetime.fromtimestamp(ts).hour
                if h < 6 or h > 22:
                    night_count += 1

        total_tx      = sc + rc
        sent_recv_r   = sc / (rc + 1)
        unique_cp     = len(sent_receivers) + len(recv_senders)
        night_ratio   = night_count / (sc + 1)
        amt_volatility= ss / (sm + 1e-6)

        rows.append({
            'label'             : label,
            'sent_count'        : sc,
            'sent_total'        : st,
            'sent_mean'         : sm,
            'sent_max'          : sx,
            'sent_min'          : sn,
            'sent_std'          : ss,
            'sent_unique_recv'  : len(sent_receivers),
            'recv_count'        : rc,
            'recv_total'        : rt,
            'recv_mean'         : rm,
            'recv_max'          : rx,
            'recv_unique_send'  : len(recv_senders),
            'sent_active_span'  : sent_span,
            'recv_active_span'  : recv_span,
            'night_sent_count'  : night_count,
            'total_tx_count'    : total_tx,
            'sent_recv_ratio'   : sent_recv_r,
            'unique_counterparts': unique_cp,
            'large_tx_flag'     : 1 if sx > 10 else 0,
            'zero_recv_flag'    : 1 if rc == 0 else 0,
            'high_fan_out'      : 1 if len(sent_receivers) > 50 else 0,
            'high_activity'     : 1 if sc > 100 else 0,
            'night_ratio'       : night_ratio,
            'amount_volatility' : amt_volatility,
        })

    feat = pd.DataFrame(rows)
    feat = feat.fillna(0)

    feature_cols = [c for c in feat.columns if c != 'label']
    print(f"\n  Features extracted : {len(feature_cols)}")
    print(f"  Dataset shape      : {feat.shape}")
    print(f"\n  Class distribution:")
    vc = feat['label'].value_counts()
    for k, v in vc.items():
        name = 'Phishing' if k == 1 else 'Normal  '
        pct  = v / len(feat) * 100
        print(f"    {name} ({k}): {v:>10,}  ({pct:.3f}%)")

    return feat


# ════════════════════════════════════════════════════════════════════
# STEP 3 - HANDLE CLASS IMBALANCE
# ════════════════════════════════════════════════════════════════════
def handle_imbalance(X_train, y_train):
    print(f"\n{'='*60}")
    print("  STEP 3 - Handling Class Imbalance")
    print(f"{'='*60}")

    counts = np.bincount(y_train)
    print(f"  Before: Normal={counts[0]:,}  Phishing={counts[1]:,}  Ratio={counts[0]/max(counts[1],1):.0f}:1")

    minority = counts[1] if len(counts) > 1 else 0
    if minority < 6:
        print("  Too few phishing samples for SMOTE - using class weights only")
        return X_train, y_train

    try:
        from imblearn.over_sampling import SMOTE
        # Target 10:1 ratio — avoids flooding with synthetic samples
        target = min(0.1, minority * 10 / counts[0])
        k      = min(5, minority - 1)
        smote  = SMOTE(sampling_strategy=target, k_neighbors=k, random_state=42)
        X_res, y_res = smote.fit_resample(X_train, y_train)
        counts2 = np.bincount(y_res)
        print(f"  After : Normal={counts2[0]:,}  Phishing={counts2[1]:,}  Ratio={counts2[0]/max(counts2[1],1):.0f}:1")
        return X_res, y_res
    except ImportError:
        print("  imbalanced-learn not found - run: pip install imbalanced-learn")
        print("  Using scale_pos_weight in XGBoost instead")
        return X_train, y_train


# ════════════════════════════════════════════════════════════════════
# STEP 4 - TRAIN
# ════════════════════════════════════════════════════════════════════
def train(feat: pd.DataFrame):
    print(f"\n{'='*60}")
    print("  STEP 4 - Training XGBoost Model")
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
    print(f"  Train : {len(X_train):,}   Test : {len(X_test):,}")

    # Oversample training set only
    X_train, y_train = handle_imbalance(X_train, y_train)

    # Class weight
    n_neg = int(np.sum(y_train == 0))
    n_pos = int(np.sum(y_train == 1))
    spw   = n_neg / max(n_pos, 1)
    print(f"\n  scale_pos_weight = {spw:.2f}")

    if HAS_XGB:
        print("  Training XGBoost ...")
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
        print("  Training RandomForest ...")
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
    print("  STEP 5 - Evaluation")
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

    if len(np.unique(y_test)) > 1:
        auc  = roc_auc_score(y_test, y_prob)
        aupr = average_precision_score(y_test, y_prob)
        print(f"\n  ROC-AUC  : {auc:.4f}")
        print(f"  PR-AUC   : {aupr:.4f}  (key metric for imbalanced data)")

    # Feature importance
    if hasattr(model, 'feature_importances_'):
        imp = sorted(zip(feature_cols, model.feature_importances_), key=lambda x: -x[1])
        print("\n  Top 10 Feature Importances:")
        for name, score in imp[:10]:
            bar = '█' * int(score * 50)
            print(f"    {name:<28} {bar} {score:.4f}")

    return model, scaler, feature_cols


# ════════════════════════════════════════════════════════════════════
# STEP 6 - SAVE
# ════════════════════════════════════════════════════════════════════
def save_artifacts(model, scaler, feature_cols):
    print(f"\n{'='*60}")
    print("  STEP 6 - Saving Artifacts")
    print(f"{'='*60}")

    joblib.dump(model,        MODEL_PATH)
    joblib.dump(feature_cols, FEATURES_PATH)
    joblib.dump(scaler,       SCALER_PATH)

    print(f"  fraud_model.pkl     -> {MODEL_PATH}")
    print(f"  feature_columns.pkl -> {FEATURES_PATH}")
    print(f"  scaler.pkl          -> {SCALER_PATH}")
    print("\n  All artifacts saved. Run: python app.py")


# ════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(
        description="Train Ethereum Phishing Detector from MulDiGraph.pkl"
    )
    parser.add_argument(
        '--graph',
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'MulDiGraph.pkl'),
        help='Path to MulDiGraph.pkl'
    )
    args = parser.parse_args()

    if not os.path.exists(args.graph):
        print(f"\n[ERROR] Graph file not found: {args.graph}")
        print("  Copy MulDiGraph.pkl to model/data/ and run:")
        print("  python model/train_model.py --graph model/data/MulDiGraph.pkl")
        sys.exit(1)

    t0 = datetime.now()
    print(f"\n  Ethereum Phishing Fraud Detection - Model Training")
    print(f"  Started : {t0.strftime('%H:%M:%S')}")
    print(f"  WARNING : Feature extraction on 2.97M nodes takes 20-40 min")
    print(f"            Keep this terminal open and do not close it.\n")

    G                           = load_graph(args.graph)
    feat                        = extract_features(G)
    model, scaler, feature_cols = train(feat)
    save_artifacts(model, scaler, feature_cols)

    elapsed = int((datetime.now() - t0).total_seconds())
    mins    = elapsed // 60
    secs    = elapsed % 60
    print(f"\n  Finished in {mins}m {secs}s\n")


if __name__ == '__main__':
    main()
