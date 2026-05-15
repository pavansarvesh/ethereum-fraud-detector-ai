"""
QUICK DEPLOY — Uses pre-compiled artifact from hardhat

Steps:
  1. Start Ganache (desktop app or: npx ganache)
  2. Run: python blockchain/deploy_quick.py
  3. The script auto-updates .env with CONTRACT_ADDRESS
"""
import os, json, sys

try:
    from web3 import Web3
except ImportError:
    print("ERROR: web3 not installed. Run: pip install web3")
    sys.exit(1)

RPC = os.getenv("BLOCKCHAIN_RPC", "http://127.0.0.1:7545")


def deploy():
    print(f"\n{'='*55}")
    print("  Smart Contract Deployment — FraudDetection.sol")
    print("  Using pre-compiled artifact from hardhat")
    print(f"{'='*55}\n")

    # Connect to Ganache
    w3 = Web3(Web3.HTTPProvider(RPC))
    if not w3.is_connected():
        print(f"ERROR: Cannot connect to {RPC}")
        print("Make sure Ganache is running on port 7545")
        return

    accounts = w3.eth.accounts
    deployer = accounts[0]
    balance  = w3.from_wei(w3.eth.get_balance(deployer), "ether")

    print(f"  RPC       : {RPC}")
    print(f"  Network ID: {w3.net.version}")
    print(f"  Accounts  : {len(accounts)}")
    print(f"  Deployer  : {deployer}")
    print(f"  Balance   : {balance} ETH\n")

    # Load pre-compiled artifact
    artifact_path = os.path.join(
        os.path.dirname(__file__), "..", "artifacts", "contracts",
        "FraudDetection.sol", "FraudDetection.json"
    )

    if not os.path.exists(artifact_path):
        print(f"ERROR: Compiled artifact not found at {artifact_path}")
        print("Try running: npx hardhat compile")
        return

    with open(artifact_path, "r") as f:
        artifact = json.load(f)

    abi = artifact.get("abi", [])
    bytecode = artifact.get("bytecode", "")

    if not bytecode or bytecode == "0x":
        print(f"ERROR: No bytecode found in artifact")
        return

    print(f"  Loaded pre-compiled artifact")
    print(f"  ABI entries: {len(abi)}, Bytecode: {len(bytecode)} chars\n")

    # Deploy
    print(f"  Deploying contract...")
    contract = w3.eth.contract(abi=abi, bytecode=bytecode)
    tx = contract.constructor().build_transaction({
        "from": deployer,
        "nonce": w3.eth.get_transaction_count(deployer),
        "gas": 5000000,
        "gasPrice": w3.eth.gas_price,
    })

    # Ganache auto-signs transactions from known accounts
    tx_hash = w3.eth.send_transaction(tx)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)

    contract_address = receipt.contractAddress
    block_number     = receipt.blockNumber
    gas_used         = receipt.gasUsed

    print(f"  Contract Address : {contract_address}")
    print(f"  Block Number     : {block_number}")
    print(f"  Gas Used         : {gas_used:,}")
    print(f"  Status           : {'SUCCESS' if receipt.status == 1 else 'FAILED'}")

    # Update .env file
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    env_lines = []
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            env_lines = f.readlines()

    # Update or add CONTRACT_ADDRESS
    updated_contract = False
    new_lines = []
    for line in env_lines:
        if line.strip().startswith("CONTRACT_ADDRESS="):
            new_lines.append(f"CONTRACT_ADDRESS={contract_address}\n")
            updated_contract = True
        else:
            new_lines.append(line)

    if not updated_contract:
        new_lines.append(f"CONTRACT_ADDRESS={contract_address}\n")

    with open(env_path, "w") as f:
        f.writelines(new_lines)

    print(f"\n  ✓ .env updated with CONTRACT_ADDRESS={contract_address}\n")
    print(f"{'='*55}")
    print("  Deployment complete! Frontend will verify model hash on-chain.")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    deploy()
