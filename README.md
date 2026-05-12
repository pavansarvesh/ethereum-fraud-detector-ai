# Ethereum AI Fraud Detection System

AI + Blockchain based Fintech Security System.

## Project Structure

```
ethereumFraudDetection/
│
├── app.py                          ← Flask entry point (STEP 3)
├── requirements.txt
│
├── model/
│   ├── predict.py                  ← STEP 4: AI fraud detection
│   └── fraud_model.pkl             ← Your trained XGBoost model (copy here)
│
├── utils/
│   ├── threshold.py                ← STEP 5: Dynamic threshold engine
│   └── feature_engineering.py     ← Feature extraction
│
├── contracts/
│   └── FraudDetection.sol          ← STEP 6: Solidity smart contract
│
├── blockchain/
│   └── connect.py                  ← STEP 6+7: Web3 connection & logging
│
├── database/
│   └── db.py                       ← SQLite transaction history
│
├── routes/
│   └── transaction_routes.py       ← All Flask API routes
│
└── frontend/src/
    └── Dashboard.jsx               ← STEP 8: Full React dashboard
```

---

## Setup & Run

### 1. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 2. Copy your trained model
```bash
cp /path/to/your/fraud_model.pkl model/fraud_model.pkl
```

### 3. Start Flask backend
```bash
python app.py
# Runs on http://127.0.0.1:5000
```

### 4. Install frontend dependencies
```bash
cd frontend
npm install ethers recharts
```

### 5. Start React dashboard
```bash
npm run dev
# Runs on http://localhost:3000
```

---

## Blockchain Setup (Ganache)

### Step 1: Start Ganache
- Open Ganache desktop app
- New workspace → Quickstart
- Note: RPC Server = http://127.0.0.1:7545

### Step 2: Deploy Smart Contract
1. Open Remix IDE → https://remix.ethereum.org
2. Create new file → paste contracts/FraudDetection.sol
3. Compile (Solidity 0.8.19)
4. Deploy → Environment: Web3 Provider → http://127.0.0.1:7545
5. Copy deployed Contract Address

### Step 3: Configure environment
Create a `.env` file:
```
BLOCKCHAIN_RPC=http://127.0.0.1:7545
CONTRACT_ADDRESS=0xYourDeployedContractAddress
ADMIN_PRIVATE_KEY=0xYourGanachePrivateKey
```

> Get private key from Ganache: click key icon next to any account

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /analyze_transaction | Full fraud pipeline |
| GET | /transactions | Recent transactions |
| GET | /dashboard/stats | KPI stats |
| GET | /blockchain/info | Blockchain status |

### Sample POST /analyze_transaction
```json
{
  "sender":   "0xA123...",
  "receiver": "0xB456...",
  "amount":   3.5,
  "tx_hash":  "TX-ABC123"
}
```

### Sample Response
```json
{
  "fraud_probability": 0.91,
  "threshold":         0.70,
  "risk_level":        "high",
  "decision":          "FRAUDULENT",
  "action":            "BLOCK",
  "blockchain_hash":   "0xAB12...",
  "block_number":      1025
}
```

---

## Pipeline (Complete Flow)

```
MetaMask Wallet
      ↓
React Dashboard (Dashboard.jsx)
      ↓
POST /analyze_transaction (Flask)
      ↓
Feature Engineering (utils/feature_engineering.py)
      ↓
Sender History Lookup (database/db.py)
      ↓
Dynamic Threshold (utils/threshold.py)
      ↓
AI Fraud Detection (model/predict.py)
      ↓
Decision Engine
      ↓
Smart Contract Trigger (blockchain/connect.py)
      ↓
Blockchain Logging (FraudDetection.sol)
      ↓
SQLite Storage (database/db.py)
      ↓
Dashboard Update + Alerts
```

---

## Note on Model
If `fraud_model.pkl` is not present, the system automatically uses a
rule-based fallback scorer. Place your trained XGBoost `.pkl` file
in the `model/` folder for full AI predictions.
