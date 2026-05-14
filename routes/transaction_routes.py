"""
Routes - Complete pipeline with:
- Persistent alerts + smart contract events
- Receipt verification
- Gas analytics
- Network stats
- Blacklist management
- Block confirmations
"""

import uuid
from datetime import datetime
from flask import Blueprint, request, jsonify

from model.predict             import predict_fraud
from utils.threshold           import (calculate_dynamic_threshold,
                                       make_decision, generate_ai_explanation)
from utils.feature_engineering import engineer_features
from blockchain.connect        import (log_transaction_on_chain,
                                       get_blockchain_info, get_network_stats,
                                       verify_transaction_receipt,
                                       anchor_threshold_on_chain,
                                       get_threshold_history_from_chain,
                                       verify_model_integrity)
from database.db               import (
    save_transaction, get_sender_history,
    get_all_transactions, get_dashboard_stats,
    blacklist_wallet, is_blacklisted,
    get_blacklisted_wallets, remove_blacklist,
    get_blockchain_chain, get_alerts, save_alert,
    clear_alerts, get_sc_events, save_sc_event,
    get_gas_analytics,
)

transaction_bp = Blueprint('transactions', __name__)


# ── POST /analyze_transaction ──────────────────────────────────────────────────
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
            'All transactions from blacklisted wallets are permanently blocked',
        ]
        result = _build_blocked_result(tx_hash, sender, receiver, amount, explanation)
        save_transaction({**result, 'failed': 1})
        _save_alert_and_event(result, sender, receiver)
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
    thresh_data = calculate_dynamic_threshold(sender, amount)
    threshold   = thresh_data['threshold']
    risk_level  = thresh_data['risk_level']
    amount_rule = thresh_data.get('amount_rule', 'SAFE')

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

    # ── Phase 2: Anchor threshold on-chain ────────────────────────────────────
    # This makes threshold evolution tamper-proof and verifiable by anyone
    try:
        anchor_threshold_on_chain(sender, threshold, fraud_prob, amount)
    except Exception as e:
        print(f"[PHASE2] Threshold anchor error: {e}")

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

    # ── Persist alert + SC event if blocked/frozen ─────────────────────────────
    _save_alert_and_event(tx_record, sender, receiver)

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
        'features'            : {k: v for k, v in features.items() if k != 'receiver'},
        'timestamp'           : datetime.now().isoformat(),
    }), 200


def _save_alert_and_event(tx: dict, sender: str, receiver: str):
    """Persist alert and SC event for blocked/frozen transactions."""
    action = tx.get('action', '')
    if action in ('BLOCK', 'BLOCK_AND_BLACKLIST', 'FREEZE'):
        alert_text = (
            f"{action}: {sender[:10]}...→{receiver[:10]}... | "
            f"Score: {tx.get('fraud_probability',0)*100:.1f}% | "
            f"Threshold: {tx.get('threshold',0)*100:.1f}% | "
            f"Amount: {tx.get('amount',0)} ETH"
        )
        alert_type = 'danger' if action.startswith('BLOCK') else 'warn'
        save_alert(alert_text, alert_type)

        fn = ('blockTransaction() + blacklistWallet()' if action == 'BLOCK_AND_BLACKLIST'
              else 'freezeTransaction()' if action == 'FREEZE'
              else 'blockTransaction()')
        save_sc_event({
            'fn'    : fn,
            'sender': sender,
            'recv'  : receiver,
            'score' : f"{tx.get('fraud_probability',0)*100:.1f}%",
            'thresh': f"{tx.get('threshold',0)*100:.1f}%",
            'hash'  : tx.get('tx_hash', ''),
            'block' : tx.get('block_number', '—'),
            'amount': tx.get('amount', 0),
        })


def _build_blocked_result(tx_hash, sender, receiver, amount, explanation):
    return {
        'tx_hash'           : tx_hash,
        'sender'            : sender,
        'receiver'          : receiver,
        'amount'            : amount,
        'hour'              : datetime.now().hour,
        'fraud_probability' : 1.0,
        'normal_probability': 0.0,
        'threshold'         : 0.0,
        'risk_level'        : 'high',
        'decision'          : 'FRAUDULENT',
        'action'            : 'BLOCK_AND_BLACKLIST',
        'blockchain_hash'   : '',
        'block_number'      : 0,
        'explanation'       : explanation,
        'model_used'        : 'Blacklist',
        'amount_rule'       : 'BLOCK',
        'threshold_reason'  : 'Blacklisted wallet',
        'blockchain_simulated': True,
        'timestamp'         : datetime.now().isoformat(),
    }


# ── Standard endpoints ─────────────────────────────────────────────────────────
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
    return jsonify(get_blockchain_chain(int(request.args.get('limit', 10))))


