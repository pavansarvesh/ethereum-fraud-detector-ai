"""
Dynamic threshold + confirmation engine.
The score is derived from wallet history, not fixed amount bands.
"""

import math
from database.db import get_wallet_history


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _counterparty_count(history: list, wallet_address: str) -> int:
    wallet = (wallet_address or '').lower()
    counterparties = set()
    for entry in history:
        sender = (entry.get('sender') or '').lower()
        receiver = (entry.get('receiver') or '').lower()
        if sender and sender != wallet:
            counterparties.add(sender)
        if receiver and receiver != wallet:
            counterparties.add(receiver)
    return len(counterparties)


def calculate_dynamic_threshold(wallet_address: str, current_amount: float) -> dict:
    history = get_wallet_history(wallet_address, limit=200)

    if not history:
        return {
            'threshold'        : 0.55,
            'risk_level'       : 'medium',
            'reason'           : 'New wallet — threshold anchored from first observed behavior',
            'avg_amount'       : 0.0,
            'std_dev'          : 0.0,
            'amount_deviation' : 0.0,
            'tx_count'         : 0,
            'counterparties'   : 0,
            'failed_ratio'     : 0.0,
        }

    amounts = [float(h.get('amount', 0) or 0) for h in history if float(h.get('amount', 0) or 0) > 0]
    if not amounts:
        amounts = [float(current_amount or 0)]

    tx_count = len(history)
    avg_amount = sum(amounts) / len(amounts)
    variance = sum((a - avg_amount) ** 2 for a in amounts) / len(amounts)
    std_dev = math.sqrt(variance) if variance > 0 else max(avg_amount * 0.25, 0.01)
    failed_ratio = sum(1 for h in history if int(h.get('failed', 0) or 0) > 0) / max(tx_count, 1)
    counterparties = _counterparty_count(history, wallet_address)
    z_score = abs(float(current_amount or 0) - avg_amount) / max(std_dev, 0.01)
    concentration = counterparties / max(tx_count, 1)

    score = 0
    if tx_count < 3:
        score += 2
    elif tx_count < 10:
        score += 1

    if failed_ratio > 0.30:
        score += 2
    elif failed_ratio > 0.10:
        score += 1

    if z_score > 4:
        score += 2
    elif z_score > 2:
        score += 1

    if concentration > 0.75 and tx_count > 8:
        score += 1
    if concentration < 0.20 and tx_count > 20:
        score += 1

    if avg_amount > 0 and float(current_amount or 0) > avg_amount * 3:
        score += 1

    risk_level = 'high' if score >= 5 else 'medium' if score >= 2 else 'low'

    threshold = 0.70 - (score * 0.05)
    if risk_level == 'high':
        threshold -= min(max(z_score - 1.5, 0) * 0.02, 0.10)
    elif risk_level == 'low':
        threshold += 0.04

    threshold = _clamp(threshold, 0.30, 0.85)

    if risk_level == 'high':
        reason = f"Wallet behavior is high-risk: {tx_count} txs, {failed_ratio*100:.1f}% failed, {counterparties} counterparties"
    elif risk_level == 'medium':
        reason = f"Wallet behavior is mixed: {tx_count} txs, {failed_ratio*100:.1f}% failed, {z_score:.1f}σ from wallet average"
    else:
        reason = f"Wallet behavior is stable: {tx_count} txs with {counterparties} counterparties and low failure rate"

    return {
        'threshold'        : round(threshold, 4),
        'risk_level'       : risk_level,
        'reason'           : reason,
        'avg_amount'       : round(avg_amount, 4),
        'std_dev'          : round(std_dev, 4),
        'amount_deviation' : round(z_score, 4),
        'tx_count'         : tx_count,
        'counterparties'   : counterparties,
        'failed_ratio'     : round(failed_ratio, 4),
    }


def make_decision(fraud_probability: float, threshold: float, risk_level: str, confirmed: bool = False) -> dict:
    """Return review status without using fixed amount bands."""
    fraud_probability = round(float(fraud_probability), 4)
    threshold = round(float(threshold), 4)

    if fraud_probability >= threshold + 0.12 or risk_level == 'high':
        confirmation_level = 'high'
        requires_confirmation = True
    elif fraud_probability >= threshold or risk_level == 'medium':
        confirmation_level = 'medium'
        requires_confirmation = True
    else:
        confirmation_level = 'low'
        requires_confirmation = False

    if requires_confirmation and not confirmed:
        action = 'REVIEW_REQUIRED'
    elif requires_confirmation and confirmed:
        action = 'APPROVE_AFTER_CONFIRMATION'
    else:
        action = 'APPROVE'

    return {
        'decision'             : 'FRAUDULENT' if fraud_probability >= threshold else 'SAFE',
        'action'               : action,
        'fraud_probability'    : fraud_probability,
        'threshold'            : threshold,
        'override'             : None,
        'requires_confirmation': requires_confirmation,
        'confirmation_level'   : confirmation_level,
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

    # Amount behavior, not fixed amount rules
    if z_score > 4:
        reasons.append(f'Current amount is {z_score:.1f}σ above wallet average ({avg_amount:.2f} ETH)')
    elif z_score > 2:
        reasons.append(f'Current amount is elevated above wallet average ({avg_amount:.2f} ETH)')

    # New wallet
    if tx_count == 0:
        reasons.append('New wallet — no prior transaction history found')
    elif tx_count < 3:
        reasons.append(f'Very limited transaction history ({tx_count} transactions)')

    # Receiver
    if features.get('sent_unique_recv', 0) > 50:
        reasons.append('Wallet interacts with an unusually high number of counterparties')
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
