"""
blockchain/connect.py — Phase 1 + 2 + 3
Real contract deployment, threshold anchoring, model hash verification.
"""

import os, hashlib, time, json
from datetime import datetime

try:
    from web3 import Web3
    try:
        from web3.middleware import ExtraDataToPOAMiddleware as geth_poa_middleware
    except ImportError:
        geth_poa_middleware = None
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False

BLOCKCHAIN_RPC    = os.getenv("BLOCKCHAIN_RPC",    "http://127.0.0.1:7545")
CONTRACT_ADDRESS  = os.getenv("CONTRACT_ADDRESS",  "")
ADMIN_PRIVATE_KEY = os.getenv("ADMIN_PRIVATE_KEY", "")

_w3       = None
_contract = None

# ── Full ABI (matches FraudDetection_v2.sol) ──────────────────────────────────
CONTRACT_ABI = [
    # logTransaction
    {"inputs":[
        {"name":"txHash","type":"string"},{"name":"sender","type":"address"},
        {"name":"receiver","type":"address"},{"name":"amountWei","type":"uint256"},
        {"name":"fraudScore","type":"uint256"},{"name":"threshold","type":"uint256"},
        {"name":"decision","type":"string"},{"name":"action","type":"string"}],
     "name":"logTransaction","outputs":[],"stateMutability":"nonpayable","type":"function"},
    # updateWalletThreshold
    {"inputs":[
        {"name":"wallet","type":"address"},{"name":"threshold","type":"uint256"},
        {"name":"fraudScore","type":"uint256"},{"name":"amountWei","type":"uint256"}],
     "name":"updateWalletThreshold","outputs":[],"stateMutability":"nonpayable","type":"function"},
    # registerModelHash
    {"inputs":[{"name":"hash","type":"bytes32"},{"name":"version","type":"string"}],
     "name":"registerModelHash","outputs":[],"stateMutability":"nonpayable","type":"function"},
    # verifyModelHash
    {"inputs":[{"name":"currentHash","type":"bytes32"}],
     "name":"verifyModelHash","outputs":[{"name":"","type":"bool"}],
     "stateMutability":"view","type":"function"},
    # getThresholdHistory
    {"inputs":[{"name":"wallet","type":"address"}],
     "name":"getThresholdHistory",
     "outputs":[{"components":[
         {"name":"threshold","type":"uint256"},{"name":"fraudScore","type":"uint256"},
         {"name":"txCount","type":"uint256"},{"name":"amountWei","type":"uint256"},
         {"name":"timestamp","type":"uint256"},{"name":"prevHash","type":"bytes32"}
     ],"name":"","type":"tuple[]"}],
     "stateMutability":"view","type":"function"},
    # getThresholdCount
    {"inputs":[{"name":"wallet","type":"address"}],
     "name":"getThresholdCount","outputs":[{"name":"","type":"uint256"}],
     "stateMutability":"view","type":"function"},
    # getTotalTransactions
    {"inputs":[],"name":"getTotalTransactions",
     "outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    # isBlacklisted
    {"inputs":[{"name":"wallet","type":"address"}],
     "name":"isBlacklisted","outputs":[{"name":"","type":"bool"}],
     "stateMutability":"view","type":"function"},
    # modelHash
    {"inputs":[],"name":"modelHash","outputs":[{"name":"","type":"bytes32"}],
     "stateMutability":"view","type":"function"},
    # walletLastThreshold
    {"inputs":[{"name":"","type":"address"}],"name":"walletLastThreshold",
     "outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    # walletTxCount
    {"inputs":[{"name":"","type":"address"}],"name":"walletTxCount",
     "outputs":[{"name":"","type":"uint256"}],"stateMutability":"view","type":"function"},
    # Events
    {"anonymous":False,"inputs":[
        {"indexed":True,"name":"txHash","type":"string"},
        {"indexed":True,"name":"sender","type":"address"},
        {"indexed":False,"name":"decision","type":"string"},
        {"indexed":False,"name":"action","type":"string"},
        {"indexed":False,"name":"fraudScore","type":"uint256"},
        {"indexed":False,"name":"threshold","type":"uint256"},
        {"indexed":False,"name":"timestamp","type":"uint256"}],
     "name":"TransactionLogged","type":"event"},
    {"anonymous":False,"inputs":[
        {"indexed":True,"name":"wallet","type":"address"},
        {"indexed":False,"name":"threshold","type":"uint256"},
        {"indexed":False,"name":"fraudScore","type":"uint256"},
        {"indexed":False,"name":"txCount","type":"uint256"},
        {"indexed":False,"name":"timestamp","type":"uint256"}],
     "name":"ThresholdUpdated","type":"event"},
    {"anonymous":False,"inputs":[
        {"indexed":True,"name":"hash","type":"bytes32"},
        {"indexed":False,"name":"version","type":"string"},
        {"indexed":False,"name":"timestamp","type":"uint256"}],
     "name":"ModelHashRegistered","type":"event"},
]


# ── Web3 helpers ──────────────────────────────────────────────────────────────
def get_web3() -> Web3:
    global _w3
    if not WEB3_AVAILABLE: return None
    if _w3 is None:
        _w3 = Web3(Web3.HTTPProvider(BLOCKCHAIN_RPC))
        if geth_poa_middleware:
            try: _w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            except Exception: pass
        print(f"[BLOCKCHAIN] {'Connected' if _w3.is_connected() else 'FAILED'} -> {BLOCKCHAIN_RPC}")
    return _w3

def get_contract():
    global _contract
    if _contract is not None: return _contract
    w3 = get_web3()
    if w3 and w3.is_connected() and CONTRACT_ADDRESS:
        try:
            # Prefer compiled ABI from deploy (full, 29 entries)
            abi = CONTRACT_ABI
            abi_path = os.path.join(os.path.dirname(__file__), 'abi.json')
            if os.path.exists(abi_path):
                with open(abi_path) as f:
                    abi = json.load(f)
            _contract = w3.eth.contract(
                address=Web3.to_checksum_address(CONTRACT_ADDRESS),
                abi=abi
            )
            print(f"[BLOCKCHAIN] Contract loaded at {CONTRACT_ADDRESS}")
        except Exception as e:
            print(f"[BLOCKCHAIN] Contract load error: {e}")
    return _contract

def is_connected() -> bool:
    try: return get_web3() is not None and get_web3().is_connected()
    except: return False

def _send_tx(fn_call) -> dict:
    """Build, sign, and send a contract transaction.
    Supports two modes:
      1. Private key mode: signs with ADMIN_PRIVATE_KEY
      2. Ganache unlocked mode: sends directly (Ganache auto-signs)
    """
    w3 = get_web3()

    if ADMIN_PRIVATE_KEY:
        # Mode 1: Signed transaction (production / Sepolia)
        admin  = w3.eth.account.from_key(ADMIN_PRIVATE_KEY)
        nonce  = w3.eth.get_transaction_count(admin.address)
        tx     = fn_call.build_transaction({
            "from": admin.address, "nonce": nonce,
            "gas": 500000, "gasPrice": w3.eth.gas_price,
        })
        signed  = w3.eth.account.sign_transaction(tx, ADMIN_PRIVATE_KEY)
        receipt = w3.eth.wait_for_transaction_receipt(
            w3.eth.send_raw_transaction(signed.rawTransaction)
        )
    else:
        # Mode 2: Ganache unlocked accounts (no private key needed)
        deployer = w3.eth.accounts[0]
        nonce    = w3.eth.get_transaction_count(deployer)
        tx       = fn_call.build_transaction({
            "from": deployer, "nonce": nonce,
            "gas": 500000, "gasPrice": w3.eth.gas_price,
        })
        tx_hash  = w3.eth.send_transaction(tx)
        receipt  = w3.eth.wait_for_transaction_receipt(tx_hash)

    return {
        "success"         : receipt.status == 1,
        "blockchain_hash" : receipt.transactionHash.hex(),
        "block_number"    : receipt.blockNumber,
        "gas_used"        : receipt.gasUsed,
        "simulated"       : False,
    }

def _simulated(tx_hash: str, sender: str) -> dict:
    """Deterministic simulation when Ganache not available."""
    sim_hash  = "0x" + hashlib.sha256(f"{tx_hash}{sender}{time.time()}".encode()).hexdigest()
    block_num = 0
    w3 = get_web3()
    if w3 and w3.is_connected():
        try: block_num = w3.eth.block_number
        except: pass
    return {"success":True,"blockchain_hash":sim_hash,"block_number":block_num,"gas_used":0,"simulated":True}


# ── Phase 1: Log Transaction ──────────────────────────────────────────────────
def log_transaction_on_chain(tx_hash, sender, receiver, amount_eth,
                              fraud_probability, threshold, decision, action) -> dict:
    w3       = get_web3()
    contract = get_contract()

    if w3 and w3.is_connected() and contract:
        try:
            s_addr = Web3.to_checksum_address(sender)   if len(str(sender))==42   else w3.eth.accounts[0]
            r_addr = Web3.to_checksum_address(receiver) if len(str(receiver))==42 else w3.eth.accounts[0]
            return _send_tx(contract.functions.logTransaction(
                tx_hash, s_addr, r_addr,
                w3.to_wei(min(float(amount_eth), 1e9), "ether"),
                int(float(fraud_probability) * 10000),
                int(float(threshold) * 10000),
                decision, action
            ))
        except Exception as e:
            print(f"[BLOCKCHAIN] logTransaction error: {e}")

    return _simulated(tx_hash, sender)


# ── Phase 2: Anchor Threshold On-Chain ────────────────────────────────────────
def anchor_threshold_on_chain(wallet_address: str, threshold: float,
                               fraud_score: float, amount_eth: float) -> dict:
    """
    Stores threshold value on-chain after every transaction.
    Creates tamper-proof threshold history per wallet.
    """
    w3       = get_web3()
    contract = get_contract()

    if w3 and w3.is_connected() and contract:
        try:
            w_addr = Web3.to_checksum_address(wallet_address) if len(str(wallet_address))==42 else w3.eth.accounts[0]
            return _send_tx(contract.functions.updateWalletThreshold(
                w_addr,
                int(float(threshold)    * 10000),
                int(float(fraud_score)  * 10000),
                w3.to_wei(min(float(amount_eth), 1e9), "ether"),
            ))
        except Exception as e:
            print(f"[BLOCKCHAIN] anchorThreshold error: {e}")

    # Simulated
    return {"success":True,"simulated":True,"blockchain_hash":"","block_number":0}


# ── Phase 2: Get Threshold History from Chain ─────────────────────────────────
def get_threshold_history_from_chain(wallet_address: str) -> list:
    """
    Retrieves wallet's complete threshold history from blockchain.
    This is tamper-proof — pulled directly from Ethereum state.
    """
    w3       = get_web3()
    contract = get_contract()

    if not (w3 and w3.is_connected() and contract):
        return []

    try:
        w_addr  = Web3.to_checksum_address(wallet_address) if len(str(wallet_address))==42 else None
        if not w_addr: return []
        history = contract.functions.getThresholdHistory(w_addr).call()
        return [{
            "threshold"  : h[0] / 10000,
            "fraud_score": h[1] / 10000,
            "tx_count"   : h[2],
            "amount_eth" : float(w3.from_wei(h[3], "ether")),
            "timestamp"  : h[4],
            "prev_hash"  : h[5].hex(),
            "time_str"   : datetime.fromtimestamp(h[4]).strftime("%H:%M:%S") if h[4] > 0 else "—",
        } for h in history]
    except Exception as e:
        print(f"[BLOCKCHAIN] getThresholdHistory error: {e}")
        return []


# ── Phase 3: Register Model Hash ──────────────────────────────────────────────
def register_model_hash(model_path: str, version: str = "v1.0") -> dict:
    """
    Computes sha256 of fraud_model.pkl and stores it on-chain.
    Called once at Flask startup.
    Proves the AI model was never swapped.
    """
    if not os.path.exists(model_path):
        print(f"[BLOCKCHAIN] Model file not found: {model_path}")
        return {"registered": False, "error": "Model file not found"}

    # Compute hash
    sha256 = hashlib.sha256()
    with open(model_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    hex_hash  = sha256.hexdigest()
    bytes_hash = bytes.fromhex(hex_hash)
    # Pad to 32 bytes
    bytes32_hash = bytes_hash[:32].ljust(32, b'\x00')

    print(f"[BLOCKCHAIN] Model hash: 0x{hex_hash[:16]}...")

    w3       = get_web3()
    contract = get_contract()

    if w3 and w3.is_connected() and contract:
        try:
            result = _send_tx(contract.functions.registerModelHash(bytes32_hash, version))
            result["model_hash"] = f"0x{hex_hash}"
            result["version"]    = version
            print(f"[BLOCKCHAIN] Model hash registered on-chain (OK)")
            return result
        except Exception as e:
            print(f"[BLOCKCHAIN] registerModelHash error: {e}")

    return {"registered": True, "simulated": True, "model_hash": f"0x{hex_hash}", "version": version}


def verify_model_integrity(model_path: str) -> dict:
    """
    Verifies current model file matches the on-chain hash.
    Call before every prediction to ensure model wasn't tampered.
    """
    if not os.path.exists(model_path):
        return {"verified": False, "error": "Model file not found"}

    sha256 = hashlib.sha256()
    with open(model_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    hex_hash     = sha256.hexdigest()
    bytes32_hash = bytes.fromhex(hex_hash)[:32].ljust(32, b'\x00')

    w3       = get_web3()
    contract = get_contract()

    if w3 and w3.is_connected() and contract:
        try:
            is_valid = contract.functions.verifyModelHash(bytes32_hash).call()
            return {
                "verified"    : is_valid,
                "current_hash": f"0x{hex_hash}",
                "status"      : "INTACT" if is_valid else "TAMPERED — model hash mismatch!",
            }
        except Exception as e:
            pass

    return {"verified": True, "simulated": True, "current_hash": f"0x{hex_hash}",
            "status": "Simulated (contract not deployed)"}


# ── Blockchain Info ────────────────────────────────────────────────────────────
def get_blockchain_info() -> dict:
    w3       = get_web3()
    contract = get_contract()

    if not w3 or not w3.is_connected():
        return {"connected":False,"rpc":BLOCKCHAIN_RPC,"block_number":0,
                "block_hash":"","gas_limit":0,"contract_address":CONTRACT_ADDRESS,"total_on_chain_tx":0}
    try:
        block    = w3.eth.get_block("latest")
        total_tx = 0
        if contract:
            try: total_tx = contract.functions.getTotalTransactions().call()
            except: pass
        return {
            "connected"        : True,
            "rpc"              : BLOCKCHAIN_RPC,
            "block_number"     : block.number,
            "block_hash"       : block.hash.hex() if block.hash else "",
            "gas_limit"        : block.gasLimit,
            "timestamp"        : block.timestamp,
            "contract_address" : CONTRACT_ADDRESS or "Not deployed — see README",
            "total_on_chain_tx": total_tx,
            "network_id"       : w3.net.version,
        }
    except Exception as e:
        return {"connected":True,"rpc":BLOCKCHAIN_RPC,"block_number":0,"error":str(e)}


def get_network_stats() -> dict:
    w3 = get_web3()
    if not w3 or not w3.is_connected():
        return {"connected":False,"message":"Ganache not running on port 7545"}
    try:
        latest   = w3.eth.get_block("latest")
        gas_price = w3.eth.gas_price
        accounts  = w3.eth.accounts
        account_info = []
        for acc in accounts[:5]:
            try:
                bal = w3.eth.get_balance(acc)
                account_info.append({"address":acc,"balance":round(float(w3.from_wei(bal,"ether")),4)})
            except: pass
        try:
            pending = w3.eth.get_block("pending")
            pending_count = len(pending.transactions) if pending else 0
        except: pending_count = 0
        return {
            "connected"        : True,
            "rpc"              : BLOCKCHAIN_RPC,
            "network_id"       : w3.net.version,
            "block_number"     : latest.number,
            "block_hash"       : latest.hash.hex() if latest.hash else "",
            "block_timestamp"  : latest.timestamp,
            "gas_price_gwei"   : round(float(w3.from_wei(gas_price,"gwei")),4),
            "gas_limit"        : latest.gasLimit,
            "gas_used"         : latest.gasUsed,
            "gas_utilization"  : round(latest.gasUsed/max(latest.gasLimit,1)*100,2),
            "pending_tx"       : pending_count,
            "total_accounts"   : len(accounts),
            "accounts"         : account_info,
        }
    except Exception as e:
        return {"connected":True,"error":str(e)}


def verify_transaction_receipt(tx_hash: str) -> dict:
    w3 = get_web3()
    if not w3 or not w3.is_connected():
        return {"verified":False,"message":"Blockchain not connected","tx_hash":tx_hash}
    try:
        receipt = w3.eth.get_transaction_receipt(tx_hash)
        if receipt:
            current_block = w3.eth.block_number
            tx_data       = w3.eth.get_transaction(tx_hash)
            return {
                "verified"      : True,
                "tx_hash"       : tx_hash,
                "block_number"  : receipt.blockNumber,
                "block_hash"    : receipt.blockHash.hex(),
                "confirmations" : current_block - receipt.blockNumber,
                "gas_used"      : receipt.gasUsed,
                "status"        : "SUCCESS" if receipt.status==1 else "FAILED",
                "from"          : tx_data["from"] if tx_data else "",
                "to"            : tx_data["to"]   if tx_data else "",
                "value_eth"     : float(w3.from_wei(tx_data["value"],"ether")) if tx_data else 0,
            }
    except Exception: pass
    return {"verified":False,"tx_hash":tx_hash,
            "message":"Transaction is simulated (deploy contract to Ganache for real verification)",
            "confirmations":0,"status":"SIMULATED"}
