"""
DEPLOY SMART CONTRACT
Run this after starting Ganache to deploy FraudDetection.sol

Steps:
  1. Start Ganache (desktop app or: npx ganache)
  2. Run: python blockchain/deploy.py
  3. Copy the printed CONTRACT_ADDRESS into your .env file
"""
import os, json
from web3 import Web3

RPC = os.getenv("BLOCKCHAIN_RPC", "http://127.0.0.1:7545")

# Minimal compiled bytecode (compile full contract in Remix IDE for production)
# This is a placeholder — use Remix IDE to compile FraudDetection.sol
PLACEHOLDER_BYTECODE = "0x"  # Replace with compiled bytecode from Remix

def deploy():
    w3 = Web3(Web3.HTTPProvider(RPC))
    if not w3.is_connected():
        print(f"ERROR: Cannot connect to {RPC}")
        print("Make sure Ganache is running on port 7545")
        return

    accounts = w3.eth.accounts
    print(f"Connected to {RPC}")
    print(f"Available accounts: {len(accounts)}")
    print(f"Deployer: {accounts[0]}")
    print(f"Balance: {w3.from_wei(w3.eth.get_balance(accounts[0]), 'ether')} ETH")
    print()
    print("To deploy FraudDetection.sol:")
    print("  1. Open https://remix.ethereum.org")
    print("  2. Create file → paste contracts/FraudDetection.sol")
    print("  3. Compile with Solidity 0.8.19")
    print("  4. Deploy tab → Environment: Web3 Provider → http://127.0.0.1:7545")
    print("  5. Click Deploy")
    print("  6. Copy the contract address")
    print("  7. Add to .env: CONTRACT_ADDRESS=0x...")
    print()
    print("Then set your admin private key:")
    print(f"  ADMIN_PRIVATE_KEY={w3.eth.accounts[0]}")
    print("  (Get private key from Ganache: click key icon)")

if __name__ == "__main__":
    deploy()
