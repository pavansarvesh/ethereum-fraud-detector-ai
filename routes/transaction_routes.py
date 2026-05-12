"""
Routes - Complete pipeline with:
- Amount-based rules (0-25 SAFE, 26-50 FREEZE, 50+ BLOCK)
- AI explanation generation
- Blockchain chain with metadata
- Full response for dashboard
"""

import uuid
from datetime import datetime
from flask import Blueprint, request, jsonify

from model.predict             import predict_fraud
from utils.threshold           import (calculate_dynamic_threshold,
                                       make_decision, generate_ai_explanation)
from utils.feature_engineering import engineer_features
from blockchain.connect        import log_transaction_on_chain, get_blockchain_info
from database.db               import (
    save_transaction, get_sender_history,
    get_all_transactions, get_dashboard_stats,
    blacklist_wallet, is_blacklisted, get_blockchain_chain
)

transaction_bp = Blueprint('transactions', __name__)


@transaction_bp.route('/analyze_transaction', methods=['POST'])
def analyze_transaction():
    data      = request.json or {}
    sender    = data.get('sender',   'unknown')
    receiver  = data.get('receiver', 'unknown')
    amount    = float(data.get('amount', 0))
    tx_hash   = data.get('tx_hash', f'TX-{uuid.uuid4().hex[:12].upper()}')
    timestamp = data.get('timestamp', datetime.now().timestamp())

    # ── Blacklist check ────────────────────────────────────────────────────────
    if is_blacklisted(sender):
        explanation = [
            'Sender wallet is on the blacklist',
            'Previously flagged for fraudulent activity',
            'All transactions from blacklisted wallets are blocked',
        ]
        result = _build_result(
            tx_hash, sender, receiver, amount, timestamp,
            fraud_prob=1.0, threshold=0.0, risk_level='high',
            decision='FRAUDULENT', action='BLOCK_AND_BLACKLIST',
            blockchain_hash='', block_number=0,
            explanation=explanation, thresh_data={},
            model_used='Blacklist', features={},
        )
        save_transaction({**result, 'failed': 1})
        return jsonify(result), 200

    # ── Feature engineering ────────────────────────────────────────────────────
    sender_history = get_sender_history(sender, limit=200)
    features       = engineer_features(
        {'amount': amount, 'receiver': receiver, 'timestamp': timestamp},
        sender_history
    )

    # ── AI prediction ──────────────────────────────────────────────────────────
    prediction = predict_fraud(features)
    fraud_prob = prediction['fraud_probability']

    # ── Dynamic threshold ──────────────────────────────────────────────────────
    thresh_data  = calculate_dynamic_threshold(sender, amount)
    threshold    = thresh_data['threshold']
    risk_level   = thresh_data['risk_level']
    amount_rule  = thresh_data.get('amount_rule', 'SAFE')

    # ── Decision ───────────────────────────────────────────────────────────────
    dec_data = make_decision(fraud_prob, threshold, amount, amount_rule)
    decision = dec_data['decision']
    action   = dec_data['action']

    # ── AI Explanation ─────────────────────────────────────────────────────────
    explanation = generate_ai_explanation(
        features, fraud_prob, threshold, decision, thresh_data, amount
    )

    # ── Blockchain log ─────────────────────────────────────────────────────────
    bc = log_transaction_on_chain(
        tx_hash, sender, receiver, amount,
        fraud_prob, threshold, decision, action
    )

    # ── Auto-blacklist ─────────────────────────────────────────────────────────
    if action == 'BLOCK_AND_BLACKLIST':
        blacklist_wallet(sender, f'Auto-blacklisted: fraud {fraud_prob:.2%}')

    # ── Save to DB ─────────────────────────────────────────────────────────────
    tx_record = {
        'tx_hash'          : tx_hash,
        'sender'           : sender,
        'receiver'         : receiver,
        'amount'           : amount,
        'hour'             : features.get('hour', datetime.now().hour),
        'fraud_probability': fraud_prob,
        'threshold'        : threshold,
        'risk_level'       : risk_level,
        'decision'         : decision,
        'action'           : action,
        'blockchain_hash'  : bc.get('blockchain_hash', ''),
        'block_number'     : bc.get('block_number', 0),
        'failed'           : 1 if action in ('BLOCK','BLOCK_AND_BLACKLIST','FREEZE') else 0,
    }
    save_transaction(tx_record)

    return jsonify({
        **tx_record,
        'normal_probability'  : prediction['normal_probability'],
        'model_used'          : prediction['model_used'],
        'avg_sender_amount'   : thresh_data.get('avg_amount', 0),
        'amount_deviation'    : thresh_data.get('amount_deviation', 0),
        'threshold_reason'    : thresh_data.get('reason', ''),
        'amount_rule'         : amount_rule,
        'explanation'         : explanation,
        'blockchain_simulated': bc.get('simulated', True),
        'timestamp'           : datetime.now().isoformat(),
    }), 200


def _build_result(tx_hash, sender, receiver, amount, timestamp,
                  fraud_prob, threshold, risk_level, decision, action,
                  blockchain_hash, block_number, explanation,
                  thresh_data, model_used, features):
    return {
        'tx_hash'           : tx_hash,
        'sender'            : sender,
        'receiver'          : receiver,
        'amount'            : amount,
        'hour'              : datetime.now().hour,
        'fraud_probability' : fraud_prob,
        'normal_probability': 1.0 - fraud_prob,
        'threshold'         : threshold,
        'risk_level'        : risk_level,
        'decision'          : decision,
        'action'            : action,
        'blockchain_hash'   : blockchain_hash,
        'block_number'      : block_number,
        'explanation'       : explanation,
        'model_used'        : model_used,
        'avg_sender_amount' : thresh_data.get('avg_amount', 0),
        'amount_deviation'  : thresh_data.get('amount_deviation', 0),
        'threshold_reason'  : thresh_data.get('reason', ''),
        'amount_rule'       : thresh_data.get('amount_rule', 'SAFE'),
        'blockchain_simulated': True,
        'timestamp'         : datetime.now().isoformat(),
    }


@transaction_bp.route('/transactions',      methods=['GET'])
def get_transactions():
    return jsonify(get_all_transactions(int(request.args.get('limit', 50))))


@transaction_bp.route('/dashboard/stats',   methods=['GET'])
def dashboard_stats():
    return jsonify(get_dashboard_stats())


@transaction_bp.route('/blockchain/info',   methods=['GET'])
def blockchain_info():
    return jsonify(get_blockchain_info())


@transaction_bp.route('/blockchain/chain',  methods=['GET'])
def blockchain_chain():
    """Returns linked blockchain records for chain visualisation."""
    limit = int(request.args.get('limit', 10))
    return jsonify(get_blockchain_chain(limit))


@transaction_bp.route('/transactions/reset', methods=['DELETE'])
def reset_transactions():
    try:
        from database.db import get_connection
        conn = get_connection()
        conn.execute('DELETE FROM transactions')
        conn.execute('DELETE FROM blacklisted_wallets')
        conn.commit(); conn.close()
        return jsonify({'status': 'ok', 'message': 'All transactions cleared'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
