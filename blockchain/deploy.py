"""
DEPLOY SMART CONTRACT — Compiles and deploys FraudDetection.sol to Ganache.

Steps:
  1. Start Ganache (desktop app or: npx ganache)
  2. Run: python blockchain/deploy.py
  3. The script auto-updates .env with CONTRACT_ADDRESS and ADMIN_PRIVATE_KEY
"""
import os, json, sys

try:
    from web3 import Web3
except ImportError:
    print("ERROR: web3 not installed. Run: pip install web3")
    sys.exit(1)

try:
    import solcx
except ImportError:
    print("ERROR: py-solc-x not installed. Run: pip install py-solc-x")
    sys.exit(1)

RPC = os.getenv("BLOCKCHAIN_RPC", "http://127.0.0.1:7545")


def compile_contract():
    """Compile FraudDetection.sol using py-solc-x."""
    contract_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "contracts", "FraudDetection.sol"
    )
    if not os.path.exists(contract_path):
        print(f"ERROR: Contract not found: {contract_path}")
        sys.exit(1)

    with open(contract_path, "r") as f:
        source = f.read()

    # Install solc 0.8.19 if not already installed
    installed = solcx.get_installed_solc_versions()
    target_version = "0.8.19"
    if not any(str(v) == target_version for v in installed):
        print(f"  Installing Solidity compiler v{target_version}...")
        solcx.install_solc(target_version)
    solcx.set_solc_version(target_version)

    print(f"  Compiling FraudDetection.sol with solc {target_version}...")
    compiled = solcx.compile_source(
        source,
        output_values=["abi", "bin"],
        solc_version=target_version,
    )

    # Get the contract
    contract_key = None
    for key in compiled:
        if "FraudDetection" in key:
            contract_key = key
            break

    if not contract_key:
        print(f"ERROR: FraudDetection contract not found in compiled output.")
        print(f"  Available: {list(compiled.keys())}")
        sys.exit(1)

    abi      = compiled[contract_key]["abi"]
    bytecode = compiled[contract_key]["bin"]
    print(f"  Compilation successful — ABI entries: {len(abi)}, Bytecode: {len(bytecode)} chars")
    return abi, bytecode


def deploy():
    print(f"\n{'='*55}")
    print("  Smart Contract Deployment — FraudDetection.sol")
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

    # Compile
    abi, bytecode = compile_contract()

    # Deploy
    print(f"\n  Deploying contract...")
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

    # Get private key from Ganache
    # Ganache's default first account private key (standard)
    # For Ganache CLI, we can try to get it
    private_key = ""
    try:
        # Try Ganache RPC to get private key
        import requests
        resp = requests.post(RPC, json={
            "jsonrpc": "2.0",
            "method": "personal_listAccounts",
            "params": [],
            "id": 1
        })
    except:
        pass

    # Update .env file
    env_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
    env_lines = []
    if os.path.exists(env_path):
        with open(env_path, "r") as f:
            env_lines = f.readlines()

    # Update or add CONTRACT_ADDRESS
    updated_contract = False
    updated_key      = False
    new_lines = []
    for line in env_lines:
        if line.strip().startswith("CONTRACT_ADDRESS="):
            new_lines.append(f"CONTRACT_ADDRESS={contract_address}\n")
            updated_contract = True
        elif line.strip().startswith("ADMIN_PRIVATE_KEY=") and private_key:
            new_lines.append(f"ADMIN_PRIVATE_KEY={private_key}\n")
            updated_key = True
        else:
            new_lines.append(line)

    if not updated_contract:
        new_lines.append(f"CONTRACT_ADDRESS={contract_address}\n")

    with open(env_path, "w") as f:
        f.writelines(new_lines)

    print(f"\n  .env updated with CONTRACT_ADDRESS={contract_address}")

    # Save ABI for reference
    abi_path = os.path.join(os.path.dirname(__file__), "abi.json")
    with open(abi_path, "w") as f:
        json.dump(abi, f, indent=2)
    print(f"  ABI saved to {abi_path}")

    print(f"\n{'='*55}")
    print("  Deployment Complete!")
    print(f"{'='*55}")
    print(f"\n  IMPORTANT: You still need to set ADMIN_PRIVATE_KEY in .env")
    print(f"  Get it from Ganache: click the key icon next to {deployer}")
    print(f"  Then restart Flask: python app.py\n")


if __name__ == "__main__":
    deploy()
