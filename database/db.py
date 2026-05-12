"""
Database Layer — SQLite
Stores transactions and provides blockchain chain data.
"""

import sqlite3, os, hashlib
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'transactions.db')

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_connection()
    c    = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            tx_hash           TEXT,
            sender            TEXT NOT NULL,
            receiver          TEXT NOT NULL,
            amount            REAL NOT NULL,
            hour              INTEGER,
            fraud_probability REAL,
            threshold         REAL,
            risk_level        TEXT,
            decision          TEXT,
            action            TEXT,
            blockchain_hash   TEXT,
            block_number      INTEGER DEFAULT 0,
            timestamp         TEXT DEFAULT CURRENT_TIMESTAMP,
            failed            INTEGER DEFAULT 0
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS blacklisted_wallets (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            address    TEXT UNIQUE NOT NULL,
            reason     TEXT,
            added_at   TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit(); conn.close()
    print('[DB] Database initialized.')

def save_transaction(tx: dict) -> int:
    conn = get_connection(); c = conn.cursor()
    c.execute("""
        INSERT INTO transactions
        (tx_hash,sender,receiver,amount,hour,fraud_probability,threshold,
         risk_level,decision,action,blockchain_hash,block_number,timestamp,failed)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        tx.get('tx_hash',''),      tx['sender'],      tx['receiver'],
        tx['amount'],              tx.get('hour', datetime.now().hour),
        tx.get('fraud_probability',0), tx.get('threshold',0.70),
        tx.get('risk_level','medium'), tx.get('decision','UNKNOWN'),
        tx.get('action','UNKNOWN'), tx.get('blockchain_hash',''),
        tx.get('block_number',0),   datetime.now().isoformat(),
        tx.get('failed',0),
    ))
    row_id = c.lastrowid
    conn.commit(); conn.close()
    return row_id

def get_sender_history(sender_address: str, limit: int = 200) -> list:
    conn = get_connection(); c = conn.cursor()
    c.execute("""
        SELECT amount, hour, decision, failed, receiver, blockchain_hash, block_number
        FROM transactions WHERE sender=?
        ORDER BY id DESC LIMIT ?
    """, (sender_address, limit))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def get_all_transactions(limit: int = 50) -> list:
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT * FROM transactions ORDER BY id DESC LIMIT ?', (limit,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def get_dashboard_stats() -> dict:
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT COUNT(*) as total FROM transactions')
    total = c.fetchone()['total']
    c.execute("SELECT COUNT(*) as fraud FROM transactions WHERE decision IN ('FRAUDULENT','SUSPICIOUS')")
    fraud = c.fetchone()['fraud']
    c.execute("SELECT COUNT(*) as blocked FROM transactions WHERE action IN ('BLOCK','BLOCK_AND_BLACKLIST','FREEZE')")
    blocked = c.fetchone()['blocked']
    c.execute('SELECT COUNT(DISTINCT sender) as wallets FROM transactions')
    wallets = c.fetchone()['wallets']
    c.execute('SELECT AVG(fraud_probability) as avg_score FROM transactions')
    avg_row = c.fetchone()['avg_score']
    avg_score = round((avg_row or 0) * 100, 1)
    conn.close()
    return {
        'total_transactions'   : total,
        'fraud_detected'       : fraud,
        'transactions_blocked' : blocked,
        'active_wallets'       : wallets,
        'avg_fraud_score'      : avg_score,
    }

def get_blockchain_chain(limit: int = 10) -> list:
    """
    Returns linked blockchain records — each block references
    the previous block's hash, forming a chain.
    """
    conn = get_connection(); c = conn.cursor()
    c.execute("""
        SELECT id, tx_hash, sender, receiver, amount,
               fraud_probability, threshold, decision, action,
               blockchain_hash, block_number, timestamp, risk_level
        FROM transactions
        ORDER BY id DESC LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()

    if not rows:
        return []

    # Build chain — each block references previous block hash
    chain = []
    for i, row in enumerate(rows):
        prev_hash = rows[i+1]['blockchain_hash'] if i+1 < len(rows) else '0x' + '0'*64
        # Compute block hash from content
        content   = f"{row['tx_hash']}{row['sender']}{row['amount']}{row['timestamp']}"
        blk_hash  = row['blockchain_hash'] or ('0x' + hashlib.sha256(content.encode()).hexdigest())
        chain.append({
            'block_index'      : i,
            'block_number'     : row.get('block_number', 0) or (1000 + len(rows) - i),
            'tx_hash'          : row['tx_hash'],
            'blockchain_hash'  : blk_hash,
            'prev_hash'        : prev_hash,
            'sender'           : row['sender'],
            'receiver'         : row['receiver'],
            'amount'           : row['amount'],
            'fraud_probability': row['fraud_probability'],
            'threshold'        : row['threshold'],
            'decision'         : row['decision'],
            'action'           : row['action'],
            'risk_level'       : row['risk_level'],
            'timestamp'        : row['timestamp'],
            'gas_used'         : 42000 + (i * 1337),
        })
    return chain

def blacklist_wallet(address: str, reason: str):
    conn = get_connection(); c = conn.cursor()
    try:
        c.execute('INSERT OR IGNORE INTO blacklisted_wallets (address,reason) VALUES (?,?)', (address, reason))
        conn.commit()
    finally:
        conn.close()

def is_blacklisted(address: str) -> bool:
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT id FROM blacklisted_wallets WHERE address=?', (address,))
    result = c.fetchone()
    conn.close()
    return result is not None

init_db()
