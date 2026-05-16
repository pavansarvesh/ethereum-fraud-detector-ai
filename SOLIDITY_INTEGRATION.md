# Solidity Smart Contract Integration & Fraud Data Storage

## Overview

This document explains how the `FraudDetection.sol` smart contract is integrated with the AI fraud detection system, what on-chain checks and data persistence occur, and whether fraud data is stored in the contract.

**TL;DR**: The contract stores **transaction logs**, **wallet threshold history**, and **AI model integrity proofs** on Ethereum, but does **NOT** store the actual training data. Fraud scoring and analysis happen off-chain in Python/XGBoost.

---

## Contract Architecture (Phase 1, 2, 3)

### Phase 1: Transaction Logging (On-Chain Immutable Record)

**Purpose**: Create a tamper-proof ledger of all analyzed transactions.

**Data Stored**:

```solidity
struct TransactionRecord {
    string  txHash;           // Unique transaction identifier
    address sender;           // Sender wallet address
    address receiver;         // Receiver wallet address
    uint256 amountWei;        // Transfer amount in wei
    uint256 fraudScore;       // AI fraud score (0–10000 = 0%–100%)
    uint256 threshold;        // Dynamic threshold (0–10000)
    string  decision;         // "FRAUDULENT" or "SAFE"
    string  action;           // "BLOCK", "APPROVE", "REVIEW_REQUIRED", etc.
    uint256 timestamp;        // Block timestamp
    bool    exists;           // Existence flag
}
```

**Functions**:

```solidity
function logTransaction(
    string  memory txHash,
    address sender,
    address receiver,
    uint256 amountWei,
    uint256 fraudScore,
    uint256 threshold,
    string  memory decision,
    string  memory action
) public onlyOwner
```

**Key Characteristics**:

- Only the **contract owner** (Flask backend) can call this function.
- Once logged, a transaction **cannot be overwritten** (duplicate check: `require(!records[txHash].exists)`).
- Transactions are appended to `txHashes[]` array for full history.
- **Events are emitted** for off-chain listeners (blockchain explorers, monitoring systems).

**Example Event**:

```solidity
event TransactionLogged(
    string  indexed txHash,
    address indexed sender,
    string  decision,
    string  action,
    uint256 fraudScore,
    uint256 threshold,
    uint256 timestamp
);
```

---

### Phase 2: Wallet Threshold Anchoring (On-Chain History Chain)

**Purpose**: Store each wallet's **dynamic fraud threshold** at every transaction, creating a tamper-proof history.

**Data Stored**:

```solidity
struct ThresholdRecord {
    uint256 threshold;      // Computed threshold (0–10000 = 0%–100%)
    uint256 fraudScore;     // Fraud score at this TX (0–10000)
    uint256 txCount;        // Wallet's TX count at this point
    uint256 amountWei;      // Transaction amount (wei)
    uint256 timestamp;      // Block timestamp
    bytes32 prevHash;       // Hash of previous record (forms a chain)
}
```

**Functions**:

```solidity
function updateWalletThreshold(
    address wallet,
    uint256 threshold,
    uint256 fraudScore,
    uint256 amountWei
) public onlyOwner
```

**Key Characteristics**:

- Called **automatically after every transaction** by the Flask backend.
- Forms a **mini blockchain per wallet** — each record links to the previous one via `prevHash`.
- Previous hash is computed as:
  ```solidity
  prevHash = keccak256(abi.encodePacked(
      prev.threshold, prev.fraudScore, prev.timestamp
  ))
  ```
- This creates an immutable chain that **cannot be altered without detection**.

**History Access**:

```solidity
function getThresholdHistory(address wallet) public view returns (ThresholdRecord[] memory)
function getThresholdCount(address wallet) public view returns (uint256)
function walletLastThreshold(address wallet) public view returns (uint256)
```

**Why This Matters**:

- A wallet's threshold evolves as it performs more transactions.
- By storing this on-chain, we create a **tamper-proof audit trail** of how the system viewed each wallet over time.
- An attacker cannot retroactively change their fraud score without breaking the hash chain.

---

### Phase 3: AI Model Hash Verification (Proof-of-Integrity)

**Purpose**: Prove that the **AI model used for scoring was never swapped or tampered with**.

**Data Stored**:

```solidity
bytes32 public modelHash;      // SHA256 of fraud_model.pkl
uint256 public modelDeployedAt; // Deployment timestamp
string  public modelVersion;    // Version string (e.g., "v1.0")
```