# ── NEW: Persistent Alerts ─────────────────────────────────────────────────────
@transaction_bp.route('/alerts',            methods=['GET'])
def get_alerts_route():
    return jsonify(get_alerts(int(request.args.get('limit', 50))))

@transaction_bp.route('/alerts/clear',      methods=['DELETE'])
def clear_alerts_route():
    clear_alerts()
    return jsonify({'status': 'ok', 'message': 'Alerts cleared'})


# ── NEW: Persistent SC Events ──────────────────────────────────────────────────
@transaction_bp.route('/sc_events',         methods=['GET'])
def get_sc_events_route():
    return jsonify(get_sc_events(int(request.args.get('limit', 20))))


# ── NEW: Blacklist Management ──────────────────────────────────────────────────
@transaction_bp.route('/blacklist',         methods=['GET'])
def get_blacklist():
    return jsonify(get_blacklisted_wallets())

@transaction_bp.route('/blacklist/<address>', methods=['DELETE'])
def remove_from_blacklist(address):
    remove_blacklist(address)
    return jsonify({'status': 'ok', 'message': f'{address} removed from blacklist'})

@transaction_bp.route('/blacklist',         methods=['POST'])
def add_to_blacklist():
    data = request.json or {}
    blacklist_wallet(data.get('address',''), data.get('reason','Manual blacklist'))
    return jsonify({'status': 'ok'})


# ── NEW: Gas Analytics ─────────────────────────────────────────────────────────
@transaction_bp.route('/gas/analytics',     methods=['GET'])
def gas_analytics():
    return jsonify(get_gas_analytics())


# ── NEW: Network Stats ─────────────────────────────────────────────────────────
@transaction_bp.route('/network/stats',     methods=['GET'])
def network_stats():
    return jsonify(get_network_stats())


# ── NEW: Transaction Receipt Verification ─────────────────────────────────────
@transaction_bp.route('/verify/<tx_hash>',  methods=['GET'])
def verify_receipt(tx_hash):
    return jsonify(verify_transaction_receipt(tx_hash))


# ── Reset (demo utility) ───────────────────────────────────────────────────────
@transaction_bp.route('/transactions/reset', methods=['DELETE'])
def reset_transactions():
    try:
        from database.db import get_connection
        conn = get_connection()
        for table in ['transactions','blacklisted_wallets','alerts','sc_events']:
            conn.execute(f'DELETE FROM {table}')
        conn.commit(); conn.close()
        return jsonify({'status': 'ok', 'message': 'All data cleared'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── Phase 2: Threshold History from Blockchain ────────────────────────────────
@transaction_bp.route('/blockchain/threshold_history/<address>', methods=['GET'])
def threshold_history(address):
    """
    Returns wallet threshold evolution from blockchain — tamper-proof.
    Phase 5: This powers the Threshold History graph in the dashboard.
    """
    history = get_threshold_history_from_chain(address)
    return jsonify({
        'address'      : address,
        'history'      : history,
        'count'        : len(history),
        'source'       : 'blockchain' if history else 'no_data',
        'tamper_proof' : True,
    })


# ── Phase 3: Model Integrity Verification ─────────────────────────────────────
@transaction_bp.route('/blockchain/model_integrity', methods=['GET'])
def model_integrity():
    """Verifies fraud_model.pkl hash matches what is stored on-chain."""
    import os
    model_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), 'model', 'fraud_model.pkl'
    )
    return jsonify(verify_model_integrity(model_path))


# ── Phase 2: On-chain Wallet Stats ────────────────────────────────────────────
@transaction_bp.route('/blockchain/wallet_stats/<address>', methods=['GET'])
def wallet_stats_chain(address):
    """Returns on-chain tx count, last threshold, blacklist status for a wallet."""
    from blockchain.connect import get_contract, get_web3
    from web3 import Web3
    w3       = get_web3()
    contract = get_contract()
    if not (w3 and w3.is_connected() and contract):
        return jsonify({'error': 'Blockchain not connected', 'address': address,
                        'note': 'Deploy FraudDetection.sol to Ganache first'})
    try:
        w_addr      = Web3.to_checksum_address(address) if len(address)==42 else address
        tx_count    = contract.functions.walletTxCount(w_addr).call()
        last_thresh = contract.functions.walletLastThreshold(w_addr).call()
        is_bl       = contract.functions.isBlacklisted(w_addr).call()
        return jsonify({
            'address'            : address,
            'on_chain_tx_count'  : tx_count,
            'last_threshold_pct' : last_thresh / 100,
            'is_blacklisted'     : is_bl,
            'source'             : 'blockchain',
        })
    except Exception as e:
        return jsonify({'error': str(e), 'address': address})

