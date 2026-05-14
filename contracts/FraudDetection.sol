// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * FraudDetection.sol — Phase 1 + 2 + 3
 *
 * New features added on top of existing contract:
 *   Phase 1 — Real transaction logging (existing)
 *   Phase 2 — On-chain threshold anchoring per wallet
 *   Phase 3 — AI model hash verification
 *
 * Deploy on Ganache via Remix IDE:
 *   1. Open https://remix.ethereum.org
 *   2. Paste this file
 *   3. Compile with Solidity 0.8.19
 *   4. Deploy → Environment: Web3 Provider → http://127.0.0.1:7545
 *   5. Copy contract address → paste in .env as CONTRACT_ADDRESS
 */

contract FraudDetection {

    // ── Owner ─────────────────────────────────────────────────────────────────
    address public owner;
    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }
    constructor() { owner = msg.sender; }

    // ── Amount Rules (matches Python threshold.py) ────────────────────────────
    uint256 public FREEZE_THRESHOLD_ETH = 26 ether;
    uint256 public BLOCK_THRESHOLD_ETH  = 50 ether;

    // ── Phase 3: AI Model Hash ─────────────────────────────────────────────────
    bytes32 public modelHash;           // sha256 of fraud_model.pkl
    uint256 public modelDeployedAt;
    string  public modelVersion;

    event ModelHashRegistered(
        bytes32 indexed hash,
        string  version,
        uint256 timestamp
    );

    function registerModelHash(bytes32 hash, string memory version)
        public onlyOwner
    {
        modelHash        = hash;
        modelDeployedAt  = block.timestamp;
        modelVersion     = version;
        emit ModelHashRegistered(hash, version, block.timestamp);
    }

    function verifyModelHash(bytes32 currentHash) public view returns (bool) {
        return modelHash == currentHash && modelHash != bytes32(0);
    }

    // ── Phase 2: Wallet Threshold History ─────────────────────────────────────
    struct ThresholdRecord {
        uint256 threshold;      // 0–10000 (70% = 7000)
        uint256 fraudScore;     // 0–10000
        uint256 txCount;        // wallet's transaction count at this point
        uint256 amountWei;      // transaction amount
        uint256 timestamp;
        bytes32 prevHash;       // links to previous record — forms mini chain
    }

    // wallet address → list of threshold records
    mapping(address => ThresholdRecord[]) public thresholdHistory;
    mapping(address => uint256)           public walletTxCount;
    mapping(address => uint256)           public walletLastThreshold;

    event ThresholdUpdated(
        address indexed wallet,
        uint256 threshold,
        uint256 fraudScore,
        uint256 txCount,
        uint256 timestamp
    );

    /**
     * Called by Flask after every transaction.
     * Stores threshold evolution on-chain — tamper-proof.
     */
    function updateWalletThreshold(
        address wallet,
        uint256 threshold,
        uint256 fraudScore,
        uint256 amountWei
    ) public onlyOwner {
        walletTxCount[wallet]++;
        walletLastThreshold[wallet] = threshold;

        // Compute prev hash for chain linkage
        bytes32 prevHash = bytes32(0);
        uint256 histLen  = thresholdHistory[wallet].length;
        if (histLen > 0) {
            ThresholdRecord memory prev = thresholdHistory[wallet][histLen - 1];
            prevHash = keccak256(abi.encodePacked(
                prev.threshold, prev.fraudScore, prev.timestamp
            ));
        }

        thresholdHistory[wallet].push(ThresholdRecord({
            threshold : threshold,
            fraudScore: fraudScore,
            txCount   : walletTxCount[wallet],
            amountWei : amountWei,
            timestamp : block.timestamp,
            prevHash  : prevHash
        }));

        emit ThresholdUpdated(
            wallet, threshold, fraudScore,
            walletTxCount[wallet], block.timestamp
        );
    }

    function getThresholdHistory(address wallet)
        public view returns (ThresholdRecord[] memory)
    {
        return thresholdHistory[wallet];
    }

    function getThresholdCount(address wallet) public view returns (uint256) {
        return thresholdHistory[wallet].length;
    }

    // ── Phase 1: Transaction Logging (existing + enhanced) ───────────────────
    struct TransactionRecord {
        string  txHash;
        address sender;
        address receiver;
        uint256 amountWei;
        uint256 fraudScore;     // 0–10000
        uint256 threshold;      // 0–10000
        string  decision;
        string  action;
        uint256 timestamp;
        bool    exists;
    }

    mapping(string  => TransactionRecord) public records;
    mapping(address => bool)              public blacklisted;
    string[]                              public txHashes;

    event TransactionLogged(
        string  indexed txHash,
        address indexed sender,
        string  decision,
        string  action,
        uint256 fraudScore,
        uint256 threshold,
        uint256 timestamp
    );
    event WalletBlacklisted(address indexed wallet, uint256 timestamp);
    event AlertTriggered(address indexed sender, string message, uint256 timestamp);

    function logTransaction(
        string  memory txHash,
        address sender,
        address receiver,
        uint256 amountWei,
        uint256 fraudScore,
        uint256 threshold,
        string  memory decision,
        string  memory action
    ) public onlyOwner {
        require(!records[txHash].exists, "Already logged");

        records[txHash] = TransactionRecord({
            txHash    : txHash,
            sender    : sender,
            receiver  : receiver,
            amountWei : amountWei,
            fraudScore: fraudScore,
            threshold : threshold,
            decision  : decision,
            action    : action,
            timestamp : block.timestamp,
            exists    : true
        });
        txHashes.push(txHash);

        emit TransactionLogged(
            txHash, sender, decision, action,
            fraudScore, threshold, block.timestamp
        );

        // Auto-blacklist
        if (keccak256(bytes(action)) == keccak256(bytes("BLOCK_AND_BLACKLIST"))) {
            _blacklist(sender);
            emit AlertTriggered(sender, "Auto-blacklisted: high fraud score", block.timestamp);
        }

        // Alert for any block
        if (keccak256(bytes(action)) == keccak256(bytes("BLOCK")) ||
            keccak256(bytes(action)) == keccak256(bytes("BLOCK_AND_BLACKLIST")) ||
            keccak256(bytes(action)) == keccak256(bytes("FREEZE"))) {
            emit AlertTriggered(sender, action, block.timestamp);
        }

        // Update threshold history in same call
        updateWalletThreshold(sender, threshold, fraudScore, amountWei);
    }

    // ── Blacklist ─────────────────────────────────────────────────────────────
    function _blacklist(address wallet) internal {
        if (!blacklisted[wallet]) {
            blacklisted[wallet] = true;
            emit WalletBlacklisted(wallet, block.timestamp);
        }
    }
    function manualBlacklist(address wallet)  public onlyOwner { _blacklist(wallet); }
    function removeBlacklist(address wallet)  public onlyOwner { blacklisted[wallet] = false; }
    function isBlacklisted(address wallet)    public view returns (bool) { return blacklisted[wallet]; }
    function getTotalTransactions()           public view returns (uint256) { return txHashes.length; }
    function getTransaction(string memory h)  public view returns (TransactionRecord memory) { return records[h]; }
}