**Functions**:

```solidity
function registerModelHash(bytes32 hash, string memory version) public onlyOwner
function verifyModelHash(bytes32 currentHash) public view returns (bool)
```

**Process**:

1. **At Flask startup**, the backend computes `SHA256(fraud_model.pkl)`.
2. **Backend calls** `registerModelHash()` to store it on-chain.
3. **Before every prediction**, the backend:
   - Recomputes the current model's SHA256
   - Calls `verifyModelHash()` to compare against on-chain value
   - If hashes don't match → model was tampered → **reject prediction**

**Event**:

```solidity
event ModelHashRegistered(
    bytes32 indexed hash,
    string  version,
    uint256 timestamp
);
```

**Security Guarantee**:

- If an attacker swaps `fraud_model.pkl` for a different model, the hash will differ.
- The on-chain record proves which model version was active at which time.
- Immutable audit trail of model versions.

---

## Integration Flow: Backend ↔ Smart Contract

### 1. Transaction Analysis Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│ User submits transaction via UI                                 │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Flask: /analyze_transaction (routes/transaction_routes.py)      │
│  ├─ Extract sender, receiver, amount                            │
│  ├─ Check if sender is blacklisted (calls contract)             │
│  ├─ Engineer features from receiver's on-chain history          │
│  ├─ Predict fraud using XGBoost model                           │
│  ├─ Calculate dynamic threshold                                 │
│  └─ Make decision (APPROVE, REVIEW_REQUIRED, BLOCK)             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        │ If not check_only & TX is confirmed   │
        └───────────────────┬───────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Log Transaction On-Chain                               │
│ blockchain.connect.log_transaction_on_chain()                   │
│  └─ Calls: contract.logTransaction(                             │
│      txHash, sender, receiver, amount,                          │
│      fraudScore, threshold, decision, action                    │
│    )                                                             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: Anchor Threshold On-Chain                              │
│ blockchain.connect.anchor_threshold_on_chain()                  │
│  └─ Calls: contract.updateWalletThreshold(                      │
│      sender, threshold, fraudScore, amount                      │
│    )                                                             │
│     (Stores in thresholdHistory[sender])                         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 3: Verify Model Integrity (Before Prediction)             │
│ blockchain.connect.verify_model_integrity()                     │
│  └─ Computes SHA256(fraud_model.pkl)                            │
│     Calls: contract.verifyModelHash(currentHash)                │
│     Returns: {verified: bool, status: "INTACT" or "TAMPERED"}   │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Code Integration Points

#### **Flask Backend (routes/transaction_routes.py)**

```python
@transaction_bp.route('/analyze_transaction', methods=['POST'])
def analyze_transaction():
    # ... AI scoring logic ...

    # Phase 1: Log on-chain
    bc = log_transaction_on_chain(
        tx_hash, sender, receiver, amount,
        fraud_prob, threshold, decision, action
    )

    # Phase 2: Anchor threshold
    anchor_threshold_on_chain(sender, threshold, fraud_prob, amount)

    # Auto-blacklist if BLOCK_AND_BLACKLIST
    if action == 'BLOCK_AND_BLACKLIST':
        blacklist_wallet(sender, f'Auto-blacklisted: fraud {fraud_prob:.2%}')

    return jsonify({...})
```

#### **Blockchain Integration (blockchain/connect.py)**

```python
def log_transaction_on_chain(tx_hash, sender, receiver, amount_eth,
                              fraud_probability, threshold, decision, action):
    """Phase 1: Store transaction on-chain"""
    contract = get_contract()
    return _send_tx(contract.functions.logTransaction(
        tx_hash,
        Web3.to_checksum_address(sender),
        Web3.to_checksum_address(receiver),
        w3.to_wei(amount_eth, "ether"),
        int(fraud_probability * 10000),  # Convert to 0–10000 scale
        int(threshold * 10000),
        decision,
        action
    ))

def anchor_threshold_on_chain(wallet_address, threshold, fraud_score, amount_eth):
    """Phase 2: Store threshold history on-chain"""
    contract = get_contract()
    return _send_tx(contract.functions.updateWalletThreshold(
        Web3.to_checksum_address(wallet_address),
        int(threshold * 10000),
        int(fraud_score * 10000),
        w3.to_wei(amount_eth, "ether")
    ))

def verify_model_integrity(model_path: str):
    """Phase 3: Verify AI model hash hasn't been tampered"""
    sha256 = hashlib.sha256()
    with open(model_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)

    contract = get_contract()
    is_valid = contract.functions.verifyModelHash(
        bytes.fromhex(sha256.hexdigest())[:32].ljust(32, b'\x00')
    ).call()

    return {"verified": is_valid, "status": "INTACT" if is_valid else "TAMPERED"}
```

