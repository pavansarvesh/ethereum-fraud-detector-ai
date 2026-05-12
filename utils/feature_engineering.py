"""
FEATURE ENGINEERING
Converts raw transaction + sender history into the 24-feature
vector the trained XGBoost model expects.

Key fix: large amounts from wallets with no/few history
now properly register as high-risk features.
"""

from datetime import datetime
import math


def engineer_features(raw: dict, sender_history: list) -> dict:
    amount   = float(raw.get('amount', 0))
    receiver = raw.get('receiver', '')

    # Parse hour
    try:
        ts = raw.get('timestamp', None)
        if ts and isinstance(ts, (int, float)) and ts > 1e9:
            hour = datetime.fromtimestamp(float(ts)).hour
        else:
            hour = datetime.now().hour
    except Exception:
        hour = datetime.now().hour

    # ── Build sent history including current TX ────────────────────────────────
    hist_amounts   = [h['amount'] for h in sender_history if h.get('amount', 0) > 0]
    hist_receivers = list({h.get('receiver', '') for h in sender_history if h.get('receiver')})
    hist_hours     = [h.get('hour', 12) for h in sender_history]
    hist_failed    = [h.get('failed', 0) for h in sender_history]

    # Include current transaction in sent stats
    all_sent_amounts = hist_amounts + [amount]
    sent_count       = len(all_sent_amounts)
    sent_total       = sum(all_sent_amounts)
    sent_mean        = sent_total / sent_count
    sent_max         = max(all_sent_amounts)
    sent_min         = min(all_sent_amounts)
    sent_std         = _std(all_sent_amounts)
    all_receivers    = list(set(hist_receivers + [receiver]))
    sent_unique_recv = len(all_receivers)

    # ── Received features (approximated from history) ─────────────────────────
    # Transactions where wallet was approved as safe = received funds
    recv_txs         = [h for h in sender_history if h.get('decision') == 'SAFE']
    recv_count       = len(recv_txs)
    recv_amounts     = [h['amount'] for h in recv_txs if h.get('amount', 0) > 0]
    recv_total       = sum(recv_amounts) if recv_amounts else 0.0
    recv_mean        = recv_total / len(recv_amounts) if recv_amounts else 0.0
    recv_max         = max(recv_amounts) if recv_amounts else 0.0
    recv_unique_send = len({h.get('receiver', '') for h in recv_txs})

    # ── Temporal features ─────────────────────────────────────────────────────
    all_hours        = hist_hours + [hour]
    sent_active_span = float(max(all_hours) - min(all_hours)) if len(all_hours) > 1 else 0.0
    recv_active_span = 0.0

    # ── Night transaction features ────────────────────────────────────────────
    night_sent_count = sum(1 for h in sender_history if h.get('hour', 12) < 6 or h.get('hour', 12) > 22)
    if hour < 6 or hour > 22:
        night_sent_count += 1

    # ── Derived features ──────────────────────────────────────────────────────
    total_tx_count      = sent_count + recv_count
    sent_recv_ratio     = sent_count / max(recv_count + 1, 1)
    unique_counterparts = sent_unique_recv + recv_unique_send
    large_tx_flag       = 1 if sent_max > 10 else 0
    zero_recv_flag      = 1 if recv_count == 0 else 0
    high_fan_out        = 1 if sent_unique_recv > 50 else 0
    high_activity       = 1 if sent_count > 100 else 0
    night_ratio         = night_sent_count / max(sent_count, 1)
    amount_volatility   = sent_std / max(sent_mean, 1e-6)

    return {
        # ── 24 model features ──────────────────────────────────────────────────
        'sent_count'         : sent_count,
        'sent_total'         : round(sent_total, 6),
        'sent_mean'          : round(sent_mean, 6),
        'sent_max'           : round(sent_max, 6),
        'sent_min'           : round(sent_min, 6),
        'sent_std'           : round(sent_std, 6),
        'sent_unique_recv'   : sent_unique_recv,
        'recv_count'         : recv_count,
        'recv_total'         : round(recv_total, 6),
        'recv_mean'          : round(recv_mean, 6),
        'recv_max'           : round(recv_max, 6),
        'recv_unique_send'   : recv_unique_send,
        'sent_active_span'   : round(sent_active_span, 2),
        'recv_active_span'   : round(recv_active_span, 2),
        'night_sent_count'   : night_sent_count,
        'total_tx_count'     : total_tx_count,
        'sent_recv_ratio'    : round(sent_recv_ratio, 6),
        'unique_counterparts': unique_counterparts,
        'large_tx_flag'      : large_tx_flag,
        'zero_recv_flag'     : zero_recv_flag,
        'high_fan_out'       : high_fan_out,
        'high_activity'      : high_activity,
        'night_ratio'        : round(night_ratio, 6),
        'amount_volatility'  : round(amount_volatility, 6),
        # ── Extra context for threshold engine ─────────────────────────────────
        'amount'             : amount,
        'hour'               : hour,
        'receiver'           : receiver,
    }


def _std(values: list) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean)**2 for v in values) / len(values))
