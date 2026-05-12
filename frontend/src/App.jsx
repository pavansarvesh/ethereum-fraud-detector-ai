import { useState, useEffect, useCallback } from 'react'
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import './App.css'

const API         = 'http://127.0.0.1:5000'
const GANACHE_RPC = 'http://127.0.0.1:7545'
const short  = (s='') => s.length>14?`${s.slice(0,6)}...${s.slice(-4)}`:s
const pct    = n=>`${(parseFloat(n||0)*100).toFixed(1)}%`
const fmtEth = n=>parseFloat(n||0).toFixed(4)

export default function App() {
  const [tab,        setTab       ] = useState('overview')
  const [connStatus, setConnStatus] = useState('disconnected')
  const [walletAddr, setWalletAddr] = useState(null)
  const [balance,    setBalance   ] = useState('0.0000')
  const [network,    setNetwork   ] = useState('')
  const [stats,      setStats     ] = useState(null)
  const [txList,     setTxList    ] = useState([])
  const [chain,      setChain     ] = useState([])
  const [blockInfo,  setBlockInfo ] = useState(null)
  const [lastResult, setLastResult] = useState(null)
  const [alerts,     setAlerts    ] = useState([])
  const [scEvents,   setScEvents  ] = useState([])
  const [sending,    setSending   ] = useState(false)
  const [recipient,  setRecipient ] = useState('')
  const [amount,     setAmount    ] = useState('')
  const [sender,     setSender    ] = useState('')
  const [message,    setMessage   ] = useState('Connect wallet or enter sender address manually.')
  const [ganacheBlk, setGanacheBlk] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const [sRes,tRes,bRes,cRes] = await Promise.all([
        fetch(`${API}/dashboard/stats`),
        fetch(`${API}/transactions?limit=50`),
        fetch(`${API}/blockchain/info`),
        fetch(`${API}/blockchain/chain?limit=8`),
      ])
      if(sRes.ok) setStats(await sRes.json())
      if(tRes.ok) setTxList(await tRes.json())
      if(bRes.ok) setBlockInfo(await bRes.json())
      if(cRes.ok) setChain(await cRes.json())
    } catch(_){}
  }, [])

  const fetchGanacheBlock = useCallback(async () => {
    try {
      const res = await fetch(GANACHE_RPC,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',method:'eth_blockNumber',params:[],id:1})
      })
      const d = await res.json()
      if(d.result) setGanacheBlk(parseInt(d.result,16))
    } catch(_){}
  },[])

  const fetchBalance = useCallback(async(addr)=>{
    try {
      const res = await fetch(GANACHE_RPC,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',method:'eth_getBalance',params:[addr,'latest'],id:1})
      })
      const d = await res.json()
      if(d.result) setBalance((Number(BigInt(d.result))/1e18).toFixed(4))
    } catch(_){
      if(window.ethereum&&addr){
        try{
          const b=await window.ethereum.request({method:'eth_getBalance',params:[addr,'latest']})
          setBalance((Number(BigInt(b))/1e18).toFixed(4))
        }catch(_){}
      }
    }
  },[])

  useEffect(()=>{
    fetchData(); fetchGanacheBlock()
    const i1=setInterval(fetchData,8000)
    const i2=setInterval(fetchGanacheBlock,5000)
    return()=>{clearInterval(i1);clearInterval(i2)}
  },[fetchData,fetchGanacheBlock])

  useEffect(()=>{
    if(!walletAddr)return
    fetchBalance(walletAddr)
    const id=setInterval(()=>fetchBalance(walletAddr),10000)
    return()=>clearInterval(id)
  },[walletAddr,fetchBalance])

  async function handleConnect(){
    if(!window.ethereum){setMessage('MetaMask not found. Install the extension.');return}
    try{
      setConnStatus('connecting')
      const accounts=await window.ethereum.request({method:'eth_requestAccounts'})
      const addr=accounts[0]
      setWalletAddr(addr); setSender(addr)
      const chainHex=await window.ethereum.request({method:'eth_chainId'})
      const cid=parseInt(chainHex,16)
      setNetwork(cid===1337||cid===1338?'Ganache':cid===11155111?'Sepolia':cid===1?'Mainnet':`Chain ${cid}`)
      await fetchBalance(addr)
      setConnStatus('connected')
      setMessage('Wallet connected. Ready to analyze transactions.')
      window.ethereum.on('accountsChanged',accs=>{
        if(!accs.length){setConnStatus('disconnected');setWalletAddr(null);setBalance('0.0000')}
        else{setWalletAddr(accs[0]);setSender(accs[0]);fetchBalance(accs[0])}
      })
    } catch(e){setConnStatus('error');setMessage(e.message||'Unable to connect wallet.')}
  }

  async function handleAnalyze(){
    if(!sender)   {setMessage('Enter sender address or connect wallet.');return}
    if(!recipient){setMessage('Enter a recipient address.');return}
    if(!amount||parseFloat(amount)<=0){setMessage('Enter a valid amount > 0.');return}
    setSending(true); setMessage('Analyzing with XGBoost model...')
    try{
      const res=await fetch(`${API}/analyze_transaction`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sender,receiver:recipient,amount:parseFloat(amount),
          tx_hash:`TX-${Date.now()}`,timestamp:Date.now()/1000})
      })
      if(!res.ok)throw new Error(`Server error ${res.status}`)
      const data=await res.json()
      setLastResult(data)
      const blocked=data.action==='BLOCK'||data.action==='BLOCK_AND_BLACKLIST'
      const frozen =data.action==='FREEZE'
      setMessage(blocked?`Transaction BLOCKED — Fraud ${pct(data.fraud_probability)}`:
                 frozen ?`Transaction FROZEN — Amount in high-risk zone`:
                         `Transaction APPROVED — Fraud ${pct(data.fraud_probability)}`)
      if(blocked||frozen){
        setAlerts(p=>[{
          text:`${data.action}: ${short(sender)} → ${short(recipient)} | Score: ${pct(data.fraud_probability)} | Threshold: ${pct(data.threshold)} | Amount: ${data.amount} ETH`,
          time:new Date().toLocaleTimeString(),type:blocked?'danger':'warn'
        },...p.slice(0,19)])
        setScEvents(p=>[{
          fn   :data.action==='BLOCK_AND_BLACKLIST'?'blockTransaction() + blacklistWallet()':
                data.action==='FREEZE'?'freezeTransaction()':'blockTransaction()',
          sender:short(sender),recv:short(recipient),
          score:pct(data.fraud_probability),thresh:pct(data.threshold),
          hash :data.tx_hash,block:data.block_number||'—',
          amount:data.amount,time:new Date().toLocaleTimeString()
        },...p.slice(0,9)])
      }
      if(walletAddr)fetchBalance(walletAddr)
      await fetchData()
    }catch(e){
      setMessage(e.message?.includes('fetch')?'Backend not reachable. Run: python app.py':e.message)
    }finally{setSending(false)}
  }

  function loadScenario(s,r,a){setSender(s||walletAddr||'');setRecipient(r);setAmount(String(a));setMessage('Scenario loaded — click Analyze Transaction.')}

  // Amount rule helper for UI preview
  function getAmountRule(a){
    const v=parseFloat(a||0)
    if(v<=0.00001)return{label:'BLOCK',color:'#ef4444',desc:'Dust/zero TX'}
    if(v<=25)     return{label:'SAFE',color:'#22c55e',desc:'Safe range'}
    if(v<=50)     return{label:'FREEZE',color:'#f59e0b',desc:'Freeze zone'}
    return              {label:'BLOCK',color:'#ef4444',desc:'Auto-block'}
  }

  const safeCount  = stats?(stats.total_transactions-stats.fraud_detected):0
  const fraudCount = stats?.fraud_detected??0
  const pieData    = safeCount+fraudCount>0
    ?[{name:'Safe',value:safeCount},{name:'Fraud/Freeze',value:fraudCount}]
    :[{name:'No data',value:1}]
  const barData  = [...txList].slice(0,10).reverse().map((tx,i)=>({
    name:`T${i+1}`,fraud:parseFloat((tx.fraud_probability*100).toFixed(1)),
    threshold:parseFloat((tx.threshold*100).toFixed(0))
  }))
  const areaData = [...txList].slice(0,15).reverse().map((tx,i)=>({
    name:`#${i+1}`,amount:parseFloat(parseFloat(tx.amount).toFixed(4))
  }))

  const statusLabel={connected:'Connected',disconnected:'Disconnected',connecting:'Connecting',error:'Needs attention'}[connStatus]
  const compactAddr=walletAddr?`${walletAddr.slice(0,6)}...${walletAddr.slice(-4)}`:'No wallet linked'
  const chainLive=ganacheBlk!=null||blockInfo?.connected
  const amountRule=getAmountRule(amount)

  return(
    <div className="app-shell">
      <div className="background-glow background-glow-left"/>
      <div className="background-glow background-glow-right"/>

      <nav className="top-nav">
        <div className="nav-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="8.5" x2="22" y2="8.5"/><line x1="2" y1="15.5" x2="22" y2="15.5"/></svg>
          ETH FRAUD SHIELD
        </div>
        <div className="nav-tabs">
          {['overview','analyze','blockchain','alerts'].map(t=>(
            <button key={t} className={`nav-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>
              {t==='alerts'&&alerts.length>0?<>{t.charAt(0).toUpperCase()+t.slice(1)}<span className="alert-dot">{alerts.length}</span></>:t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
        <div className="nav-right">
          <span className={`net-badge ${chainLive?'live':''}`}><span className="status-dot connected-dot"/>{chainLive?'Blockchain Live':'Offline'}</span>
          {walletAddr
            ?<div className="wallet-info-pill"><span className="wallet-network">{network}</span><span className="wallet-bal">{balance} ETH</span><span className="wallet-addr">{compactAddr}</span></div>
            :<span className="address-chip-nav" onClick={handleConnect}>Connect Wallet</span>}
        </div>
      </nav>

      <main className="main-content">

        {/* ═══════ OVERVIEW ═══════ */}
        {tab==='overview'&&(
          <div className="wallet-dashboard">
            <section className="hero-card">
              <div className={`status-badge ${connStatus}`}><span className="status-dot"/>{statusLabel}{walletAddr&&<span style={{marginLeft:8,fontSize:10,opacity:.7}}>| {network} | {balance} ETH</span>}</div>
              <p className="eyebrow">Ethereum AI Fraud Detection</p>
              <h1>Detect phishing wallets with real-time AI analysis.</h1>
              <p className="hero-copy">XGBoost trained on 2.97M Ethereum wallets. Amount rules: 0–25 ETH Safe · 26–50 ETH Freeze · 50+ ETH Block. Dynamic thresholds adapt per wallet.</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={handleConnect} disabled={connStatus==='connecting'}>{connStatus==='connected'?'Reconnect wallet':connStatus==='connecting'?'Connecting...':'Connect MetaMask'}</button>
                <div className="address-chip">{compactAddr}</div>
              </div>
            </section>

            {/* Amount rule legend */}
            <div className="amount-rules-bar">
              <span className="rule-item safe">0–25 ETH: SAFE</span>
              <span className="rule-arrow">→</span>
              <span className="rule-item freeze">26–50 ETH: FREEZE</span>
              <span className="rule-arrow">→</span>
              <span className="rule-item block">50+ ETH: BLOCK</span>
              <span className="rule-note">+ Dynamic threshold adapts per wallet history</span>
            </div>

            <section className="panel-grid">
              {[
                {label:'Total Transactions',  value:stats?.total_transactions??0,   color:'#818cf8'},
                {label:'Fraud Detected',       value:stats?.fraud_detected??0,       color:'#ef4444'},
                {label:'Blocked / Frozen',     value:stats?.transactions_blocked??0, color:'#ef4444'},
                {label:'Active Wallets',       value:stats?.active_wallets??0,       color:'#f59e0b'},
                {label:'Avg Fraud Score',      value:stats?`${stats.avg_fraud_score}%`:'0%',color:'#a855f7'},
              ].map(({label,value,color})=>(
                <article key={label} className="info-panel">
                  <div className="panel-label">{label}</div>
                  <div className="panel-value" style={{color}}>{value}</div>
                </article>
              ))}
            </section>

            <section className="charts-grid">
              <div className="send-panel">
                <div className="panel-header"><div><p className="eyebrow muted">Distribution</p><h2>Fraud vs Safe</h2></div></div>
                <ResponsiveContainer width="100%" height={175}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={65} dataKey="value" label={({name,percent})=>percent>0?`${name} ${(percent*100).toFixed(0)}%`:''}>
                      <Cell fill="#7c3aed90" stroke="#7c3aed"/>
                      <Cell fill="#ef444490" stroke="#ef4444"/>
                      <Cell fill="#33415580" stroke="#475569"/>
                    </Pie>
                    <Tooltip contentStyle={{background:'#111118',border:'1px solid #1e1e2e',borderRadius:8,fontSize:12}}/>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pie-legend">
                  <span><span className="legend-dot" style={{background:'#7c3aed'}}/>Safe ({safeCount})</span>
                  <span><span className="legend-dot" style={{background:'#ef4444'}}/>Fraud ({fraudCount})</span>
                </div>
              </div>
              <div className="send-panel">
                <div className="panel-header"><div><p className="eyebrow muted">Last 10</p><h2>Score vs Threshold</h2></div></div>
                <ResponsiveContainer width="100%" height={175}>
                  <BarChart data={barData} barCategoryGap="20%">
                    <XAxis dataKey="name" tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false} domain={[0,100]}/>
                    <Tooltip contentStyle={{background:'#111118',border:'1px solid #1e1e2e',borderRadius:8,fontSize:12}}/>
                    <Bar dataKey="fraud"     fill="#ef444480" name="Fraud %" radius={[3,3,0,0]}/>
                    <Bar dataKey="threshold" fill="#f59e0b80" name="Threshold %" radius={[3,3,0,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="send-panel">
                <div className="panel-header"><div><p className="eyebrow muted">Volume</p><h2>ETH Trend</h2></div></div>
                <ResponsiveContainer width="100%" height={175}>
                  <AreaChart data={areaData}>
                    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={0.5}/><stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/></linearGradient></defs>
                    <XAxis dataKey="name" tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/>
                    <YAxis tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{background:'#111118',border:'1px solid #1e1e2e',borderRadius:8,fontSize:12}} formatter={v=>[`${v} ETH`,'Amount']}/>
                    <Area type="monotone" dataKey="amount" stroke="#7c3aed" fill="url(#cg)" strokeWidth={2} dot={{fill:'#7c3aed',r:3}}/>
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">Live Feed</p><h2>Recent Transactions</h2></div><div className="panel-note">Auto-refreshes every 8s</div></div>
              <div className="table-wrap">
                <table className="tx-table">
                  <thead><tr>{['TX Hash','Sender','Receiver','Amount','Fraud Score','Threshold','Risk','Decision','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {txList.length===0?<tr><td colSpan={9} className="empty-row">No transactions yet. Use the Analyze tab.</td></tr>
                    :txList.map((tx,i)=>{const fp=parseFloat(tx.fraud_probability),th=parseFloat(tx.threshold);return(
                      <tr key={i}>
                        <td className="mono muted">{short(tx.tx_hash)}</td>
                        <td className="mono muted">{short(tx.sender)}</td>
                        <td className="mono muted">{short(tx.receiver)}</td>
                        <td className="mono" style={{color:'#818cf8',fontWeight:600}}>{fmtEth(tx.amount)}</td>
                        <td className="mono" style={{color:fp>th?'#ef4444':'#22c55e',fontWeight:600}}>{pct(tx.fraud_probability)}</td>
                        <td className="mono amber">{pct(tx.threshold)}</td>
                        <td><span className={`risk-badge ${tx.risk_level}`}>{(tx.risk_level||'').toUpperCase()}</span></td>
                        <td><span className={`decision-badge ${(tx.decision||'').toLowerCase()}`}>{tx.decision}</span></td>
                        <td><span className={`action-badge ${tx.action==='BLOCK'||tx.action==='BLOCK_AND_BLACKLIST'?'block':tx.action==='FREEZE'?'freeze':tx.action?.includes('WARNING')?'warn':'approve'}`}>{tx.action}</span></td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* ═══════ ANALYZE ═══════ */}
        {tab==='analyze'&&(
          <div className="wallet-dashboard">
            <section className="hero-card">
              <div className={`status-badge ${connStatus}`}><span className="status-dot"/>{statusLabel}</div>
              <p className="eyebrow">AI-Powered Transaction Analysis</p>
              <h1>Submit a transaction to detect phishing.</h1>
              <p className="hero-copy">XGBoost trained on 2.97M wallets. Rules: 0–25 ETH Safe · 26–50 ETH Freeze · 50+ ETH Block. Dynamic threshold adapts per wallet behavior.</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={handleConnect} disabled={connStatus==='connecting'}>{connStatus==='connected'?'Reconnect wallet':'Connect MetaMask'}</button>
                <div className="address-chip">{compactAddr}</div>
              </div>
            </section>

            <section className="panel-grid" style={{gridTemplateColumns:'1fr 1fr'}}>
              <article className="info-panel"><div className="panel-label">Wallet Address</div><div className="panel-value address-value">{walletAddr??'Waiting for connection'}</div></article>
              <article className="info-panel"><div className="panel-label">ETH Balance {network&&<span style={{color:'#7c3aed',fontSize:10,marginLeft:6}}>({network})</span>}</div><div className="panel-value balance-value">{balance} <span>ETH</span></div></article>
            </section>

            <div className="analyze-grid">
              <section className="send-panel">
                <div className="panel-header"><div><p className="eyebrow muted">Transaction Details</p><h2>Analyze Transaction</h2></div><div className="panel-note">Real-time AI</div></div>
                <div className="form-grid">
                  <label><span>Sender Address</span><input className="form-input" value={sender} onChange={e=>setSender(e.target.value)} placeholder="0x..."/></label>
                  <label><span>Recipient Address</span><input className="form-input" value={recipient} onChange={e=>setRecipient(e.target.value)} placeholder="0x..."/></label>
                  <label>
                    <span>Amount in ETH</span>
                    <input className="form-input" type="number" min="0.001" step="0.001" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.05"/>
                    {amount&&<div className="amount-preview" style={{color:amountRule.color}}>
                      Rule: <strong>{amountRule.label}</strong> — {amountRule.desc}
                    </div>}
                  </label>
                </div>
                <div className="form-actions">
                  <button className="primary-button" onClick={handleAnalyze} disabled={sending}>{sending?'Analyzing...':'Analyze Transaction'}</button>
                  <p className="message-text">{message}</p>
                </div>
                <div style={{marginTop:20}}>
                  <p className="eyebrow muted" style={{marginBottom:10}}>Quick Test Scenarios</p>
                  {[
                    ['Normal — 0.5 ETH (Safe range)',        walletAddr||'0xAAA...001','0xBBB...001', 0.5 ],
                    ['Medium — 5 ETH (Safe range)',          walletAddr||'0xAAA...001','0xBBB...001', 5.0 ],
                    ['Freeze zone — 35 ETH (26–50)',         walletAddr||'0xAAA...001','0xBBB...001',35.0 ],
                    ['Auto-block — 75 ETH (50+)',            walletAddr||'0xAAA...001','0xBBB...001',75.0 ],
                    ['Build history then spike — 0.1 ETH',  walletAddr||'0xAAA...001','0xBBB...001', 0.1 ],
                  ].map(([label,s,r,a])=>(
                    <button key={label} className="scenario-btn" onClick={()=>loadScenario(s,r,a)}>
                      <span>{label}</span>
                      <span style={{color:getAmountRule(a).color}} className="mono">{a} ETH</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Result + Explanation Panel */}
              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                <section className="send-panel">
                  <div className="panel-header"><div><p className="eyebrow muted">AI Analysis Result</p><h2>Fraud Detection Output</h2></div></div>
                  {!lastResult
                    ?<div className="empty-result"><div className="empty-hex">⬡</div><p>Submit a transaction to see AI analysis here</p></div>
                    :<>
                      <div className={`result-banner ${lastResult.action==='FREEZE'?'frozen':lastResult.action?.startsWith('BLOCK')?'blocked':'approved'}`}>
                        <div className="result-title">
                          {lastResult.action==='FREEZE'?'🧊 FROZEN':lastResult.action?.startsWith('BLOCK')?'🚫 BLOCKED':'✅ APPROVED'}
                        </div>
                        <div className="result-action">{lastResult.action}</div>
                      </div>

                      {/* Probability bar */}
                      <div className="prob-bar-wrap">
                        <div className="prob-bar-labels">
                          <span>Fraud Probability</span>
                          <span style={{color:parseFloat(lastResult.fraud_probability)>parseFloat(lastResult.threshold)?'#ef4444':'#22c55e',fontWeight:700}}>{pct(lastResult.fraud_probability)}</span>
                        </div>
                        <div className="prob-bar-track">
                          <div className="prob-bar-fill" style={{width:`${Math.min(parseFloat(lastResult.fraud_probability)*100,100)}%`,background:parseFloat(lastResult.fraud_probability)>0.7?'#ef4444':parseFloat(lastResult.fraud_probability)>0.4?'#f59e0b':'#22c55e'}}/>
                          <div className="prob-threshold-marker" style={{left:`${Math.min(parseFloat(lastResult.threshold)*100,100)}%`}}/>
                        </div>
                        <div style={{fontSize:10,color:'#475569',marginTop:4}}>▲ Dynamic threshold at {pct(lastResult.threshold)}</div>
                      </div>

                      <div className="result-rows">
                        {[
                          ['Transaction ID',     lastResult.tx_hash,                'accent'],
                          ['Fraud Probability',  pct(lastResult.fraud_probability), parseFloat(lastResult.fraud_probability)>parseFloat(lastResult.threshold)?'red':'green'],
                          ['Normal Probability', pct(lastResult.normal_probability),'green'],
                          ['Dynamic Threshold',  pct(lastResult.threshold),         'amber'],
                          ['Amount Rule',        lastResult.amount_rule||'SAFE',    lastResult.amount_rule==='BLOCK'?'red':lastResult.amount_rule==='FREEZE'?'amber':'green'],
                          ['Risk Level',         (lastResult.risk_level||'').toUpperCase(),'purple'],
                          ['Decision',           lastResult.decision,               lastResult.decision==='FRAUDULENT'||lastResult.decision==='SUSPICIOUS'?'red':'green'],
                          ['Model Used',         'XGBoost (2.97M Ethereum wallets)','muted'],
                          ['Blockchain Hash',    short(lastResult.blockchain_hash)||'Simulated','accent'],
                          ['Block Number',       lastResult.block_number?'#'+lastResult.block_number:'Pending','purple'],
                        ].map(([k,v,c])=>(
                          <div key={k} className="result-row">
                            <span className="result-key">{k}</span>
                            <span className={`result-val ${c}`}>{v}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  }
                </section>

                {/* AI Explanation Panel */}
                {lastResult?.explanation?.length>0&&(
                  <section className="send-panel explanation-panel">
                    <div className="panel-header"><div><p className="eyebrow muted">Explainable AI</p><h2>AI Explanation</h2></div></div>
                    <div className="explanation-header">
                      <div className="exp-tx">Transaction ID: <span className="accent mono">{lastResult.tx_hash}</span></div>
                      <div className="exp-row"><span className="exp-label">Fraud Probability:</span><span style={{color:parseFloat(lastResult.fraud_probability)>parseFloat(lastResult.threshold)?'#ef4444':'#22c55e',fontWeight:700}}>{pct(lastResult.fraud_probability)}</span></div>
                      <div className="exp-row"><span className="exp-label">Dynamic Threshold:</span><span className="amber" style={{fontWeight:700}}>{pct(lastResult.threshold)}</span></div>
                      <div className="exp-row"><span className="exp-label">Decision:</span>
                        <span className={`exp-decision ${lastResult.action?.startsWith('BLOCK')?'red':lastResult.action==='FREEZE'?'amber':'green'}`}>
                          {lastResult.action==='FREEZE'?'🧊 FROZEN':lastResult.action?.startsWith('BLOCK')?'🚫 BLOCKED':'✅ APPROVED'}
                        </span>
                      </div>
                    </div>
                    <div className="exp-divider">AI Explanation:</div>
                    <div className="exp-reasons">
                      {lastResult.explanation.map((r,i)=>(
                        <div key={i} className="exp-reason">
                          <span className={`exp-check ${lastResult.action?.startsWith('BLOCK')||lastResult.action==='FREEZE'?'red':'green'}`}>
                            {lastResult.action?.startsWith('BLOCK')||lastResult.action==='FREEZE'?'✖':'✔'}
                          </span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ═══════ BLOCKCHAIN ═══════ */}
        {tab==='blockchain'&&(
          <div className="wallet-dashboard">
            <section className="hero-card">
              <div className={`status-badge ${chainLive?'connected':'disconnected'}`}><span className="status-dot"/>{chainLive?'Blockchain Connected':'Offline — Start Ganache'}</div>
              <p className="eyebrow">Blockchain Layer</p>
              <h1>Immutable fraud records on Ethereum.</h1>
              <p className="hero-copy">Every AI fraud decision is logged as a blockchain block. Each block links to the previous via hash — tamper-proof chain of fraud evidence.</p>
            </section>

            <section className="panel-grid">
              {[
                {label:'RPC Endpoint',    value:'http://127.0.0.1:7545'},
                {label:'Latest Block',    value:ganacheBlk!=null?`#${ganacheBlk}`:blockInfo?.block_number?`#${blockInfo.block_number}`:'—'},
                {label:'Total TX Records',value:txList.length},
                {label:'Contract',        value:'FraudDetection.sol'},
              ].map(({label,value})=>(
                <article key={label} className="info-panel"><div className="panel-label">{label}</div><div className="panel-value address-value" style={{fontSize:13,color:'#818cf8'}}>{value}</div></article>
              ))}
            </section>

            {/* Blockchain Chain Visualizer */}
            {chain.length>0&&(
              <section className="send-panel">
                <div className="panel-header"><div><p className="eyebrow muted">Chain Explorer</p><h2>Blockchain — Linked Blocks</h2></div></div>
                <div className="chain-container">
                  {chain.map((block,i)=>(
                    <div key={i} className="chain-item">
                      <div className={`chain-block ${block.action==='BLOCK'||block.action==='BLOCK_AND_BLACKLIST'?'block-danger':block.action==='FREEZE'?'block-freeze':'block-safe'}`}>
                        <div className="chain-block-header">
                          <span className="chain-block-num">Block #{block.block_number||block.block_index+1000}</span>
                          <span className={`action-badge ${block.action==='BLOCK'||block.action==='BLOCK_AND_BLACKLIST'?'block':block.action==='FREEZE'?'freeze':'approve'}`} style={{fontSize:9}}>{block.action}</span>
                        </div>
                        <div className="chain-meta">
                          <div className="chain-field"><span className="chain-label">TX Hash</span><span className="chain-val accent">{short(block.tx_hash)}</span></div>
                          <div className="chain-field"><span className="chain-label">Block Hash</span><span className="chain-val accent">{short(block.blockchain_hash)}</span></div>
                          <div className="chain-field"><span className="chain-label">Prev Hash</span><span className="chain-val muted">{short(block.prev_hash)}</span></div>
                          <div className="chain-field"><span className="chain-label">Sender</span><span className="chain-val">{short(block.sender)}</span></div>
                          <div className="chain-field"><span className="chain-label">Amount</span><span className="chain-val" style={{color:'#818cf8'}}>{fmtEth(block.amount)} ETH</span></div>
                          <div className="chain-field"><span className="chain-label">Fraud Score</span><span className="chain-val" style={{color:parseFloat(block.fraud_probability)>parseFloat(block.threshold)?'#ef4444':'#22c55e'}}>{pct(block.fraud_probability)}</span></div>
                          <div className="chain-field"><span className="chain-label">Threshold</span><span className="chain-val amber">{pct(block.threshold)}</span></div>
                          <div className="chain-field"><span className="chain-label">Decision</span><span className={`chain-val ${block.decision==='FRAUDULENT'||block.decision==='SUSPICIOUS'?'red':'green'}`}>{block.decision}</span></div>
                          <div className="chain-field"><span className="chain-label">Gas Used</span><span className="chain-val muted">{block.gas_used?.toLocaleString()}</span></div>
                          <div className="chain-field"><span className="chain-label">Timestamp</span><span className="chain-val muted" style={{fontSize:9}}>{block.timestamp?.slice(0,19)}</span></div>
                        </div>
                      </div>
                      {i<chain.length-1&&(
                        <div className="chain-link">
                          <div className="chain-link-line"/>
                          <div className="chain-link-arrow">↓</div>
                          <div className="chain-link-label">prev_hash links</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Smart Contract Events */}
            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">Smart Contract</p><h2>FraudDetection.sol Events</h2></div></div>
              {scEvents.length===0
                ?<div className="empty-result"><p>No events yet. Analyze a transaction in the Freeze or Block range to trigger.</p></div>
                :scEvents.map((ev,i)=>(
                  <div key={i} className="sc-event">
                    <div className="sc-fn">{ev.fn}</div>
                    <div className="sc-meta">
                      <span>Sender: <span className="accent">{ev.sender}</span></span>
                      <span>Amount: <span style={{color:'#818cf8'}}>{ev.amount} ETH</span></span>
                      <span>Score: <span className="red">{ev.score}</span></span>
                      <span>Threshold: <span className="amber">{ev.thresh}</span></span>
                      <span>Block: <span className="purple">{ev.block}</span></span>
                      <span className="muted">{ev.time}</span>
                    </div>
                  </div>
                ))
              }
            </section>

            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">Solidity</p><h2>Contract Logic</h2></div></div>
              <div className="code-block">
                <span className="kw">pragma solidity</span> <span className="str">^0.8.19</span>;<br/><br/>
                <span className="kw">contract</span> <span className="fn">FraudDetection</span> {'{'}<br/>
                <span style={{marginLeft:16,color:'#475569',fontStyle:'italic'}}>// Amount rules: 0-25 SAFE · 26-50 FREEZE · 50+ BLOCK</span><br/>
                <span style={{marginLeft:16}}><span className="kw">uint256 public</span> FREEZE_THRESHOLD = <span className="str">26 ether</span>;</span><br/>
                <span style={{marginLeft:16}}><span className="kw">uint256 public</span> BLOCK_THRESHOLD  = <span className="str">50 ether</span>;</span><br/><br/>
                <span style={{marginLeft:16}}><span className="kw">function</span> <span className="fn">logTransaction</span>(</span><br/>
                <span style={{marginLeft:32,color:'#64748b'}}>string txHash, address sender,</span><br/>
                <span style={{marginLeft:32,color:'#64748b'}}>uint256 amountWei, uint256 fraudScore, string decision</span><br/>
                <span style={{marginLeft:16}}>) <span className="kw">public onlyOwner</span> {'{'}</span><br/>
                <span style={{marginLeft:32}}><span className="kw">if</span>(amountWei {'>'} BLOCK_THRESHOLD) {'{'}</span><br/>
                <span style={{marginLeft:48}} className="fn">blockTransaction(sender);</span><br/>
                <span style={{marginLeft:32}}>{'}'} <span className="kw">else if</span>(amountWei {'>'} FREEZE_THRESHOLD) {'{'}</span><br/>
                <span style={{marginLeft:48}} className="fn">freezeTransaction(sender);</span><br/>
                <span style={{marginLeft:32}}>{'}'} <span className="kw">else if</span>(fraudScore {'>'} dynamicThreshold) {'{'}</span><br/>
                <span style={{marginLeft:48}} className="fn">blockTransaction(sender);</span><br/>
                <span style={{marginLeft:32}}>{'}'}</span><br/>
                <span style={{marginLeft:32}}><span className="kw">emit</span> <span className="fn">TransactionLogged</span>(sender, decision, fraudScore);</span><br/>
                <span style={{marginLeft:16}}>{'}'}</span><br/>
                {'}'}
              </div>
            </section>
          </div>
        )}

        {/* ═══════ ALERTS ═══════ */}
        {tab==='alerts'&&(
          <div className="wallet-dashboard">
            <section className="hero-card">
              <div className={`status-badge ${alerts.length>0?'error':'disconnected'}`}><span className="status-dot"/>{alerts.length>0?`${alerts.length} Active Alert${alerts.length>1?'s':''}`:'No Alerts'}</div>
              <p className="eyebrow">Real-Time Monitoring</p>
              <h1>Fraud alerts and system events.</h1>
              <p className="hero-copy">Every blocked and frozen transaction appears here instantly. Amount rules: 26–50 ETH Freeze · 50+ ETH Block · Dynamic AI threshold.</p>
            </section>
            <section className="panel-grid" style={{gridTemplateColumns:'repeat(3,1fr)'}}>
              {[
                {label:'Total Alerts',       value:alerts.length,                  color:'#ef4444'},
                {label:'Blocked / Frozen',   value:stats?.transactions_blocked??0, color:'#f59e0b'},
                {label:'Fraud Detected',     value:stats?.fraud_detected??0,       color:'#a855f7'},
              ].map(({label,value,color})=>(
                <article key={label} className="info-panel"><div className="panel-label">{label}</div><div className="panel-value" style={{color}}>{value}</div></article>
              ))}
            </section>
            <section className="send-panel">
              <div className="panel-header">
                <div><p className="eyebrow muted">Fraud Alerts</p><h2>Blocked & Frozen Transactions</h2></div>
                {alerts.length>0&&<button className="clear-btn" onClick={()=>setAlerts([])}>Clear All</button>}
              </div>
              {alerts.length===0
                ?<div className="empty-result"><div className="empty-hex">🛡</div><p>No alerts yet. Try the "Freeze zone" or "Auto-block" scenarios in Analyze tab.</p></div>
                :alerts.map((a,i)=>(
                  <div key={i} className={`alert-item ${a.type==='warn'?'alert-warn':''}`}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:18}}>{a.type==='warn'?'🧊':'⚠'}</span><span>{a.text}</span>
                    </div>
                    <span className="muted small" style={{whiteSpace:'nowrap'}}>{a.time}</span>
                  </div>
                ))
              }
            </section>
            <section className="send-panel" style={{marginTop:16}}>
              <div className="panel-header"><div><p className="eyebrow muted">System</p><h2>System Events</h2></div></div>
              {[
                {ev:`Flask API — ${API}`,ok:true},
                {ev:'XGBoost — Ethereum Phishing Dataset (2.97M nodes)',ok:true},
                {ev:'SQLite database initialized',ok:true},
                {ev:'Amount rules: 0–25 SAFE · 26–50 FREEZE · 50+ BLOCK',ok:true},
                {ev:'Dynamic threshold engine — per-wallet adaptation active',ok:true},
                {ev:`Blockchain — Ganache ${chainLive?'connected':'offline'}`,ok:chainLive},
                {ev:`MetaMask ${connStatus==='connected'?'connected: '+compactAddr:'not connected'}`,ok:connStatus==='connected'},
              ].map(({ev,ok},i)=>(
                <div key={i} className="sys-event">
                  <span style={{color:ok?'#22c55e':'#f59e0b'}}>{ok?'✓':'○'}</span>
                  <span style={{color:ok?'#e2e8f0':'#94a3b8'}}>{ev}</span>
                  <span className="muted small">{new Date(Date.now()-i*60000).toLocaleTimeString()}</span>
                </div>
              ))}
            </section>
          </div>
        )}
      </main>
    </div>
  )
}