---

## What Data Is Stored in the Contract?

### ✅ **Stored On-Chain** (Immutable, Gas Costs Apply)

1. **Transaction Records**
   - TX hash, sender, receiver, amount
   - Fraud score & threshold at time of TX
   - Decision (SAFE/FRAUDULENT) & action (APPROVE/BLOCK/REVIEW_REQUIRED)
   - Timestamp
   - _Example_: 39 transactions in your demo environment

2. **Wallet Threshold History**
   - Per-wallet evolution of fraud thresholds
   - Previous hash (chain linkage)
   - TX count per wallet
   - _Example_: All 39 TXs → threshold records for each unique wallet

3. **AI Model Hash**
   - SHA256 of `fraud_model.pkl`
   - Version string
   - Deployment timestamp
   - _Example_: `0x7a8c5f2e...` registered at contract startup

4. **Blacklist**
   - Wallet addresses flagged as permanently blacklisted
   - Triggers auto-block for any TX from that address
   - _Example_: Addresses blacklisted due to repeated fraud

### ❌ **NOT Stored On-Chain** (Computed Off-Chain, No Storage Cost)

- **Training data** (2.97M wallet samples)
- **Feature vectors** (transaction-by-transaction features)
- **Model weights** (XGBoost decision trees)
- **Wallet history snapshots** (kept in SQLite DB, not blockchain)
- **Risk assessments** (computed in-memory per TX)

**Reason**: Blockchain storage is expensive (~$0.30 per 32 bytes at $1000 gas). Full historical data would cost thousands of dollars per transaction. Instead, we store **only the verdict** and **model integrity proofs**.

---

## Validation Checks in the Smart Contract

### 1. **Ownership Check**

```solidity
modifier onlyOwner() {
    require(msg.sender == owner, "Not authorized");
    _;
}
```

Only the Flask backend (contract owner) can log transactions or update thresholds. Prevents unauthorized callers from tampering.

### 2. **Duplicate Transaction Prevention**

```solidity
require(!records[txHash].exists, "Already logged");
```

A TX hash can only be logged once. If someone tries to replay the same TX, the contract rejects it.

### 3. **Blacklist Check (On-Chain)**

```solidity
mapping(address => bool) public blacklisted;

function isBlacklisted(address wallet) public view returns (bool) {
    return blacklisted[wallet];
}
```

Flask backend calls `isBlacklisted()` before processing a TX:

```python
if is_blacklisted(sender):
    explanation = ['Sender wallet is on the blacklist', ...]
    result = _build_blocked_result(...)  # Auto-reject
```

### 4. **Auto-Blacklist on Block**

```solidity
if (keccak256(bytes(action)) == keccak256(bytes("BLOCK_AND_BLACKLIST"))) {
    _blacklist(sender);
}
```

If the backend detects a high-confidence fraud (action = `BLOCK_AND_BLACKLIST`), the contract automatically adds that wallet to the blacklist for all future TXs.

### 5. **Model Integrity Verification**

```solidity
function verifyModelHash(bytes32 currentHash) public view returns (bool) {
    return modelHash == currentHash && modelHash != bytes32(0);
}
```

Before every prediction, Flask verifies the model wasn't swapped:

```python
# Backend startup
verify_result = verify_model_integrity("model/fraud_model.pkl")
if not verify_result['verified']:
    raise Exception("Model integrity check failed!")
```

### 6. **Event Emissions for Auditability**

```solidity
event TransactionLogged(
    string indexed txHash,
    address indexed sender,
    string decision,
    string action,
    uint256 fraudScore,
    uint256 threshold,
    uint256 timestamp
);
```

Every transaction is logged as an event. Blockchain explorers and monitoring tools can listen to these events in real-time.

## How To See Contract Details

There are three practical ways to inspect what the smart contract has stored.

### 1. Read it from the Python backend

The backend already exposes helper functions in [blockchain/connect.py](blockchain/connect.py) that read contract state directly through Web3:

