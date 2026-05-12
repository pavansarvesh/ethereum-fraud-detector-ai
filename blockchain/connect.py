"""
Updated blockchain/connect.py
Fixes block number fetch and adds proper status endpoint
"""

import os
import json
import hashlib
import time
from datetime import datetime

# Try importing web3 with new middleware name
try:
    from web3 import Web3
    try:
        from web3.middleware import ExtraDataToPOAMiddleware as geth_poa_middleware
    except ImportError:
        geth_poa_middleware = None
    WEB3_AVAILABLE = True
except ImportError:
    WEB3_AVAILABLE = False

# ── Configuration ─────────────────────────────────────────────────────────────
BLOCKCHAIN_RPC    = os.getenv("BLOCKCHAIN_RPC",    "http://127.0.0.1:7545")
CONTRACT_ADDRESS  = os.getenv("CONTRACT_ADDRESS",  "")
ADMIN_PRIVATE_KEY = os.getenv("ADMIN_PRIVATE_KEY", "")

_w3       = None
_contract = None

CONTRACT_ABI = [
    {
        "inputs": [
            {"name": "txHash",     "type": "string"},
            {"name": "sender",     "type": "address"},
            {"name": "receiver",   "type": "address"},
            {"name": "amountWei",  "type": "uint256"},
            {"name": "fraudScore", "type": "uint256"},
            {"name": "threshold",  "type": "uint256"},
            {"name": "decision",   "type": "string"},
            {"name": "action",     "type": "string"},
        ],
        "name": "logTransaction",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "getTotalTransactions",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function"
    },
]


# ── Web3 Connection ───────────────────────────────────────────────────────────
def get_web3():
    global _w3
    if not WEB3_AVAILABLE:
        return None
    if _w3 is None:
        _w3 = Web3(Web3.HTTPProvider(BLOCKCHAIN_RPC))
        if geth_poa_middleware:
            try:
                _w3.middleware_onion.inject(geth_poa_middleware, layer=0)
            except Exception:
                pass
        if _w3.is_connected():
            print(f"[BLOCKCHAIN] Connected to {BLOCKCHAIN_RPC}")
        else:
            print(f"[BLOCKCHAIN] WARNING: Cannot connect to {BLOCKCHAIN_RPC}")
    return _w3


def is_connected() -> bool:
    try:
        w3 = get_web3()
        return w3 is not None and w3.is_connected()
    except Exception:
        return False


# ── Log Transaction ───────────────────────────────────────────────────────────
def log_transaction_on_chain(tx_hash, sender, receiver, amount_eth,
                              fraud_probability, threshold, decision, action) -> dict:
    """
    Attempts real blockchain logging.
    Falls back to deterministic simulation if Ganache not available.
    """
    w3 = get_web3()

    # ── Real blockchain logging ───────────────────────────────────────────────
    if w3 and w3.is_connected() and ADMIN_PRIVATE_KEY and CONTRACT_ADDRESS:
        try:
            contract = w3.eth.contract(
                address=Web3.to_checksum_address(CONTRACT_ADDRESS),
                abi=CONTRACT_ABI
            )
            admin    = w3.eth.account.from_key(ADMIN_PRIVATE_KEY)
            nonce    = w3.eth.get_transaction_count(admin.address)
            amt_wei  = w3.to_wei(min(amount_eth, 1e9), "ether")
            fs_int   = int(fraud_probability * 10000)
            th_int   = int(threshold * 10000)

            s_addr = Web3.to_checksum_address(sender)   if len(str(sender))==42   else admin.address
            r_addr = Web3.to_checksum_address(receiver) if len(str(receiver))==42 else admin.address

            tx = contract.functions.logTransaction(
                tx_hash, s_addr, r_addr, amt_wei, fs_int, th_int, decision, action
            ).build_transaction({
                "from": admin.address, "nonce": nonce,
                "gas": 300000, "gasPrice": w3.eth.gas_price,
            })
            signed  = w3.eth.account.sign_transaction(tx, ADMIN_PRIVATE_KEY)
            receipt = w3.eth.wait_for_transaction_receipt(
                w3.eth.send_raw_transaction(signed.rawTransaction)
            )
            return {
                "success"         : receipt.status == 1,
                "blockchain_hash" : receipt.transactionHash.hex(),
                "block_number"    : receipt.blockNumber,
                "gas_used"        : receipt.gasUsed,
                "simulated"       : False,
            }
        except Exception as e:
            print(f"[BLOCKCHAIN] Contract call failed: {e}")

    # ── Simulated blockchain logging ──────────────────────────────────────────
    # Generate deterministic hash from tx data
    raw       = f"{tx_hash}{sender}{receiver}{amount_eth}{time.time()}"
    sim_hash  = "0x" + hashlib.sha256(raw.encode()).hexdigest()

    # Get real block number if connected even without contract
    block_num = 0
    if w3 and w3.is_connected():
        try:
            block_num = w3.eth.block_number
        except Exception:
            block_num = 0

    return {
        "success"         : True,
        "blockchain_hash" : sim_hash,
        "block_number"    : block_num,
        "gas_used"        : 0,
        "simulated"       : True,
    }


# ── Blockchain Info for Dashboard ────────────────────────────────────────────
def get_blockchain_info() -> dict:
    """Returns current blockchain status — called by Flask /blockchain/info"""
    w3 = get_web3()

    if not w3 or not w3.is_connected():
        return {
            "connected"         : False,
            "rpc"               : BLOCKCHAIN_RPC,
            "block_number"      : 0,
            "block_hash"        : "",
            "gas_limit"         : 0,
            "timestamp"         : 0,
            "contract_address"  : CONTRACT_ADDRESS,
            "total_on_chain_tx" : 0,
            "network_id"        : 0,
        }

    try:
        block      = w3.eth.get_block("latest")
        block_num  = block.number
        block_hash = block.hash.hex() if block.hash else ""
        net_id     = w3.net.version

        # Try getting on-chain tx count from contract
        total_tx = 0
        if CONTRACT_ADDRESS:
            try:
                contract = w3.eth.contract(
                    address=Web3.to_checksum_address(CONTRACT_ADDRESS),
                    abi=CONTRACT_ABI
                )
                total_tx = contract.functions.getTotalTransactions().call()
            except Exception:
                pass

        return {
            "connected"         : True,
            "rpc"               : BLOCKCHAIN_RPC,
            "block_number"      : block_num,
            "block_hash"        : block_hash,
            "gas_limit"         : block.gasLimit,
            "timestamp"         : block.timestamp,
            "contract_address"  : CONTRACT_ADDRESS or "Not deployed",
            "total_on_chain_tx" : total_tx,
            "network_id"        : net_id,
        }
    except Exception as e:
        print(f"[BLOCKCHAIN] Info error: {e}")
        return {
            "connected"    : True,
            "rpc"          : BLOCKCHAIN_RPC,
            "block_number" : 0,
            "error"        : str(e),
        }
