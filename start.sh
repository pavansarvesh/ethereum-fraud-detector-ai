#!/bin/bash
echo "============================================"
echo "  Ethereum AI Fraud Detection System"
echo "============================================"
echo ""
echo "Step 1: Training AI model (if not exists)..."
if [ ! -f "model/fraud_model.pkl" ]; then
    python model/train_model.py
fi

echo ""
echo "Step 2: Starting Flask backend..."
echo "  API: http://127.0.0.1:5000"
echo ""
python app.py