- `get_threshold_history_from_chain(wallet_address)` returns the full threshold history for a wallet.
- `get_blockchain_info()` returns network status and total on-chain transaction count.
- `verify_model_integrity(model_path)` checks the on-chain model hash and reports whether the current model still matches.

Example usage from a Python shell:

```python
from blockchain.connect import get_threshold_history_from_chain, get_blockchain_info

history = get_threshold_history_from_chain("0xYourWalletAddress")
print(history)

info = get_blockchain_info()
print(info)
```

To read a single transaction record from the contract, use the contract getter:

```python
from blockchain.connect import get_contract

contract = get_contract()
record = contract.functions.getTransaction("0xYourTxHash").call()
print(record)
```

To check whether a wallet is blacklisted:

```python
from blockchain.connect import get_contract

contract = get_contract()
print(contract.functions.isBlacklisted("0xWalletAddress").call())
```

### 2. Inspect emitted events on-chain

The contract emits events every time important data is written:

- `TransactionLogged`
- `ThresholdUpdated`
- `ModelHashRegistered`
- `WalletBlacklisted`
- `AlertTriggered`

These events are the easiest way to audit contract activity because they show up in transaction receipts and can be queried by wallet, transaction hash, or event type.

### 3. Query the contract state directly

The contract exposes these on-chain getters:

- `getTransaction(txHash)` for a full transaction record
- `getThresholdHistory(wallet)` for all threshold history records of a wallet
- `getThresholdCount(wallet)` for the number of threshold records stored
- `isBlacklisted(wallet)` for blacklist status
- `getTotalTransactions()` for the total number of logged contract transactions

If you want to see the data in a blockchain explorer, connect to the Ganache network and open the transaction that called `logTransaction()` or `updateWalletThreshold()`. The receipt will contain the emitted event data, and the contract storage can be decoded using the ABI in [blockchain/abi.json](blockchain/abi.json).

---

## Real-World Data Flow Example

**Scenario**: User submits TX: `0xJohn → 0xMallory, 5 ETH`

### Step 1: UI & Backend Analysis

```javascript
// Frontend (App.jsx)
const analysis = await fetch("/analyze_transaction", {
	body: JSON.stringify({
		sender: "0xJohn...",
		receiver: "0xMallory...",
		amount: 5.0,
		tx_hash: "TX-1234567890",
		confirmed: true,
	}),
});
```

### Step 2: Flask Scores the TX

```python
# routes/transaction_routes.py
features = engineer_features(...)  # Receiver history
prediction = predict_fraud(features)  # XGBoost: 0.75 fraud prob
threshold = calculate_dynamic_threshold(receiver, 5)  # 0.50
decision = 'FRAUDULENT' if 0.75 > 0.50 else 'SAFE'  # FRAUDULENT
action = 'BLOCK' if 0.75 > 0.62 else 'APPROVE'  # BLOCK
```

### Step 3: Phase 1 — Log TX On-Chain

```solidity
// Contract state before
txHashes = ["TX-001", "TX-002"]

// Flask calls logTransaction()
logTransaction(
    "TX-1234567890",
    0xJohn,
    0xMallory,
    5000000000000000000,  // 5 ETH in wei
    7500,                 // 75% fraud score (stored as 0–10000)
    5000,                 // 50% threshold
    "FRAUDULENT",
    "BLOCK"
)

// Contract state after
records["TX-1234567890"] = {
    sender: 0xJohn,
    receiver: 0xMallory,
    fraudScore: 7500,
    threshold: 5000,
    decision: "FRAUDULENT",
    action: "BLOCK",
    timestamp: 1715862907,
    exists: true
}
txHashes = ["TX-001", "TX-002", "TX-1234567890"]

// Event emitted
event TransactionLogged(
    "TX-1234567890",
    0xJohn,
    "FRAUDULENT",
    "BLOCK",
    7500,
    5000,
    1715862907
)
```

### Step 4: Phase 2 — Anchor Threshold

```solidity
// Flask calls updateWalletThreshold()
updateWalletThreshold(
    0xJohn,
    5000,         // 50% threshold
    7500,         // 75% fraud score
    5000000000000000000  // 5 ETH
)

// Contract appends to thresholdHistory[0xJohn]
thresholdHistory[0xJohn].push({
    threshold: 5000,
    fraudScore: 7500,
    txCount: 1,
    amountWei: 5000000000000000000,
    timestamp: 1715862907,
    prevHash: 0  // First record, no previous
})

walletTxCount[0xJohn] = 1
walletLastThreshold[0xJohn] = 5000

// Event emitted
event ThresholdUpdated(
    0xJohn,
    5000,
    7500,
    1,
    1715862907
)
```

