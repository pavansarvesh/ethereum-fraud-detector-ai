#!/bin/bash
echo "============================================"
echo "  Ethereum AI Fraud Detection System"
echo "============================================"
echo ""
echo "Step 1: Training AI model (if not exists)..."
if [ ! -f "model/fraud_model.pkl" ]; then
    python model/train_synthetic.py
fi

echo ""
echo "Step 2: Deploying contract (if needed)..."
if ! grep -q "CONTRACT_ADDRESS=0x" .env 2>/dev/null; then
    python blockchain/deploy.py
fi

echo ""
echo "Step 3: Starting Flask backend..."
echo "  API: http://127.0.0.1:5000"
echo ""
python app.py
