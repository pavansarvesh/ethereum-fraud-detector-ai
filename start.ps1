# Start script for Windows (PowerShell)
Write-Host "============================================"
Write-Host "  Ethereum AI Fraud Detection System"
Write-Host "============================================"
Write-Host ""

# Step 1: Train model if not exists
if (-not (Test-Path "model\fraud_model.pkl")) {
    Write-Host "Step 1: Training AI model..."
    python model\train_synthetic.py
} else {
    Write-Host "Step 1: Model already trained (OK)"
}

# Step 2: Deploy contract if needed
if (-not (Test-Path ".env") -or -not (Select-String -Path ".env" -Pattern "CONTRACT_ADDRESS=0x" -Quiet)) {
    Write-Host "Step 2: Deploying smart contract..."
    python blockchain\deploy.py
} else {
    Write-Host "Step 2: Contract already deployed (OK)"
}

# Step 3: Start Flask
Write-Host ""
Write-Host "Step 3: Starting Flask backend..."
Write-Host "  API: http://127.0.0.1:5000"
Write-Host ""
python app.py