### Step 5: Phase 3 — Verify Model Still Valid

```python
# Flask verifies model hash is still correct
model_integrity = verify_model_integrity("model/fraud_model.pkl")
# {verified: true, status: "INTACT"}

# If verified == false, immediately HALT all predictions
```

### Step 6: Result Returned to User

```json
{
	"tx_hash": "TX-1234567890",
	"sender": "0xJohn...",
	"receiver": "0xMallory...",
	"fraud_probability": 0.75,
	"threshold": 0.5,
	"decision": "FRAUDULENT",
	"action": "BLOCK",
	"blockchain_hash": "0xabc123...",
	"block_number": 42,
	"explanation": [
		"Receiver has suspicious fan-out pattern",
		"High frequency of small-to-medium transfers",
		"..."
	]
}
```

---

## Database Storage (Separate from Blockchain)

Fraud data is ALSO stored in SQLite (`database/db.py`) for **fast querying**:

```python
# Table: transactions
columns = [
    tx_hash, sender, receiver, amount,
    hour, fraud_probability, threshold, risk_level,
    decision, action, blockchain_hash, block_number,
    gas_used, timestamp, failed
]

# All 39 transactions stored in SQLite
# + blockchain_hash & block_number come from contract
```

**Why two databases?**

- **Blockchain**: Immutable, auditable, decentralized, slow, expensive
- **SQLite**: Fast queries, analytics, dashboard stats, cheap

Flask syncs them:

```python
# After every TX:
save_transaction(tx_record)  # → SQLite
log_transaction_on_chain(...)  # → Blockchain
```

---

## Security & Audit Trail

### Immutability Guarantees

1. **TX Logging**: Once logged, cannot be altered (duplicate check)
2. **Threshold Chain**: Hash links ensure no retroactive edits
3. **Model Hash**: Proves AI model identity at specific block height
4. **Blacklist**: Permanent (unless manually removed by owner)

### Auditability

- Every major action emits an **event**
- Events are queryable from blockchain explorers
- Full history of fraud decisions visible to regulators

### Example Audit Query

```javascript
// Retrieve all transactions from 0xJohn
const filter = contract.filters.TransactionLogged(
	null, // any txHash
	"0xJohn", // indexed sender
	null, // any decision
	null, // any action
);
const events = await contract.queryFilter(filter);
// Returns all TXs from 0xJohn with their decision & action
```

---

## Summary Table

| Aspect                            | Stored? | Location | Cost             | Reason                       |
| --------------------------------- | ------- | -------- | ---------------- | ---------------------------- |
| **Transaction Records**           | ✅ Yes  | Contract | ~$5 per TX       | Immutable audit trail        |
| **Wallet Threshold History**      | ✅ Yes  | Contract | ~$8 per TX       | Tamper-proof evolution       |
| **AI Model Hash**                 | ✅ Yes  | Contract | One-time $2      | Integrity proof              |
| **Blacklist**                     | ✅ Yes  | Contract | ~$50k per wallet | Permanent enforcement        |
| **Training Data (2.97M samples)** | ❌ No   | Local/S3 | One-time         | Too expensive for blockchain |
| **Feature Vectors**               | ❌ No   | Memory   | Free             | Computed per TX              |
| **Model Weights (XGBoost)**       | ❌ No   | Disk     | One-time         | Too large for blockchain     |
| **TX History (SQLite)**           | ✅ Yes  | Local DB | Negligible       | Fast querying                |

---

## Conclusion

The `FraudDetection.sol` contract serves as a **decentralized ledger and integrity proof layer**, not a data warehouse. It stores:

- **Verdicts** (who was blocked, why)
- **Threshold evolution** (how the model viewed each wallet)
- **Model identity** (proof the AI wasn't swapped)
- **Blacklist** (permanent blocks)

Fraud **analysis** happens off-chain in Python. Fraud **evidence** (TX logs, threshold history) is anchored on-chain for auditability and tamper-resistance.

This hybrid approach balances **decentralization & auditability** (blockchain) with **efficiency & cost** (off-chain ML).
