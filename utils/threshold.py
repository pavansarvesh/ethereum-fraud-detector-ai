"""
DYNAMIC THRESHOLD + DECISION ENGINE
Rules:
  0.00001 – 25 ETH  → SAFE   (default)
  26 – 50 ETH       → FREEZE
  50+ ETH           → BLOCK
These are defaults. Per-wallet history overrides them dynamically.
"""

import math
from database.db import get_sender_history

# ── Default amount-based rules ────────────────────────────────────────────────
def get_amount_based_rule(amount: float) -> dict:
    if amount <= 0.00001:
        return {'action': 'BLOCK',  'reason': 'Zero or dust transaction — suspicious', 'base_threshold': 0.30}
    elif amount <= 25.0:
        return {'action': 'SAFE',   'reason': 'Amount within safe range (0–25 ETH)',   'base_threshold': 0.70}
    elif amount <= 50.0:
        return {'action': 'FREEZE', 'reason': 'Amount in freeze range (26–50 ETH)',    'base_threshold': 0.50}
    else:
        return {'action': 'BLOCK',  'reason': 'Amount exceeds 50 ETH — auto-block',   'base_threshold': 0.30}


def calculate_dynamic_threshold(sender_address: str, current_amount: float) -> dict:
    history     = get_sender_history(sender_address, limit=200)
    amount_rule = get_amount_based_rule(current_amount)
    base_thresh = amount_rule['base_threshold']

    # ── No history ────────────────────────────────────────────────────────────
    if not history:
        risk = 'high' if current_amount > 50 else 'medium' if current_amount > 25 else 'low'
        return {
            'threshold'        : round(base_thresh, 4),
            'risk_level'       : risk,
            'reason'           : f"New wallet — {amount_rule['reason']}",
            'avg_amount'       : 0.0,
            'std_dev'          : 0.0,
            'amount_deviation' : current_amount,
            'tx_count'         : 0,
            'amount_rule'      : amount_rule['action'],
        }

    # ── Existing wallet ───────────────────────────────────────────────────────
    amounts      = [h['amount'] for h in history if h.get('amount', 0) > 0]
    failed_flags = [h.get('failed', 0) for h in history]

    if not amounts:
        amounts = [current_amount]

    tx_count     = len(amounts)
    avg_amount   = sum(amounts) / tx_count
    variance     = sum((a - avg_amount)**2 for a in amounts) / tx_count
    std_dev      = math.sqrt(variance) if variance > 0 else avg_amount * 0.5
    failed_ratio = sum(failed_flags) / max(len(failed_flags), 1)

    # Z-score deviation
    z_score = (current_amount - avg_amount) / max(std_dev, 0.01)

    # Risk classification
    score = 0
    if avg_amount > 10:    score += 2
    elif avg_amount > 3:   score += 1
    if tx_count < 3:       score += 1
    if tx_count > 500:     score += 1
    if failed_ratio > 0.3: score += 2
    elif failed_ratio > 0.1: score += 1
    risk_level = 'high' if score >= 4 else 'medium' if score >= 2 else 'low'

    # Start from amount-based threshold, then tighten by deviation
    threshold = base_thresh
    if z_score > 5:
        threshold = max(threshold - 0.20, 0.25)
        reason = f"Amount {current_amount:.2f} ETH is {z_score:.1f}σ above wallet avg {avg_amount:.2f} ETH — critically tightened"
    elif z_score > 3:
        threshold = max(threshold - 0.12, 0.30)
        reason = f"Amount {current_amount:.2f} ETH is {z_score:.1f}σ above wallet avg {avg_amount:.2f} ETH — tightened"
    elif z_score > 2:
        threshold = max(threshold - 0.07, 0.35)
        reason = f"Amount moderately elevated ({z_score:.1f}σ above avg {avg_amount:.2f} ETH)"
    else:
        reason = f"Amount within normal range for this wallet (avg {avg_amount:.2f} ETH)"

    return {
        'threshold'        : round(threshold, 4),
        'risk_level'       : risk_level,
        'reason'           : reason,
        'avg_amount'       : round(avg_amount, 4),
        'std_dev'          : round(std_dev, 4),
        'amount_deviation' : round(z_score, 4),
        'tx_count'         : tx_count,
        'amount_rule'      : amount_rule['action'],
    }


