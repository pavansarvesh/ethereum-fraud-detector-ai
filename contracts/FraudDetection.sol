// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * STEP 6 — Smart Contract
 * FraudDetection.sol
 *
 * Deployed on Ganache / Sepolia testnet.
 * Receives AI fraud decision, stores it on-chain,
 * and emits events for frontend monitoring.
 */

contract FraudDetection {

    // ── Owner ────────────────────────────────────────────────────────────────
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ── Data Structures ──────────────────────────────────────────────────────
    struct TransactionRecord {
        string  txHash;
        address sender;
        address receiver;
        uint256 amountWei;        // amount in wei (18 decimals)
        uint256 fraudScore;       // 0–10000  (e.g. 9100 = 91.00%)
        uint256 threshold;        // 0–10000
        string  decision;         // "SAFE" | "FRAUDULENT"
        string  action;           // "APPROVE" | "BLOCK" | "BLOCK_AND_BLACKLIST"
        uint256 timestamp;
        bool    exists;
    }

    // ── Storage ──────────────────────────────────────────────────────────────
    mapping(string => TransactionRecord) public records;        // txHash → record
    mapping(address => bool)             public blacklisted;    // blocked wallets
    string[]                             public txHashes;       // ordered list

    // ── Events ───────────────────────────────────────────────────────────────
    event TransactionLogged(
        string  indexed txHash,
        address indexed sender,
        string  decision,
        string  action,
        uint256 fraudScore,
        uint256 timestamp
    );

    event WalletBlacklisted(
        address indexed wallet,
        uint256 timestamp
    );

    event AlertTriggered(
        address indexed sender,
        string  message,
        uint256 timestamp
    );

    // ── Core Function: Log AI Decision ───────────────────────────────────────
    /**
     * Called by Flask backend (via Web3.py) after AI analysis.
     *
     * @param txHash      Ethereum transaction hash
     * @param sender      Sender wallet address
     * @param receiver    Receiver wallet address
     * @param amountWei   Transfer amount in wei
     * @param fraudScore  AI fraud probability * 10000 (e.g. 9100 for 91%)
     * @param threshold   Dynamic threshold * 10000
     * @param decision    "SAFE" or "FRAUDULENT"
     * @param action      "APPROVE", "BLOCK", "BLOCK_AND_BLACKLIST"
     */
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

        require(!records[txHash].exists, "Transaction already logged");

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
            txHash,
            sender,
            decision,
            action,
            fraudScore,
            block.timestamp
        );

        // ── Auto-blacklist if required ────────────────────────────────────
        if (keccak256(bytes(action)) == keccak256(bytes("BLOCK_AND_BLACKLIST"))) {
            _blacklistWallet(sender);
            emit AlertTriggered(
                sender,
                "Wallet automatically blacklisted due to high fraud score",
                block.timestamp
            );
        }

        // ── Emit general alert for any block action ───────────────────────
        if (keccak256(bytes(action)) == keccak256(bytes("BLOCK")) ||
            keccak256(bytes(action)) == keccak256(bytes("BLOCK_AND_BLACKLIST"))) {
            emit AlertTriggered(
                sender,
                "Transaction blocked by smart contract",
                block.timestamp
            );
        }
    }

    // ── Blacklist Management ─────────────────────────────────────────────────
    function _blacklistWallet(address wallet) internal {
        if (!blacklisted[wallet]) {
            blacklisted[wallet] = true;
            emit WalletBlacklisted(wallet, block.timestamp);
        }
    }

    function manualBlacklist(address wallet) public onlyOwner {
        _blacklistWallet(wallet);
    }

    function removeBlacklist(address wallet) public onlyOwner {
        blacklisted[wallet] = false;
    }

    // ── View Functions ───────────────────────────────────────────────────────
    function getTransaction(string memory txHash)
        public view returns (TransactionRecord memory)
    {
        return records[txHash];
    }

    function getTotalTransactions() public view returns (uint256) {
        return txHashes.length;
    }

    function isBlacklisted(address wallet) public view returns (bool) {
        return blacklisted[wallet];
    }
}
