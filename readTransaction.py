from web3 import Web3
import json
import time

# ==========================================
# LOAD DEPLOYMENT INFO
# ==========================================

with open("./blockchain/deployment.json", "r") as f:
    deployment = json.load(f)

CONTRACT_ADDRESS = deployment["address"]

print("\n========== LATEST DEPLOYMENT ==========\n")

print("Network     :", deployment["network"])

print("Contract    :", deployment["contract"])

print("Address     :", deployment["address"])

print("Deployed By :", deployment["deployedBy"])

print("Timestamp   :", deployment["timestamp"])

print("\n=======================================\n")

# ==========================================
# CONNECT TO GANACHE
# ==========================================

GANACHE_RPC = "http://127.0.0.1:7545"

web3 = Web3(
    Web3.HTTPProvider(GANACHE_RPC)
)

if not web3.is_connected():
    print("[-] Failed to connect to Ganache")
    exit()

print("[+] Connected to Ganache")

# ==========================================
# LOAD ABI
# ==========================================

with open("./blockchain/abi.json", "r") as f:
    abi = json.load(f)

# ==========================================
# CONNECT CONTRACT
# ==========================================

contract = web3.eth.contract(
    address=Web3.to_checksum_address(
        CONTRACT_ADDRESS
    ),
    abi=abi
)

# ==========================================
# PRINT CONTRACT INFO
# ==========================================

print("\n========== CONTRACT INFO ==========\n")

print("Connected Contract Address:")
print(contract.address)

code = web3.eth.get_code(
    contract.address
)

print("\nContract Exists On Chain:")
print(code != b"")

print("\nContract Bytecode Size:")
print(len(code.hex()))

print("\n===================================")

# ==========================================
# TOTAL LOGGED TXS
# ==========================================

total = contract.functions.getTotalTransactions().call()

print(f"\n[+] Total Logged Transactions: {total}")

if total == 0:
    print("\n[-] No transactions stored in contract")
    exit()

# ==========================================
# GET LATEST LOGGED TX HASH
# ==========================================

latest_logged_hash = contract.functions.txHashes(
    total - 1
).call()

print("\n[+] Latest Logged Transaction Hash:")
print(latest_logged_hash)

# ==========================================
# READ CONTRACT RECORD
# ==========================================

record = contract.functions.getTransaction(
    latest_logged_hash
).call()

# ==========================================
# UNPACK RECORD
# ==========================================

tx_hash        = record[0]
sender         = record[1]
receiver       = record[2]
amount_wei     = record[3]
fraud_score    = record[4]
threshold      = record[5]
decision       = record[6]
action         = record[7]
timestamp      = record[8]
exists         = record[9]

# ==========================================
# READ RAW BLOCKCHAIN TX
# ==========================================

raw_tx = web3.eth.get_transaction(
    tx_hash
)

receipt = web3.eth.get_transaction_receipt(
    tx_hash
)

# ==========================================
# CHECK CONTRACT INTERACTION
# ==========================================

is_contract_interaction = False

if raw_tx["to"] is not None:

    target_code = web3.eth.get_code(
        raw_tx["to"]
    )

    if target_code != b"":
        is_contract_interaction = True

# ==========================================
# PRINT BLOCKCHAIN DETAILS
# ==========================================

print("\n========== BLOCKCHAIN DETAILS ==========\n")

print("Transaction Hash :", tx_hash)

print("From             :", raw_tx["from"])

print("To               :", raw_tx["to"])

print(
    "Value (ETH)      :",
    web3.from_wei(
        raw_tx["value"],
        "ether"
    )
)

print("Gas Used         :", receipt["gasUsed"])

print(
    "Gas Price (Gwei) :",
    web3.from_wei(
        raw_tx["gasPrice"],
        "gwei"
    )
)

print("Nonce            :", raw_tx["nonce"])

print("Block Number     :", raw_tx.blockNumber)

print(
    "Transaction Index:",
    raw_tx["transactionIndex"]
)

print(
    "Readable Time    :",
    time.strftime(
        "%Y-%m-%d %H:%M:%S",
        time.localtime(timestamp)
    )
)

print(
    "Contract Call    :",
    is_contract_interaction
)

print(
    "Transaction Status:",
    "SUCCESS"
    if receipt["status"] == 1
    else "FAILED"
)

# ==========================================
# PRINT FRAUD METADATA
# ==========================================

print("\n========== FRAUD ANALYSIS ==========\n")

print(
    "Fraud Score      :",
    fraud_score / 100,
    "%"
)

print(
    "Threshold        :",
    threshold / 100,
    "%"
)

print("Decision         :", decision)

print("Action           :", action)

print("Exists On Chain  :", exists)

# ==========================================
# THRESHOLD HISTORY
# ==========================================

history_count = contract.functions.getThresholdCount(
    sender
).call()

print(
    "\nThreshold History Count:",
    history_count
)

if history_count > 0:

    history = contract.functions.getThresholdHistory(
        sender
    ).call()

    latest_hist = history[-1]

    print(
        "\n========== LATEST THRESHOLD RECORD ==========\n"
    )

    print(
        "Wallet Threshold :",
        latest_hist[0] / 100,
        "%"
    )

    print(
        "Fraud Score      :",
        latest_hist[1] / 100,
        "%"
    )

    print(
        "Wallet TX Count  :",
        latest_hist[2]
    )

    print(
        "Amount (ETH)     :",
        web3.from_wei(
            latest_hist[3],
            "ether"
        )
    )

    print(
        "Timestamp        :",
        time.strftime(
            "%Y-%m-%d %H:%M:%S",
            time.localtime(latest_hist[4])
        )
    )

print("\n==========================================")