def make_decision(fraud_probability: float, threshold: float,
                  amount: float, amount_rule: str) -> dict:
    """
    Decision combines AI score + amount rule.
    Amount rule can force FREEZE/BLOCK regardless of AI score.
    """
    # Amount rule overrides
    if amount_rule == 'BLOCK' and amount > 50:
        return {
            'decision': 'FRAUDULENT',
            'action'  : 'BLOCK',
            'fraud_probability': fraud_probability,
            'threshold'        : threshold,
            'override'         : 'Amount > 50 ETH — auto-blocked',
        }
    if amount_rule == 'FREEZE':
        if fraud_probability > threshold:
            return {
                'decision': 'FRAUDULENT',
                'action'  : 'BLOCK',
                'fraud_probability': fraud_probability,
                'threshold'        : threshold,
                'override'         : 'Freeze range + fraud score exceeds threshold',
            }
        return {
            'decision': 'SUSPICIOUS',
            'action'  : 'FREEZE',
            'fraud_probability': fraud_probability,
            'threshold'        : threshold,
            'override'         : 'Amount in freeze range (26–50 ETH)',
        }

    # Normal AI-based decision
    is_fraud = fraud_probability > threshold
    if is_fraud:
        action = 'BLOCK_AND_BLACKLIST' if fraud_probability > 0.88 else 'BLOCK'
    else:
        action = 'APPROVE_WITH_WARNING' if fraud_probability > threshold * 0.85 else 'APPROVE'

    return {
        'decision'         : 'FRAUDULENT' if is_fraud else 'SAFE',
        'action'           : action,
        'fraud_probability': round(fraud_probability, 4),
        'threshold'        : round(threshold, 4),
        'override'         : None,
    }


def generate_ai_explanation(features: dict, fraud_probability: float,
                             threshold: float, decision: str,
                             thresh_data: dict, amount: float) -> list:
    """
    Generates human-readable explanation reasons for the AI decision.
    Returns list of strings for display in dashboard.
    """
    reasons = []
    sent_count  = features.get('sent_count', 0)
    recv_count  = features.get('recv_count', 0)
    avg_amount  = thresh_data.get('avg_amount', 0)
    z_score     = thresh_data.get('amount_deviation', 0)
    tx_count    = thresh_data.get('tx_count', 0)
    night_ratio = features.get('night_ratio', 0)
    large_flag  = features.get('large_tx_flag', 0)
    zero_recv   = features.get('zero_recv_flag', 0)
    high_fanout = features.get('high_fan_out', 0)
    volatility  = features.get('amount_volatility', 0)
    risk_level  = thresh_data.get('risk_level', 'medium')

    # Amount analysis
    if amount > 50:
        reasons.append('Amount exceeds 50 ETH — exceeds maximum safe limit')
    elif amount > 25:
        reasons.append(f'Amount {amount:.2f} ETH is in the freeze zone (26–50 ETH)')
    elif z_score > 3:
        reasons.append(f'Amount {amount:.2f} ETH is {z_score:.1f}× above wallet normal ({avg_amount:.2f} ETH)')
    elif z_score > 1.5:
        reasons.append(f'Amount moderately elevated above wallet average ({avg_amount:.2f} ETH)')

    # New wallet
    if tx_count == 0:
        reasons.append('New wallet — no prior transaction history found')
    elif tx_count < 3:
        reasons.append(f'Very limited transaction history ({tx_count} transactions)')

    # Receiver
    if features.get('sent_unique_recv', 0) > 50:
        reasons.append('Sender interacts with unusually high number of unique receivers')
    elif recv_count == 0:
        reasons.append('Receiver wallet has no prior incoming transaction record')

    # Night transaction
    if night_ratio > 0.5:
        reasons.append(f'High night transaction ratio ({night_ratio*100:.0f}% of transfers at night)')
    elif features.get('hour', 12) < 6 or features.get('hour', 12) > 22:
        reasons.append('Transaction initiated during high-risk night hours (10 PM–6 AM)')

    # Activity patterns
    if high_fanout:
        reasons.append('High fan-out pattern — funds sent to many different wallets')
    if zero_recv:
        reasons.append('Wallet only sends, never receives — one-directional flow pattern')
    if volatility > 3:
        reasons.append(f'High amount volatility ({volatility:.1f}×) — irregular transfer sizes')

    # Risk level
    if risk_level == 'high':
        reasons.append('Wallet risk score classified as HIGH based on behavior history')
    elif risk_level == 'medium' and fraud_probability > 0.4:
        reasons.append('Wallet risk score classified as MEDIUM with elevated fraud probability')

    # Fraud score proximity to threshold
    margin = fraud_probability - threshold
    if margin > 0:
        reasons.append(f'Fraud score ({fraud_probability*100:.1f}%) exceeds dynamic threshold ({threshold*100:.1f}%) by {margin*100:.1f}%')
    elif margin > -0.1:
        reasons.append(f'Fraud score ({fraud_probability*100:.1f}%) is close to threshold ({threshold*100:.1f}%) — borderline case')

    # Fallback
    if not reasons:
        if decision in ('FRAUDULENT', 'SUSPICIOUS'):
            reasons.append('Transaction flagged by XGBoost pattern recognition')
        else:
            reasons.append('Transaction matches normal wallet behavior patterns')
            reasons.append(f'Fraud score {fraud_probability*100:.1f}% is well below threshold {threshold*100:.1f}%')

    return reasons
