"""
Database Layer — SQLite
Stores transactions, alerts, smart contract events, blacklisted wallets.
All data persists across Flask restarts.
"""

import sqlite3, os, hashlib
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), 'transactions.db')

def get_connection():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
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
            failed            INTEGER DEFAULT 0,
            gas_used          INTEGER DEFAULT 0
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

    # Persistent alerts table
    c.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            text      TEXT NOT NULL,
            type      TEXT DEFAULT 'danger',
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Persistent smart contract events table
    c.execute("""
        CREATE TABLE IF NOT EXISTS sc_events (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            fn        TEXT,
            sender    TEXT,
            receiver  TEXT,
            score     TEXT,
            threshold TEXT,
            tx_hash   TEXT,
            block_num TEXT,
            amount    TEXT,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # Migration: add gas_used column for existing databases
    try:
        c.execute("ALTER TABLE transactions ADD COLUMN gas_used INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass  # Column already exists

    conn.commit()
    conn.close()
    print('[DB] Database initialized.')


# ── Transactions ──────────────────────────────────────────────────────────────
def save_transaction(tx: dict) -> int:
    conn = get_connection(); c = conn.cursor()
    c.execute("""
        INSERT INTO transactions
        (tx_hash,sender,receiver,amount,hour,fraud_probability,threshold,
         risk_level,decision,action,blockchain_hash,block_number,timestamp,failed,gas_used)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        tx.get('tx_hash',''),      tx['sender'],      tx['receiver'],
        tx['amount'],              tx.get('hour', datetime.now().hour),
        tx.get('fraud_probability',0), tx.get('threshold',0.70),
        tx.get('risk_level','medium'), tx.get('decision','UNKNOWN'),
        tx.get('action','UNKNOWN'), tx.get('blockchain_hash',''),
        tx.get('block_number',0),   datetime.now().isoformat(),
        tx.get('failed',0),        tx.get('gas_used',0),
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
    # Gas analytics
    c.execute('SELECT COUNT(*) as total_alerts FROM alerts')
    total_alerts = c.fetchone()['total_alerts']
    conn.close()
    return {
        'total_transactions'   : total,
        'fraud_detected'       : fraud,
        'transactions_blocked' : blocked,
        'active_wallets'       : wallets,
        'avg_fraud_score'      : avg_score,
        'total_alerts'         : total_alerts,
    }

def get_blockchain_chain(limit: int = 10) -> list:
    conn = get_connection(); c = conn.cursor()
    c.execute("""
        SELECT id, tx_hash, sender, receiver, amount, gas_used,
               fraud_probability, threshold, decision, action,
               blockchain_hash, block_number, timestamp, risk_level
        FROM transactions ORDER BY id DESC LIMIT ?
    """, (limit,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    if not rows: return []
    chain = []
    for i, row in enumerate(rows):
        prev_hash = rows[i+1]['blockchain_hash'] if i+1 < len(rows) else '0x' + '0'*64
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
            'gas_used'         : row.get('gas_used', 0) or 42000,
        })
    return chain

# ── Alerts (persistent) ───────────────────────────────────────────────────────
def save_alert(text: str, alert_type: str = 'danger'):
    conn = get_connection(); c = conn.cursor()
    c.execute('INSERT INTO alerts (text, type, timestamp) VALUES (?,?,?)',
              (text, alert_type, datetime.now().isoformat()))
    conn.commit(); conn.close()

def get_alerts(limit: int = 50) -> list:
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT * FROM alerts ORDER BY id DESC LIMIT ?', (limit,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def clear_alerts():
    conn = get_connection()
    conn.execute('DELETE FROM alerts')
    conn.commit(); conn.close()

# ── Smart Contract Events (persistent) ───────────────────────────────────────
def save_sc_event(event: dict):
    conn = get_connection(); c = conn.cursor()
    c.execute("""
        INSERT INTO sc_events (fn,sender,receiver,score,threshold,tx_hash,block_num,amount,timestamp)
        VALUES (?,?,?,?,?,?,?,?,?)
    """, (
        event.get('fn',''), event.get('sender',''), event.get('recv',''),
        event.get('score',''), event.get('thresh',''), event.get('hash',''),
        str(event.get('block','')), str(event.get('amount','')),
        datetime.now().isoformat()
    ))
    conn.commit(); conn.close()

def get_sc_events(limit: int = 20) -> list:
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT * FROM sc_events ORDER BY id DESC LIMIT ?', (limit,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

# ── Blacklist ─────────────────────────────────────────────────────────────────
def blacklist_wallet(address: str, reason: str):
    conn = get_connection(); c = conn.cursor()
    try:
        c.execute('INSERT OR IGNORE INTO blacklisted_wallets (address,reason) VALUES (?,?)',
                  (address, reason))
        conn.commit()
    finally:
        conn.close()

def is_blacklisted(address: str) -> bool:
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT id FROM blacklisted_wallets WHERE address=?', (address,))
    result = c.fetchone()
    conn.close()
    return result is not None

def get_blacklisted_wallets() -> list:
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT * FROM blacklisted_wallets ORDER BY id DESC')
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

def remove_blacklist(address: str):
    conn = get_connection()
    conn.execute('DELETE FROM blacklisted_wallets WHERE address=?', (address,))
    conn.commit(); conn.close()

def get_receiver_history(receiver_address: str, limit: int = 200) -> list:
    """Get transactions where this address was the receiver."""
    conn = get_connection(); c = conn.cursor()
    c.execute("""
        SELECT amount, hour, decision, failed, sender, blockchain_hash, block_number
        FROM transactions WHERE receiver=?
        ORDER BY id DESC LIMIT ?
    """, (receiver_address, limit))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    return rows

# ── Gas Analytics ─────────────────────────────────────────────────────────────
def get_gas_analytics() -> dict:
    """Returns gas usage stats from real blockchain data."""
    conn = get_connection(); c = conn.cursor()
    c.execute('SELECT COUNT(*) as total FROM transactions')
    total = c.fetchone()['total']
    c.execute('SELECT COALESCE(SUM(gas_used),0) as tg FROM transactions')
    real_total = c.fetchone()['tg']
    c.execute("""
        SELECT action, COUNT(*) as cnt, COALESCE(SUM(gas_used),0) as ag,
               COALESCE(AVG(NULLIF(gas_used,0)),0) as avg_g
        FROM transactions GROUP BY action
    """)
    rows = c.fetchall()
    conn.close()

    gas_est = {'APPROVE':21000,'APPROVE_WITH_WARNING':25000,
               'FREEZE':42000,'BLOCK':63000,'BLOCK_AND_BLACKLIST':84000}
    breakdown = []
    computed_total = 0
    for r in rows:
        a, cnt, ag = r['action'], r['cnt'], r['ag']
        action_gas = ag if ag > 0 else gas_est.get(a, 21000) * cnt
        avg_each = int(action_gas / cnt) if cnt else 0
        computed_total += action_gas
        breakdown.append({'action':a,'count':cnt,'gas_each':avg_each,'total_gas':action_gas})

    final = real_total if real_total > 0 else computed_total
    return {
        'total_gas_used' : final,
        'avg_gas_per_tx' : final // total if total > 0 else 0,
        'breakdown'      : breakdown,
        'total_tx'       : total,
    }

init_db()
