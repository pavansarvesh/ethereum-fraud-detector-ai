import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from "recharts";

const API = "http://127.0.0.1:5000";

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  cyan   : "#00e5ff",
  green  : "#00e676",
  red    : "#ff1744",
  yellow : "#ffd600",
  purple : "#d500f9",
  bg     : "#050810",
  card   : "#0a0f1e",
  border : "#1a2440",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt    = (n) => parseFloat(n || 0).toFixed(4);
const pct    = (n) => `${(parseFloat(n || 0) * 100).toFixed(1)}%`;
const short  = (s = "") => s.length > 12 ? `${s.slice(0,6)}...${s.slice(-4)}` : s;
const clr    = (d) => d === "FRAUDULENT" ? C.red : C.green;
const riskClr= (r) =>
  r === "high" ? C.red : r === "medium" ? C.yellow : C.green;


// ════════════════════════════════════════════════════════════════════════════════
export default function Dashboard() {

  // ── Wallet state ─────────────────────────────────────────────────────────────
  const [wallet,    setWallet   ] = useState("");
  const [balance,   setBalance  ] = useState("0.0000");
  const [network,   setNetwork  ] = useState("");

  // ── Transaction form ──────────────────────────────────────────────────────────
  const [recipient, setRecipient] = useState("");
  const [amount,    setAmount   ] = useState("");
  const [sending,   setSending  ] = useState(false);

  // ── Analytics state ───────────────────────────────────────────────────────────
  const [stats,     setStats    ] = useState(null);
  const [txList,    setTxList   ] = useState([]);
  const [blockInfo, setBlockInfo] = useState(null);
  const [lastResult,setLastResult]= useState(null);
  const [alerts,    setAlerts   ] = useState([]);
  const [tab,       setTab      ] = useState("overview");

  // ── Chart data derived from txList ────────────────────────────────────────────
  const pieData = stats ? [
    { name: "Safe",       value: stats.total_transactions - stats.fraud_detected },
    { name: "Fraudulent", value: stats.fraud_detected },
  ] : [];

  const barData = txList.slice(0, 10).reverse().map((tx, i) => ({
    name  : `TX${i + 1}`,
    fraud : parseFloat((tx.fraud_probability * 100).toFixed(1)),
    thresh: parseFloat((tx.threshold * 100).toFixed(1)),
  }));

  const areaData = txList.slice(0, 20).reverse().map((tx, i) => ({
    name  : `#${i + 1}`,
    amount: parseFloat(tx.amount),
    score : parseFloat((tx.fraud_probability * 100).toFixed(1)),
  }));

  // ── Fetch dashboard data ──────────────────────────────────────────────────────
  const fetchDashboard = useCallback(async () => {
    try {
      const [sRes, tRes, bRes] = await Promise.all([
        fetch(`${API}/dashboard/stats`),
        fetch(`${API}/transactions?limit=20`),
        fetch(`${API}/blockchain/info`),
      ]);
      const [s, t, b] = await Promise.all([sRes.json(), tRes.json(), bRes.json()]);
      setStats(s);
      setTxList(t);
      setBlockInfo(b);
    } catch (_) {
      // Backend not running — use mock data for UI demo
      setStats({
        total_transactions  : 142,
        fraud_detected      : 17,
        transactions_blocked: 15,
        active_wallets      : 38,
        avg_fraud_score     : 34.2,
      });
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const id = setInterval(fetchDashboard, 8000);
    return () => clearInterval(id);
  }, [fetchDashboard]);

  // ── MetaMask connect ──────────────────────────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) { alert("Install MetaMask first."); return; }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const net      = await provider.getNetwork();
      const bal      = await provider.getBalance(accounts[0]);
      setWallet(accounts[0]);
      setBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
      setNetwork(net.name);
    } catch (e) { console.error(e); }
  };

  // ── Send / Analyze transaction ────────────────────────────────────────────────
  const analyzeTransaction = async () => {
    if (!recipient || !amount) { alert("Fill recipient and amount."); return; }
    setSending(true);
    try {
      const res = await fetch(`${API}/analyze_transaction`, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({
          sender  : wallet  || "0xDemoSender0000000000000000000000000000",
          receiver: recipient,
          amount  : parseFloat(amount),
          tx_hash : `TX-${Date.now()}`,
        }),
      });
      const data = await res.json();
      setLastResult(data);

      // Add alert if blocked
      if (data.action?.startsWith("BLOCK")) {
        setAlerts(prev => [{
          text: `⚠ ${data.action}: ${short(data.sender)} — Score ${pct(data.fraud_probability)}`,
          time: new Date().toLocaleTimeString(),
          type: "danger",
        }, ...prev.slice(0, 9)]);
      }
      await fetchDashboard();
    } catch (e) {
      alert("Backend not reachable. Start Flask with: python app.py");
    } finally {
      setSending(false);
    }
  };

  // ═══════════════════════════════════ RENDER ══════════════════════════════════
  return (
    <div style={{
      minHeight: "100vh", background: C.bg, color: "#e8eaf6",
      fontFamily: "'JetBrains Mono', 'Courier New', monospace",
      padding: "0",
    }}>

      {/* ── TOP NAV ── */}
      <nav style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 60,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22, color: C.cyan }}>⬡</span>
          <span style={{ color: C.cyan, fontWeight: 700, fontSize: 16, letterSpacing: 2 }}>
            ETH FRAUD SHIELD
          </span>
          {blockInfo?.connected && (
            <span style={{
              background: "#00e67622", color: C.green,
              padding: "2px 10px", borderRadius: 20, fontSize: 11,
            }}>● BLOCKCHAIN LIVE</span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {wallet ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                background: "#00e5ff11", border: `1px solid ${C.cyan}`,
                padding: "4px 14px", borderRadius: 20, fontSize: 12, color: C.cyan,
              }}>
                {short(wallet)} | {balance} ETH | {network}
              </span>
            </div>
          ) : (
            <button onClick={connectWallet} style={btnStyle(C.purple)}>
              Connect MetaMask
            </button>
          )}
        </div>
      </nav>

      {/* ── TABS ── */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", display: "flex", gap: 0,
      }}>
        {["overview", "analyze", "blockchain", "alerts"].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "14px 24px", fontSize: 12, letterSpacing: 1,
            color      : tab === t ? C.cyan : "#666",
            borderBottom: tab === t ? `2px solid ${C.cyan}` : "2px solid transparent",
            textTransform: "uppercase",
          }}>{t}</button>
        ))}
      </div>

      <div style={{ padding: 24, maxWidth: 1400, margin: "0 auto" }}>

        {/* ══════════════════ OVERVIEW TAB ══════════════════ */}
        {tab === "overview" && (
          <>
            {/* KPI Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginBottom: 24 }}>
              {[
                { label: "Total Transactions",   value: stats?.total_transactions   ?? "—" },
                { label: "Fraud Detected",       value: stats?.fraud_detected       ?? "—", color: C.red    },
                { label: "Transactions Blocked", value: stats?.transactions_blocked ?? "—", color: C.red    },
                { label: "Active Wallets",       value: stats?.active_wallets       ?? "—", color: C.yellow },
                { label: "Avg Fraud Score",      value: stats ? `${stats.avg_fraud_score}%` : "—", color: C.cyan },
              ].map(({ label, value, color }) => (
                <KPICard key={label} label={label} value={value} color={color} />
              ))}
            </div>

            {/* Charts Row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 24 }}>
              {/* Pie */}
              <ChartCard title="Fraud Distribution">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={80}
                         dataKey="value" label={({ name, percent }) =>
                           `${name} ${(percent * 100).toFixed(0)}%`}>
                      <Cell fill={C.green} />
                      <Cell fill={C.red} />
                    </Pie>
                    <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}` }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Bar */}
              <ChartCard title="Fraud Score vs Threshold (Last 10)">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barData}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#666" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#666" }} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}` }} />
                    <Bar dataKey="fraud"  fill={C.red}    name="Fraud Score %" />
                    <Bar dataKey="thresh" fill={C.yellow} name="Threshold %" />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              {/* Area */}
              <ChartCard title="Transaction Amount Trend">
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={areaData}>
                    <defs>
                      <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={C.cyan} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={C.cyan} stopOpacity={0}   />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#666" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#666" }} />
                    <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.border}` }} />
                    <Area type="monotone" dataKey="amount" stroke={C.cyan}
                          fill="url(#cg)" name="Amount (ETH)" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Recent Transactions Table */}
            <ChartCard title="Recent Transactions">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}`, color: "#666" }}>
                      {["TX Hash","Sender","Receiver","Amount","Fraud Score","Threshold","Risk","Decision","Action","Block#"].map(h => (
                        <th key={h} style={{ padding: "8px 12px", textAlign: "left", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {txList.length === 0 ? (
                      <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: "#444" }}>
                        No transactions yet. Use the Analyze tab to test.
                      </td></tr>
                    ) : txList.map((tx, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${C.border}22` }}>
                        <td style={tdStyle}>{short(tx.tx_hash)}</td>
                        <td style={tdStyle}>{short(tx.sender)}</td>
                        <td style={tdStyle}>{short(tx.receiver)}</td>
                        <td style={{ ...tdStyle, color: C.cyan }}>{fmt(tx.amount)} ETH</td>
                        <td style={{ ...tdStyle, color: parseFloat(tx.fraud_probability) > parseFloat(tx.threshold) ? C.red : C.green }}>
                          {pct(tx.fraud_probability)}
                        </td>
                        <td style={tdStyle}>{pct(tx.threshold)}</td>
                        <td style={{ ...tdStyle, color: riskClr(tx.risk_level) }}>{tx.risk_level?.toUpperCase()}</td>
                        <td style={{ ...tdStyle, color: clr(tx.decision) }}>{tx.decision}</td>
                        <td style={tdStyle}><Badge action={tx.action} /></td>
                        <td style={{ ...tdStyle, color: "#666" }}>{tx.block_number || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          </>
        )}

        {/* ══════════════════ ANALYZE TAB ══════════════════ */}
        {tab === "analyze" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>

            {/* Transaction Form */}
            <ChartCard title="New Transaction">
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <Field label="Sender Wallet" value={wallet || "Connect MetaMask above"} disabled />
                <Field label="Recipient Address" value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  placeholder="0x..." />
                <Field label="Amount (ETH)" value={amount} type="number"
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00" />

                <button onClick={analyzeTransaction} disabled={sending}
                  style={btnStyle(sending ? "#333" : C.cyan, { width: "100%", padding: 14, fontSize: 14 })}>
                  {sending ? "Analyzing..." : "Analyze & Send Transaction"}
                </button>
              </div>
            </ChartCard>

            {/* Result Panel */}
            {lastResult && (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Decision Banner */}
                <div style={{
                  background : lastResult.action?.startsWith("BLOCK") ? "#ff174422" : "#00e67622",
                  border     : `1px solid ${lastResult.action?.startsWith("BLOCK") ? C.red : C.green}`,
                  borderRadius: 12, padding: 20, textAlign: "center",
                }}>
                  <div style={{ fontSize: 28, fontWeight: 700,
                    color: lastResult.action?.startsWith("BLOCK") ? C.red : C.green }}>
                    {lastResult.action?.startsWith("BLOCK") ? "🚫 BLOCKED" : "✅ APPROVED"}
                  </div>
                  <div style={{ fontSize: 13, color: "#aaa", marginTop: 6 }}>
                    {lastResult.action}
                  </div>
                </div>

                <ChartCard title="AI Analysis">
                  <InfoRow label="Fraud Probability" value={pct(lastResult.fraud_probability)}
                    valueColor={parseFloat(lastResult.fraud_probability) > 0.7 ? C.red : C.green} />
                  <InfoRow label="Normal Probability" value={pct(lastResult.normal_probability)} valueColor={C.green} />
                  <InfoRow label="Dynamic Threshold"  value={pct(lastResult.threshold)} valueColor={C.yellow} />
                  <InfoRow label="Risk Level"         value={lastResult.risk_level?.toUpperCase()} valueColor={riskClr(lastResult.risk_level)} />
                  <InfoRow label="Model Used"         value={lastResult.model_used} />
                  <InfoRow label="Avg Sender Amount"  value={`${fmt(lastResult.avg_sender_amount)} ETH`} />
                  <InfoRow label="Amount Deviation"   value={`${fmt(lastResult.amount_deviation)}σ`} />
                  <div style={{ marginTop: 10, padding: 10,
                    background: "#ffffff08", borderRadius: 8, fontSize: 11, color: "#888" }}>
                    {lastResult.threshold_reason}
                  </div>
                </ChartCard>

                <ChartCard title="Blockchain Record">
                  <InfoRow label="TX Hash"      value={short(lastResult.tx_hash)} />
                  <InfoRow label="Block Number" value={lastResult.block_number || "Pending"} />
                  <InfoRow label="On-chain Hash" value={short(lastResult.blockchain_hash)} valueColor={C.cyan} />
                  <InfoRow label="Simulated"    value={lastResult.blockchain_simulated ? "Yes (Ganache offline)" : "No — Real chain"} />
                </ChartCard>
              </div>
            )}

            {!lastResult && (
              <ChartCard title="Analysis Result">
                <div style={{ padding: 40, textAlign: "center", color: "#444" }}>
                  Submit a transaction to see AI analysis here
                </div>
              </ChartCard>
            )}
          </div>
        )}

        {/* ══════════════════ BLOCKCHAIN TAB ══════════════════ */}
        {tab === "blockchain" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <ChartCard title="Blockchain Status">
              {blockInfo ? (
                <>
                  <InfoRow label="Connected"        value={blockInfo.connected ? "YES" : "NO"} valueColor={blockInfo.connected ? C.green : C.red} />
                  <InfoRow label="RPC Endpoint"     value={blockInfo.rpc || "N/A"} />
                  <InfoRow label="Latest Block"     value={blockInfo.block_number || "—"} valueColor={C.cyan} />
                  <InfoRow label="Block Hash"       value={short(blockInfo.block_hash)} valueColor={C.cyan} />
                  <InfoRow label="Gas Limit"        value={blockInfo.gas_limit?.toLocaleString() || "—"} />
                  <InfoRow label="Contract Address" value={short(blockInfo.contract_address)} valueColor={C.purple} />
                  <InfoRow label="On-chain TX Count" value={blockInfo.total_on_chain_tx ?? "—"} valueColor={C.yellow} />
                </>
              ) : (
                <div style={{ color: "#666", padding: 20 }}>Start Flask backend to see live data</div>
              )}
            </ChartCard>

            <ChartCard title="Smart Contract Events">
              {txList.filter(tx => tx.action?.startsWith("BLOCK")).length === 0 ? (
                <div style={{ color: "#444", padding: 20 }}>No contract events yet</div>
              ) : txList.filter(tx => tx.action?.startsWith("BLOCK")).slice(0, 8).map((tx, i) => (
                <div key={i} style={{
                  background: "#ff174411", border: `1px solid ${C.red}33`,
                  borderRadius: 8, padding: 12, marginBottom: 8, fontSize: 12,
                }}>
                  <div style={{ color: C.red, fontWeight: 700 }}>{tx.action}</div>
                  <div style={{ color: "#888", marginTop: 4 }}>
                    Sender: {short(tx.sender)} | Score: {pct(tx.fraud_probability)} | Block #{tx.block_number || "—"}
                  </div>
                </div>
              ))}
            </ChartCard>
          </div>
        )}

        {/* ══════════════════ ALERTS TAB ══════════════════ */}
        {tab === "alerts" && (
          <ChartCard title="Real-Time Fraud Alerts">
            {alerts.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#444" }}>
                No alerts yet. Fraudulent transactions will appear here automatically.
              </div>
            ) : alerts.map((a, i) => (
              <div key={i} style={{
                background: "#ff174411", border: `1px solid ${C.red}44`,
                borderRadius: 10, padding: "12px 16px", marginBottom: 10,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ color: "#ffcccc", fontSize: 13 }}>{a.text}</span>
                <span style={{ color: "#666", fontSize: 11 }}>{a.time}</span>
              </div>
            ))}
          </ChartCard>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function KPICard({ label, value, color = C.cyan }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "18px 20px",
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 8, letterSpacing: 1 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: 20,
    }}>
      <div style={{ fontSize: 13, color: C.cyan, fontWeight: 600,
        letterSpacing: 1, marginBottom: 16, borderBottom: `1px solid ${C.border}`, paddingBottom: 10 }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, valueColor = "#e8eaf6" }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      padding: "8px 0", borderBottom: `1px solid ${C.border}22`,
      fontSize: 12,
    }}>
      <span style={{ color: "#666" }}>{label}</span>
      <span style={{ color: valueColor, fontWeight: 600 }}>{value}</span>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, disabled, type = "text" }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 6, letterSpacing: 1 }}>{label.toUpperCase()}</div>
      <input
        type={type} value={value} onChange={onChange}
        placeholder={placeholder} disabled={disabled}
        style={{
          width: "100%", background: "#0a0f1e",
          border: `1px solid ${C.border}`, borderRadius: 8,
          padding: "10px 14px", color: disabled ? "#666" : "#e8eaf6",
          fontSize: 13, outline: "none", boxSizing: "border-box",
        }}
      />
    </div>
  );
}

function Badge({ action }) {
  const color = action?.startsWith("BLOCK") ? C.red
    : action === "APPROVE_WITH_WARNING"      ? C.yellow
    : C.green;
  return (
    <span style={{
      background: `${color}22`, color, padding: "2px 8px",
      borderRadius: 10, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
    }}>{action}</span>
  );
}

const tdStyle = { padding: "10px 12px", whiteSpace: "nowrap" };

const btnStyle = (bg, extra = {}) => ({
  background: `${bg}22`, color: bg,
  border: `1px solid ${bg}`, borderRadius: 8,
  padding: "8px 18px", cursor: "pointer", fontSize: 12,
  fontFamily: "inherit", letterSpacing: 1, ...extra,
});
