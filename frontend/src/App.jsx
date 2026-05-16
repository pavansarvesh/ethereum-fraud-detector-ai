import { useState, useEffect, useCallback, useRef } from 'react'
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import './App.css'

const API         = import.meta.env.VITE_API_URL || 'http://127.0.0.1:5000'
const GANACHE_RPC = import.meta.env.VITE_GANACHE_RPC || 'http://127.0.0.1:7545'
const short  = (s='') => s.length>14?`${s.slice(0,6)}...${s.slice(-4)}`:s
const pct    = n=>`${(parseFloat(n||0)*100).toFixed(1)}%`
const fmtEth = n=>parseFloat(n||0).toFixed(4)
const esc    = s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

export default function App() {
  const [tab,          setTab         ] = useState('overview')
  const [connStatus,   setConnStatus  ] = useState('disconnected')
  const [walletAddr,   setWalletAddr  ] = useState(null)
  const [balance,      setBalance     ] = useState('0.0000')
  const [prevBalance,  setPrevBalance ] = useState(null)
  const [balanceDiff,  setBalanceDiff ] = useState(null)
  const [network,      setNetwork     ] = useState('')
  const [stats,        setStats       ] = useState(null)
  const [txList,       setTxList      ] = useState([])
  const [walletTxList, setWalletTxList] = useState([])
  const [chain,        setChain       ] = useState([])
  const [blockInfo,    setBlockInfo   ] = useState(null)
  const [lastResult,   setLastResult  ] = useState(null)
  const [alerts,       setAlerts      ] = useState([])
  const [scEvents,     setScEvents    ] = useState([])
  const [sending,      setSending     ] = useState(false)
  const [recipient,    setRecipient   ] = useState('')
  const [amount,       setAmount      ] = useState('')
  const [sender,       setSender      ] = useState('')
  const [message,      setMessage     ] = useState('Connect wallet or enter sender address manually.')
  const [ganacheBlk,   setGanacheBlk  ] = useState(null)
  const balanceRef  = useRef('0.0000')
  const [riskHistory,  setRiskHistory ] = useState([])
  const [receiverRisk, setReceiverRisk] = useState(null)
  const [exportingPDF, setExportingPDF] = useState(false)
  const [blacklist,    setBlacklist   ] = useState([])
  const [gasAnalytics, setGasAnalytics] = useState(null)
  const [networkStats, setNetworkStats ] = useState(null)
  const [verifyResult, setVerifyResult ] = useState(null)
  const [chainThreshHistory, setChainThreshHistory] = useState([])  // Phase 5
  const [modelIntegrity,     setModelIntegrity    ] = useState(null) // Phase 3
  const [verifyHash,         setVerifyHash        ] = useState('')
  const [pendingTx,          setPendingTx        ] = useState(null)
  const ethListenersRef = useRef(false)

  const fetchData = useCallback(async () => {
    try {
      const [sRes,tRes,bRes,cRes] = await Promise.all([
        fetch(`${API}/dashboard/stats`),
        fetch(`${API}/transactions?limit=50`),
        fetch(`${API}/blockchain/info`),
        fetch(`${API}/blockchain/chain?limit=8`),
      ])
      if(sRes.ok) setStats(await sRes.json())
      if(tRes.ok) {
        const txs = await tRes.json()
        const seen = new Set()
        const unique = txs.filter(tx => {
          if(seen.has(tx.tx_hash)) return false
          seen.add(tx.tx_hash)
          return true
        })
        setTxList(unique)
      }
      if(bRes.ok) setBlockInfo(await bRes.json())
      if(cRes.ok) setChain(await cRes.json())
    } catch(_){ }
  }, [])

  const fetchAlertsFromDB = useCallback(async () => {
    try {
      const res = await fetch(`${API}/alerts?limit=50`)
      if(res.ok) setAlerts(await res.json())
    } catch(_){ }
  }, [])

  const fetchSCEvents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/sc_events?limit=20`)
      if(res.ok) setScEvents(await res.json())
    } catch(_){ }
  }, [])

  const clearAlertsDB = useCallback(async () => {
    try {
      await fetch(`${API}/alerts/clear`, {method:'DELETE'})
      setAlerts([])
    } catch(_){ }
  }, [])

  const fetchNetworkData = useCallback(async () => {
    try {
      const [nRes, gRes, bkRes] = await Promise.all([
        fetch(`${API}/network/stats`),
        fetch(`${API}/gas/analytics`),
        fetch(`${API}/blacklist`),
      ])
      if(nRes.ok) setNetworkStats(await nRes.json())
      if(gRes.ok) setGasAnalytics(await gRes.json())
      if(bkRes.ok) setBlacklist(await bkRes.json())
    } catch(_){ }
  }, [])

  const removeFromBlacklist = useCallback(async (address) => {
    try {
      await fetch(`${API}/blacklist/${encodeURIComponent(address)}`, {method:'DELETE'})
      setBlacklist(prev => prev.filter(w => w.address !== address))
    } catch(_){ }
  }, [])

  const fetchChainThresholdHistory = useCallback(async (address) => {
    if(!address) return
    try {
      const res = await fetch(`${API}/blockchain/threshold_history/${address}`)
      if(res.ok) {
        const d = await res.json()
        if(d.history?.length > 0) setChainThreshHistory(d.history)
      }
    } catch(_){ }
  }, [])

  const fetchModelIntegrity = useCallback(async () => {
    try {
      const res = await fetch(`${API}/blockchain/model_integrity`)
      if(res.ok) setModelIntegrity(await res.json())
    } catch(_){ }
  }, [])

  const fetchGanacheBlock = useCallback(async () => {
    try {
      const res = await fetch(GANACHE_RPC,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',method:'eth_blockNumber',params:[],id:1})
      })
      const d = await res.json()
      if(d.result) setGanacheBlk(parseInt(d.result,16))
    } catch(_){ }
  },[])

  const fetchBalance = useCallback(async(addr, showDiff=false)=>{
    try {
      const res = await fetch(GANACHE_RPC,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',method:'eth_getBalance',params:[addr,'latest'],id:1})
      })
      const d = await res.json()
      if(d.result) {
        const newBal = (Number(BigInt(d.result))/1e18).toFixed(4)
        if(showDiff && balanceRef.current !== '0.0000') {
          const diff = parseFloat(newBal) - parseFloat(balanceRef.current)
          if(Math.abs(diff) > 0.0001) {
            setBalanceDiff(diff.toFixed(4))
            setTimeout(() => setBalanceDiff(null), 4000)
          }
        }
        setPrevBalance(balanceRef.current)
        balanceRef.current = newBal
        setBalance(newBal)
      }
    } catch(_){
      if(window.ethereum&&addr){
        try{
          const b=await window.ethereum.request({method:'eth_getBalance',params:[addr,'latest']})
          const newBal=(Number(BigInt(b))/1e18).toFixed(4)
          balanceRef.current = newBal
          setBalance(newBal)
        }catch(_){ }
      }
    }
  },[])

  const fetchWalletTxs = useCallback(async(addr) => {
    try {
      const res = await fetch(`${API}/transactions?limit=50`)
      if(res.ok) {
        const txs = await res.json()
        const seen = new Set()
        const walletTxs = txs.filter(tx => {
          const match = tx.sender?.toLowerCase() === addr?.toLowerCase() ||
                        tx.receiver?.toLowerCase() === addr?.toLowerCase()
          if(!match || seen.has(tx.tx_hash)) return false
          seen.add(tx.tx_hash)
          return true
        })
        setWalletTxList(walletTxs)
      }
    } catch(_){ }
  },[])

  async function runBackendAnalysis(payload, {checkOnly = false, confirmed = false} = {}) {
    const res = await fetch(`${API}/analyze_transaction`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        ...payload,
        check_only: checkOnly,
        confirmed,
      })
    })
    if(!res.ok) throw new Error(`Server error ${res.status}`)
    return await res.json()
  }

  function mapReceiverRisk(data, address) {
    if(!data) return null
    return {
      address,
      fraud_score: data.fraud_probability,
      risk_level: data.risk_level,
      threshold: data.threshold,
      tx_count: data.features?.total_tx_count || data.features?.sent_count || 0,
      recv_unique: data.features?.recv_unique_send || 0,
      zero_recv: data.features?.zero_recv_flag || 0,
      high_fan_out: data.features?.high_fan_out || 0,
    }
  }

  useEffect(()=>{
    fetchData(); fetchGanacheBlock()
    fetchAlertsFromDB(); fetchSCEvents(); fetchNetworkData()
    fetchModelIntegrity()
    const i1=setInterval(fetchData,8000)
    const i2=setInterval(fetchGanacheBlock,5000)
    const i3=setInterval(fetchAlertsFromDB,10000)
    const i4=setInterval(fetchNetworkData,15000)
    return()=>{clearInterval(i1);clearInterval(i2);clearInterval(i3);clearInterval(i4)}
  },[fetchData,fetchGanacheBlock,fetchAlertsFromDB,fetchSCEvents,fetchNetworkData,fetchModelIntegrity])

  useEffect(()=>{
    if(!walletAddr)return
    fetchBalance(walletAddr)
    fetchWalletTxs(walletAddr)
    const i1=setInterval(()=>fetchBalance(walletAddr),10000)
    const i2=setInterval(()=>fetchWalletTxs(walletAddr),8000)
    return()=>{clearInterval(i1);clearInterval(i2)}
  },[walletAddr,fetchBalance,fetchWalletTxs])

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
      await fetchWalletTxs(addr)
      fetchChainThresholdHistory(addr)
      setConnStatus('connected')
      setMessage('Wallet connected. Ready to analyze transactions.')
      if(!ethListenersRef.current){
        window.ethereum.on('accountsChanged',accs=>{
          if(!accs.length){setConnStatus('disconnected');setWalletAddr(null);setBalance('0.0000');setWalletTxList([])}
          else{setWalletAddr(accs[0]);setSender(accs[0]);fetchBalance(accs[0]);fetchWalletTxs(accs[0])}
        })
        window.ethereum.on('chainChanged', ()=> window.location.reload())
        ethListenersRef.current=true
      }
    } catch(e){setConnStatus('error');setMessage(e.message||'Unable to connect wallet.')}
  }

  async function analyzeTransaction(overrides = {}){
    const txSender = overrides.sender ?? sender
    const txReceiver = overrides.receiver ?? recipient
    const txAmount = overrides.amount ?? amount
    const txHash = overrides.tx_hash ?? `TX-${Date.now()}`
    const txTimestamp = overrides.timestamp ?? Date.now()/1000

    if(!txSender)   {setMessage('Enter sender address or connect wallet.');return}
    if(!txReceiver) {setMessage('Enter a recipient address.');return}
    if(!txAmount||parseFloat(txAmount)<=0){setMessage('Enter a valid amount > 0.');return}

    const payload = {
      sender: txSender,
      receiver: txReceiver,
      amount: parseFloat(txAmount),
      tx_hash: txHash,
      timestamp: txTimestamp,
    }

    setSending(true)
    setReceiverRisk(null)
    try{
      if(overrides.seedHistory){
        const seedRes = await fetch(`${API}/demo/seed_fraud_wallet`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({sender:txSender})
        })
        if(!seedRes.ok) throw new Error(`Unable to seed demo history (${seedRes.status})`)
      }

      setMessage('Analyzing receiver wallet history with XGBoost...')
      const analysis = await runBackendAnalysis(payload, {checkOnly:true, confirmed:false})
      setLastResult(analysis)
      setReceiverRisk(mapReceiverRisk(analysis, txReceiver))

      setRiskHistory(prev=>{
        const newPoint={
          tx   : `TX${prev.length+1}`,
          score: parseFloat((analysis.fraud_probability*100).toFixed(1)),
          threshold: parseFloat((analysis.threshold*100).toFixed(0)),
          amount: parseFloat(analysis.amount),
          action: analysis.action,
          time : new Date().toLocaleTimeString(),
        }
        return [...prev.slice(-19), newPoint]
      })

      if(analysis.requires_confirmation){
        setPendingTx(payload)
        setMessage(`⚠️ Receiver fraud score ${pct(analysis.fraud_probability)} needs confirmation. Proceed or cancel to continue.`)
        return analysis
      }

      const autoData = await runBackendAnalysis(payload, {checkOnly:false, confirmed:true})
      setLastResult(autoData)
      setReceiverRisk(mapReceiverRisk(autoData, txReceiver))
      setMessage(autoData.action==='INSUFFICIENT_BALANCE'
        ? '⚠️ Insufficient balance. Transaction aborted before sending.'
        : `✅ Transaction auto-approved. Receiver fraud score ${pct(autoData.fraud_probability)}.`)
      setScEvents(p=>[{
        fn   :'approveTransaction()',
        sender:short(txSender),recv:short(txReceiver),
        score:pct(autoData.fraud_probability),thresh:pct(autoData.threshold),
        hash :autoData.tx_hash,block:autoData.block_number||'—',
        amount:autoData.amount,time:new Date().toLocaleTimeString()
      },...p.slice(0,9)])
      await fetchData()
      setTimeout(()=>fetchData(), 1500)
      setTimeout(()=>fetchAlertsFromDB(), 500)
      setTimeout(()=>fetchSCEvents(), 600)
      setTimeout(()=>fetchNetworkData(), 800)
      if(walletAddr){
        await fetchBalance(walletAddr, true)
        setTimeout(()=>fetchWalletTxs(walletAddr), 1000)
      }
      if(txReceiver?.startsWith('0x') && txReceiver.length===42){
        await fetchBalance(txReceiver, true)
      }
      if(txSender?.startsWith('0x') && txSender.length===42){
        setTimeout(()=>fetchBalance(txSender, true), 1500)
      }
      return autoData
    }catch(e){
      setMessage(e.message?.includes('fetch')?'Backend not reachable. Run: python app.py':e.message)
    }finally{setSending(false)}
  }

  async function confirmPendingTransaction(proceed){
    if(!pendingTx) return
    if(!proceed){
      setPendingTx(null)
      setMessage('Transaction cancelled before execution.')
      return
    }
    setSending(true)
    try{
      const data = await runBackendAnalysis(pendingTx, {checkOnly:false, confirmed:true})
      setLastResult(data)
      setReceiverRisk(mapReceiverRisk(data, pendingTx.receiver))
      setMessage(data.action==='INSUFFICIENT_BALANCE'
        ? '⚠️ Insufficient balance. Transaction aborted before sending.'
        : `✅ Transaction completed after confirmation. Receiver fraud score ${pct(data.fraud_probability)}.`)
      setScEvents(p=>[{
        fn   :'approveTransactionAfterConfirmation()',
        sender:short(pendingTx.sender),recv:short(pendingTx.receiver),
        score:pct(data.fraud_probability),thresh:pct(data.threshold),
        hash :data.tx_hash,block:data.block_number||'—',
        amount:data.amount,time:new Date().toLocaleTimeString()
      },...p.slice(0,9)])
      await fetchData()
      setTimeout(()=>fetchData(), 1500)
      setTimeout(()=>fetchAlertsFromDB(), 500)
      setTimeout(()=>fetchSCEvents(), 600)
      setTimeout(()=>fetchNetworkData(), 800)
      if(walletAddr){
        await fetchBalance(walletAddr, true)
        setTimeout(()=>fetchWalletTxs(walletAddr), 1000)
      }
      if(pendingTx.receiver?.startsWith('0x') && pendingTx.receiver.length===42){
        await fetchBalance(pendingTx.receiver, true)
      }
      if(pendingTx.sender?.startsWith('0x') && pendingTx.sender.length===42){
        setTimeout(()=>fetchBalance(pendingTx.sender, true), 1500)
      }
      await fetchData()
      setTimeout(()=>fetchData(), 1500)
      setTimeout(()=>fetchAlertsFromDB(), 500)
      setTimeout(()=>fetchSCEvents(), 600)
      setTimeout(()=>fetchNetworkData(), 800)
    }catch(e){
      setMessage(e.message?.includes('fetch')?'Backend not reachable. Run: python app.py':e.message)
    }finally{
      setPendingTx(null)
      setSending(false)
    }
  }

  const handleAnalyze = () => analyzeTransaction()

  async function runFraudDemo(){
    const demoSender = walletAddr || '0x1111111111111111111111111111111111111111'
    const demoReceiver = '0x2222222222222222222222222222222222222222'
    setSender(demoSender)
    setRecipient(demoReceiver)
    setAmount('2.5')
    await analyzeTransaction({
      sender: demoSender,
      receiver: demoReceiver,
      amount: 2.5,
      tx_hash: `DEMO-${Date.now()}`,
      seedHistory: true,
    })
  }

  // ── PDF Export ──────────────────────────────────────────────────────────────
  function exportPDF(result){
    if(!result){alert('No transaction to export. Analyze a transaction first.');return}
    setExportingPDF(true)
    try{
      const w = window.open('','_blank')
      const review = String(result.action||'').includes('REVIEW')
      const statusColor = review?'#f59e0b':'#22c55e'
      const statusText  = review?'REVIEW REQUIRED':'APPROVED'
      const reasons = (result.explanation||[]).map(r=>`<li style="margin:6px 0;color:#374151">${r}</li>`).join('')
      const recvSection = receiverRisk ? `
        <div class="section">
          <h3>Receiver Wallet Analysis</h3>
          <table><tbody>
            <tr><td>Receiver Address</td><td class="val">${receiverRisk.address}</td></tr>
            <tr><td>Receiver Fraud Score</td><td class="val" style="color:${parseFloat(receiverRisk.fraud_score)>0.5?'#ef4444':'#16a34a'}">${pct(receiverRisk.fraud_score)}</td></tr>
            <tr><td>Receiver Risk Level</td><td class="val">${(receiverRisk.risk_level||'').toUpperCase()}</td></tr>
            <tr><td>Receiver TX Count</td><td class="val">${receiverRisk.tx_count}</td></tr>
            <tr><td>High Fan-out Pattern</td><td class="val">${receiverRisk.high_fan_out?'YES — Suspicious':'No'}</td></tr>
          </tbody></table>
        </div>` : ''
      w.document.write(`<!DOCTYPE html><html><head><title>Fraud Report</title>
      <style>
        body{font-family:Arial,sans-serif;margin:40px;color:#111;background:#fff}
        h1{color:#1e1b4b;border-bottom:3px solid #7c3aed;padding-bottom:10px}
        h2{color:#374151;margin-top:24px}
        h3{color:#4b5563;margin-top:20px}
        .badge{display:inline-block;padding:8px 20px;border-radius:8px;font-size:18px;font-weight:bold;color:#fff;background:${statusColor};margin:10px 0}
        table{width:100%;border-collapse:collapse;margin-top:10px}
        td{padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px}
        td:first-child{color:#6b7280;width:45%}
        .val{font-weight:600;font-family:monospace}
        .section{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0}
        .reasons li{padding:4px 0}
        .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px}
        @media print{body{margin:20px}}
      </style></head><body>
      <h1>⬡ ETH Fraud Shield — Transaction Report</h1>
      <p style="color:#6b7280">Generated: ${new Date().toLocaleString()} | Model: XGBoost (2.97M Ethereum wallets)</p>
      <div class="badge">${statusText}</div>
      <div class="section">
        <h3>Transaction Details</h3>
        <table><tbody>
          <tr><td>Transaction ID</td><td class="val">${esc(result.tx_hash)}</td></tr>
          <tr><td>Sender Address</td><td class="val">${esc(result.sender)}</td></tr>
          <tr><td>Receiver Address</td><td class="val">${esc(result.receiver)}</td></tr>
          <tr><td>Amount</td><td class="val">${esc(result.amount)} ETH</td></tr>
          <tr><td>Timestamp</td><td class="val">${esc(result.timestamp||new Date().toISOString())}</td></tr>
          <tr><td>Blockchain Hash</td><td class="val">${esc(result.blockchain_hash||'Simulated')}</td></tr>
          <tr><td>Block Number</td><td class="val">${esc(result.block_number||'Pending')}</td></tr>
        </tbody></table>
      </div>
      <div class="section">
        <h3>AI Fraud Analysis</h3>
        <table><tbody>
          <tr><td>Receiver Risk Score</td><td class="val" style="color:${statusColor}">${pct(result.fraud_probability)}</td></tr>
          <tr><td>Normal Probability</td><td class="val" style="color:#16a34a">${pct(result.normal_probability)}</td></tr>
          <tr><td>Dynamic Threshold</td><td class="val" style="color:#d97706">${pct(result.threshold)}</td></tr>
          <tr><td>Risk Level</td><td class="val">${(result.risk_level||'').toUpperCase()}</td></tr>
          <tr><td>Confirmation</td><td class="val">${result.requires_confirmation?'USER CONFIRMATION':'AUTO PROCEED'}</td></tr>
          <tr><td>Confirmation Level</td><td class="val">${(result.confirmation_level||'low').toUpperCase()}</td></tr>
          <tr><td>Decision</td><td class="val" style="color:${statusColor}">${result.decision}</td></tr>
          <tr><td>Action Taken</td><td class="val" style="color:${statusColor}">${result.action}</td></tr>
          <tr><td>Model Used</td><td class="val">XGBoost — Ethereum Phishing Dataset (2.97M nodes)</td></tr>
          <tr><td>Threshold Reason</td><td class="val">${result.threshold_reason||'—'}</td></tr>
        </tbody></table>
      </div>
      ${recvSection}
      <div class="section">
        <h3>AI Explanation</h3>
        <ul class="reasons">${reasons||'<li>No explanation available</li>'}</ul>
      </div>
      <div class="footer">
        <p>ETH Fraud Shield — AI + Blockchain Fraud Detection System</p>
        <p>XGBoost model trained on Ethereum Phishing Transaction Network dataset (Kaggle)</p>
        <p>This report is generated for demonstration and research purposes.</p>
      </div>
      <script>window.onload=()=>window.print()</script>
      </body></html>`)
      w.document.close()
    }finally{setExportingPDF(false)}
  }

  function loadScenario(s,r,a){setSender(s||walletAddr||'');setRecipient(r);setAmount(String(a));setMessage('Scenario loaded — click Analyze Transaction.')}

  // History-driven preview for the transaction form
  function getHistoryPreview(){
    return {label:'HISTORY',color:'#7c3aed',desc:'Receiver wallet history drives the model score'}
  }

  const safeCount  = stats?(stats.total_transactions-stats.fraud_detected):0
  const fraudCount = stats?.fraud_detected??0
  const pieData    = safeCount+fraudCount>0
    ?[{name:'Safe',value:safeCount},{name:'Fraud/Review',value:fraudCount}]
    :[{name:'No data',value:1}]
  const approvedWalletTxs = walletTxList.filter(tx => String(tx.action || '').startsWith('APPROVE'))
  const confirmationResult = pendingTx && lastResult ? lastResult : null
  const confirmationHistory = [...riskHistory].slice(-6).reverse()
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
  const amountRule=getHistoryPreview(amount)

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
          {['overview','transaction','blockchain','alerts'].map(t=>(
            <button key={t} className={`nav-tab ${tab===t?'active':''}`} onClick={()=>setTab(t)}>
              {t==='alerts'&&alerts.length>0?<>{t.charAt(0).toUpperCase()+t.slice(1)} <span className="alert-dot">{alerts.length}</span></>:t.charAt(0).toUpperCase()+t.slice(1)}
            </button>
          ))}
        </div>
        <div className="nav-right">
          <span className={`net-badge ${chainLive?'live':''}`}><span className="status-dot connected-dot"/>{chainLive?'Blockchain Live':'Offline'}</span>
          {walletAddr
            ?<div className="wallet-info-pill">
                <span className="wallet-network">{network}</span>
                <span className="wallet-bal">
                  {balance} ETH
                  {balanceDiff&&<span className={`bal-diff ${parseFloat(balanceDiff)>0?'pos':'neg'}`}>
                    {parseFloat(balanceDiff)>0?'+':''}{balanceDiff}
                  </span>}
                </span>
                <span className="wallet-addr">{compactAddr}</span>
              </div>
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
              <p className="hero-copy">XGBoost trained on Ethereum wallet behavior. The model scores wallet history, counterparties, activity timing, and transfer patterns. No fixed amount bands.</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={handleConnect} disabled={connStatus==='connecting'}>{connStatus==='connected'?'Reconnect wallet':connStatus==='connecting'?'Connecting...':'Connect MetaMask'}</button>
                <div className="address-chip">{compactAddr}</div>
              </div>
            </section>

            {/* AI history legend */}
            <div className="amount-rules-bar">
              <span className="rule-item safe">History patterns</span>
              <span className="rule-arrow">→</span>
              <span className="rule-item freeze">AI model score</span>
              <span className="rule-arrow">→</span>
              <span className="rule-item block">Decision from wallet behavior</span>
              <span className="rule-note">Model inputs are built from sender history during the transaction</span>
            </div>

            <section className="panel-grid">
              {[
                {label:'Total Transactions',  value:stats?.total_transactions??0,   color:'#818cf8'},
                {label:'Fraud Detected',       value:stats?.fraud_detected??0,       color:'#ef4444'},
                {label:'Review Required',      value:stats?.transactions_blocked??0, color:'#ef4444'},
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
                    <thead><tr>{['TX Hash','Sender','Receiver','Amount','Receiver Score','Threshold','Risk','Decision','Action'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {txList.length===0?<tr><td colSpan={10} className="empty-row">No transactions yet. Use the Analyze tab.</td></tr>
                    :txList.map((tx,i)=>{const fp=parseFloat(tx.fraud_probability),th=parseFloat(tx.threshold);return(
                      <tr key={i}>
                        <td>
                          <span style={{display:'flex',alignItems:'center',gap:6}}>
                            <span className="mono muted">{short(tx.tx_hash)}</span>
                            {tx.blockchain_hash&&(
                              <button
                                onClick={()=>{
                                  navigator.clipboard.writeText(tx.blockchain_hash)
                                  setTab('alerts')
                                  setTimeout(()=>{
                                    const inp=document.getElementById('verifyInput')
                                    if(inp){inp.value=tx.blockchain_hash;inp.scrollIntoView({behavior:'smooth',block:'center'});inp.focus()}
                                  },300)
                                  const t=document.createElement('div')
                                  t.textContent='✓ Hash copied — verify in Alerts tab'
                                  t.style.cssText='position:fixed;bottom:24px;right:24px;background:#7c3aed;color:#fff;padding:8px 14px;border-radius:8px;font-size:11px;z-index:9999;font-family:monospace'
                                  document.body.appendChild(t)
                                  setTimeout(()=>t.remove(),2000)
                                }}
                                style={{background:'none',border:'1px solid #7c3aed40',color:'#a855f7',borderRadius:4,padding:'1px 6px',fontSize:9,cursor:'pointer',fontFamily:'inherit'}}
                                title="Copy blockchain hash and go to verifier"
                              >⎘</button>
                            )}
                          </span>
                        </td>
                        <td className="mono muted">{short(tx.sender)}</td>
                        <td className="mono muted">{short(tx.receiver)}</td>
                        <td className="mono" style={{color:'#818cf8',fontWeight:600}}>{fmtEth(tx.amount)}</td>
                        <td className="mono" style={{color:fp>th?'#ef4444':'#22c55e',fontWeight:600}}>{pct(tx.fraud_probability)}</td>
                        <td className="mono amber">{pct(tx.threshold)}</td>
                        <td><span className={`risk-badge ${tx.risk_level}`}>{(tx.risk_level||'').toUpperCase()}</span></td>
                        <td><span className={`decision-badge ${(tx.decision||'').toLowerCase()}`}>{tx.decision}</span></td>
                        <td><span className={`action-badge ${String(tx.action||'').includes('REVIEW')?'warn':tx.action==='BLOCK'||tx.action==='BLOCK_AND_BLACKLIST'?'block':'approve'}`}>{tx.action}</span></td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* ═══════ ANALYZE ═══════ */}
        {tab==='transaction'&&(
          <div className="wallet-dashboard">
            <section className="hero-card">
              <div className={`status-badge ${connStatus}`}><span className="status-dot"/>{statusLabel}</div>
              <p className="eyebrow">AI-Powered Transaction Analysis</p>
              <h1>Submit a transaction to detect phishing.</h1>
              <p className="hero-copy">XGBoost scores the wallet’s transaction history and the current transfer features. The model does not depend on fixed amount bands.</p>
              <div className="hero-actions">
                <button className="primary-button" onClick={handleConnect} disabled={connStatus==='connecting'}>{connStatus==='connected'?'Reconnect wallet':'Connect MetaMask'}</button>
                <div className="address-chip">{compactAddr}</div>
                {walletAddr&&(
                  <div className="hero-balance-card">
                    <div className="hero-bal-label">ETH Balance ({network})</div>
                    <div className="hero-bal-value">
                      {balance} <span>ETH</span>
                      {balanceDiff&&<span className={`bal-diff ${parseFloat(balanceDiff)>0?'pos':'neg'}`}>{parseFloat(balanceDiff)>0?'+':''}{balanceDiff}</span>}
                    </div>
                    {prevBalance&&prevBalance!==balance&&<div className="hero-bal-prev">Prev: {prevBalance} ETH</div>}
                  </div>
                )}
              </div>
            </section>

            <section className="panel-grid" style={{gridTemplateColumns:'1fr 1fr'}}>
              <article className="info-panel">
                <div className="panel-label">Wallet Address</div>
                <div className="panel-value address-value">{walletAddr??'Waiting for connection'}</div>
              </article>
              <article className="info-panel">
                <div className="panel-label">ETH Balance {network&&<span style={{color:'#7c3aed',fontSize:10,marginLeft:6}}>({network})</span>}</div>
                <div className="panel-value balance-value">
                  {balance} <span>ETH</span>
                  {balanceDiff&&<span className={`bal-diff ${parseFloat(balanceDiff)>0?'pos':'neg'}`} style={{fontSize:13,marginLeft:10}}>
                    {parseFloat(balanceDiff)>0?'+':''}{balanceDiff} ETH
                  </span>}
                </div>
                {prevBalance&&prevBalance!==balance&&(
                  <div style={{fontSize:11,color:'#475569',marginTop:4}}>Previous: {prevBalance} ETH</div>
                )}
              </article>
            </section>

            {/* Wallet Transaction Summary */}
            {walletTxList.length>0&&(
              <section className="send-panel" style={{marginBottom:0}}>
                <div className="panel-header">
                  <div><p className="eyebrow muted">Wallet Activity</p><h2>Your Transaction History</h2></div>
                  <div className="panel-note">{walletTxList.length} transactions</div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:16}}>
                  {[
                    {label:'Total TX',        value:walletTxList.length,                                              color:'#818cf8'},
                    {label:'Total Sent',      value:`${approvedWalletTxs.reduce((s,t)=>s+parseFloat(t.amount||0),0).toFixed(3)} ETH`, color:'#22c55e'},
                    {label:'Review Required',  value:walletTxList.filter(t=>String(t.action||'').includes('REVIEW')||t.action==='BLOCK'||t.action==='BLOCK_AND_BLACKLIST').length, color:'#f59e0b'},
                    {label:'Avg Fraud Score', value:`${(walletTxList.reduce((s,t)=>s+parseFloat(t.fraud_probability||0),0)/walletTxList.length*100).toFixed(1)}%`, color:'#a855f7'},
                  ].map(({label,value,color})=>(
                    <div key={label} style={{background:'#0a0f1e',border:'1px solid #1e1e2e',borderRadius:8,padding:'10px 14px'}}>
                      <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>{label}</div>
                      <div style={{fontSize:20,fontWeight:700,color,fontFamily:'monospace'}}>{value}</div>
                    </div>
                  ))}
                </div>
                <div className="table-wrap">
                  <table className="tx-table">
                    <thead><tr>{['TX Hash','Amount','Fraud Score','Threshold','Decision','Action','Time'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {walletTxList.slice(0,5).map((tx,i)=>{
                        const fp=parseFloat(tx.fraud_probability),th=parseFloat(tx.threshold)
                        return(
                          <tr key={i}>
                            <td className="mono muted">{short(tx.tx_hash)}</td>
                            <td className="mono" style={{color:'#818cf8',fontWeight:600}}>{fmtEth(tx.amount)} ETH</td>
                            <td className="mono" style={{color:fp>th?'#ef4444':'#22c55e',fontWeight:600}}>{pct(tx.fraud_probability)}</td>
                            <td className="mono amber">{pct(tx.threshold)}</td>
                            <td><span className={`decision-badge ${(tx.decision||'').toLowerCase()}`}>{tx.decision}</span></td>
                            <td><span className={`action-badge ${String(tx.action||'').includes('REVIEW')?'warn':tx.action==='BLOCK'||tx.action==='BLOCK_AND_BLACKLIST'?'block':'approve'}`}>{tx.action}</span></td>
                            <td className="muted small">{tx.timestamp?new Date(tx.timestamp).toLocaleTimeString():'—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

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
                      History preview: <strong>{amountRule.label}</strong> — {amountRule.desc}
                    </div>}
                  </label>
                </div>
                <div className="form-actions">
                  <button className="primary-button" onClick={handleAnalyze} disabled={sending}>{sending?'Analyzing...':'Analyze Transaction'}</button>
                  <p className="message-text">{message}</p>
                </div>
                <div style={{marginTop:20}}>
                  <p className="eyebrow muted" style={{marginBottom:10}}>AI Demo Flow</p>
                  <button className="scenario-btn" onClick={runFraudDemo} style={{borderColor:'#ef444455'}}>
                    <span>Seed suspicious wallet history and analyze fraud</span>
                    <span style={{color:'#ef4444'}} className="mono">RUN DEMO</span>
                  </button>
                  <button className="scenario-btn" onClick={()=>loadScenario(walletAddr||'0xAAA...001','0xBBB...001',0.5)}>
                    <span>Normal baseline transaction</span>
                    <span style={{color:'#22c55e'}} className="mono">AI SCORE</span>
                  </button>
                  {[
                    ['Suspicious history tx — 2.5 ETH',      walletAddr||'0xAAA...001','0xBBB...001', 2.5 ],
                    ['Clean wallet tx — 0.5 ETH',           walletAddr||'0xAAA...001','0xBBB...001', 0.5 ],
                  ].map(([label,s,r,a])=>(
                    <button key={label} className="scenario-btn" onClick={()=>loadScenario(s,r,a)}>
                      <span>{label}</span>
                      <span style={{color:'#7c3aed'}} className="mono">{a} ETH</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Result + Explanation + New Features Panel */}
              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                <section className="send-panel">
                  <div className="panel-header">
                    <div><p className="eyebrow muted">AI Analysis Result</p><h2>Fraud Detection Output</h2></div>
                    {lastResult&&<button className="export-btn" onClick={()=>exportPDF(lastResult)} disabled={exportingPDF}>{exportingPDF?'Generating...':'⬇ Export PDF'}</button>}
                  </div>
                  {!lastResult
                    ?<div className="empty-result"><div className="empty-hex">⬡</div><p>Submit a transaction to see AI analysis here</p></div>
                    :<>
                      <div className={`result-banner ${lastResult.action?.includes('REVIEW')?'frozen':'approved'}`}>
                        <div className="result-title">{lastResult.action?.includes('REVIEW')?'⚠️ REVIEW REQUIRED':'✅ APPROVED'}</div>
                        <div className="result-action">{lastResult.action}</div>
                      </div>
                      <div className="prob-bar-wrap">
                        <div className="prob-bar-labels"><span>Receiver Risk Score</span><span style={{color:parseFloat(lastResult.fraud_probability)>parseFloat(lastResult.threshold)?'#ef4444':'#22c55e',fontWeight:700}}>{pct(lastResult.fraud_probability)}</span></div>
                        <div className="prob-bar-track">
                          <div className="prob-bar-fill" style={{width:`${Math.min(parseFloat(lastResult.fraud_probability)*100,100)}%`,background:parseFloat(lastResult.fraud_probability)>0.7?'#ef4444':parseFloat(lastResult.fraud_probability)>0.4?'#f59e0b':'#22c55e'}}/>
                          <div className="prob-threshold-marker" style={{left:`${Math.min(parseFloat(lastResult.threshold)*100,100)}%`}}/>
                        </div>
                        <div style={{fontSize:10,color:'#475569',marginTop:4}}>▲ Dynamic threshold at {pct(lastResult.threshold)}</div>
                      </div>
                      <div className="result-rows">
                        {[
                          ['Transaction ID',    lastResult.tx_hash,               'accent'],
                          ['Receiver Risk Score', pct(lastResult.fraud_probability), parseFloat(lastResult.fraud_probability)>parseFloat(lastResult.threshold)?'red':'green'],
                          ['Normal Probability',pct(lastResult.normal_probability),'green'],
                          ['Dynamic Threshold', pct(lastResult.threshold),         'amber'],
                          ['Confirmation',      lastResult.requires_confirmation?'USER CONFIRMATION':'AUTO PROCEED', lastResult.requires_confirmation?'amber':'green'],
                          ['Confirmation Level',lastResult.confirmation_level||'low', lastResult.confirmation_level==='high'?'red':lastResult.confirmation_level==='medium'?'amber':'green'],
                          ['Risk Level',        (lastResult.risk_level||'').toUpperCase(),'purple'],
                          ['Decision',          lastResult.decision,               lastResult.decision==='FRAUDULENT'||lastResult.decision==='SUSPICIOUS'?'red':'green'],
                          ['Model Used',        'XGBoost (2.97M Ethereum wallets)','muted'],
                          ['Block Number',      lastResult.block_number?'#'+lastResult.block_number:'Pending','purple'],
                        ].map(([k,v,c])=>(
                          <div key={k} className="result-row"><span className="result-key">{k}</span><span className={`result-val ${c}`}>{v}</span></div>
                        ))}
                        {/* Blockchain hash with copy + verify button */}
                        <div className="result-row" style={{alignItems:'center'}}>
                          <span className="result-key">Blockchain Hash</span>
                          <span style={{display:'flex',alignItems:'center',gap:8}}>
                            <span className="result-val accent mono" style={{fontSize:11}}>{short(lastResult.blockchain_hash)||'Simulated'}</span>
                            {lastResult.blockchain_hash&&(
                              <button
                                onClick={()=>{
                                  navigator.clipboard.writeText(lastResult.blockchain_hash)
                                  // Switch to alerts tab and fill verifier
                                  setTab('alerts')
                                  setTimeout(()=>{
                                    const inp=document.getElementById('verifyInput')
                                    if(inp){
                                      inp.value=lastResult.blockchain_hash
                                      inp.scrollIntoView({behavior:'smooth',block:'center'})
                                      inp.focus()
                                    }
                                  },300)
                                  // Toast
                                  const t=document.createElement('div')
                                  t.textContent='✓ Hash copied — verify in Alerts tab'
                                  t.style.cssText='position:fixed;bottom:24px;right:24px;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;font-size:12px;z-index:9999;font-family:monospace'
                                  document.body.appendChild(t)
                                  setTimeout(()=>t.remove(),2500)
                                }}
                                style={{background:'#7c3aed20',border:'1px solid #7c3aed60',color:'#a855f7',borderRadius:6,padding:'3px 10px',fontSize:10,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}
                              >⎘ Copy & Verify</button>
                            )}
                          </span>
                        </div>
                      </div>
                    </>
                  }
                </section>

                {/* AI Explanation */}
                {lastResult?.explanation?.length>0&&(
                  <section className="send-panel explanation-panel">
                    <div className="panel-header"><div><p className="eyebrow muted">Explainable AI</p><h2>AI Explanation</h2></div></div>
                    <div className="explanation-header">
                      <div className="exp-tx">Transaction ID: <span className="accent mono">{lastResult.tx_hash}</span></div>
                      <div className="exp-row"><span className="exp-label">Receiver Risk Score:</span><span style={{color:parseFloat(lastResult.fraud_probability)>parseFloat(lastResult.threshold)?'#ef4444':'#22c55e',fontWeight:700}}>{pct(lastResult.fraud_probability)}</span></div>
                      <div className="exp-row"><span className="exp-label">Dynamic Threshold:</span><span className="amber" style={{fontWeight:700}}>{pct(lastResult.threshold)}</span></div>
                      <div className="exp-row"><span className="exp-label">Decision:</span>
                        <span className={`exp-decision ${lastResult.action?.includes('REVIEW')?'amber':'green'}`}>
                          {lastResult.action?.includes('REVIEW')?'⚠️ REVIEW REQUIRED':'✅ APPROVED'}
                        </span>
                      </div>
                    </div>
                    <div className="exp-divider">AI Explanation:</div>
                    <div className="exp-reasons">
                      {lastResult.explanation.map((r,i)=>(
                        <div key={i} className="exp-reason">
                          <span className={`exp-check ${lastResult.action?.includes('REVIEW')?'amber':'green'}`}>{lastResult.action?.includes('REVIEW')?'!':'✔'}</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Receiver Risk Analysis */}
                {receiverRisk&&(
                  <section className="send-panel" style={{border:`1px solid ${parseFloat(receiverRisk.fraud_score)>0.5?'#ef444440':'#22c55e40'}`}}>
                    <div className="panel-header">
                      <div><p className="eyebrow muted">Receiver Wallet Analysis</p><h2>Receiver Risk Score</h2></div>
                      <span className={`risk-badge ${receiverRisk.risk_level}`}>{(receiverRisk.risk_level||'').toUpperCase()}</span>
                    </div>
                    <div className="prob-bar-wrap" style={{marginBottom:12}}>
                      <div className="prob-bar-labels"><span>Receiver Fraud Score</span><span style={{color:parseFloat(receiverRisk.fraud_score)>0.5?'#ef4444':'#22c55e',fontWeight:700}}>{pct(receiverRisk.fraud_score)}</span></div>
                      <div className="prob-bar-track">
                        <div className="prob-bar-fill" style={{width:`${Math.min(parseFloat(receiverRisk.fraud_score)*100,100)}%`,background:parseFloat(receiverRisk.fraud_score)>0.5?'#ef4444':'#22c55e'}}/>
                      </div>
                    </div>
                    <div className="result-rows">
                      {[
                        ['Receiver Address',  short(receiverRisk.address),      'accent'],
                        ['Fraud Score',       pct(receiverRisk.fraud_score),     parseFloat(receiverRisk.fraud_score)>0.5?'red':'green'],
                        ['Risk Level',        (receiverRisk.risk_level||'').toUpperCase(),'purple'],
                        ['Known TX Count',    receiverRisk.tx_count||'0',        'muted'],
                        ['Unique Senders',    receiverRisk.recv_unique||'0',     'muted'],
                        ['High Fan-out',      receiverRisk.high_fan_out?'YES — Suspicious':'No',receiverRisk.high_fan_out?'red':'green'],
                        ['Only Receives',     receiverRisk.zero_recv?'Yes — Suspicious':'No',  receiverRisk.zero_recv?'amber':'green'],
                      ].map(([k,v,c])=>(
                        <div key={k} className="result-row"><span className="result-key">{k}</span><span className={`result-val ${c}`}>{v}</span></div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Wallet Risk Score History Graph */}
                {riskHistory.length>1&&(
                  <section className="send-panel">
                    <div className="panel-header">
                      <div><p className="eyebrow muted">Dynamic Threshold Evolution</p><h2>Wallet Risk Score History</h2></div>
                      <div className="panel-note">{riskHistory.length} transactions</div>
                    </div>
                    <ResponsiveContainer width="100%" height={180}>
                      <AreaChart data={riskHistory}>
                        <defs>
                          <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.4}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
                          <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient>
                        </defs>
                        <XAxis dataKey="tx" tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false} domain={[0,100]}/>
                        <Tooltip contentStyle={{background:'#111118',border:'1px solid #1e1e2e',borderRadius:8,fontSize:12}} formatter={(v,n)=>[`${v}%`,n==='score'?'Fraud Score':'Threshold']}/>
                        <Area type="monotone" dataKey="score"     stroke="#ef4444" fill="url(#rg)" strokeWidth={2} dot={{fill:'#ef4444',r:4}} name="score"/>
                        <Area type="monotone" dataKey="threshold" stroke="#f59e0b" fill="url(#tg)" strokeWidth={2} strokeDasharray="4 2" dot={{fill:'#f59e0b',r:3}} name="threshold"/>
                      </AreaChart>
                    </ResponsiveContainer>
                    <div style={{display:'flex',gap:16,justifyContent:'center',marginTop:8,fontSize:11,color:'#475569'}}>
                      <span><span style={{color:'#ef4444'}}>●</span> Fraud Score</span>
                      <span><span style={{color:'#f59e0b'}}>- -</span> Dynamic Threshold</span>
                      <span style={{color:'#334155',fontSize:10}}>Threshold adapts per transaction history</span>
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
              <p className="eyebrow">Blockchain Layer — Phase 1+2+3</p>
              <h1>Immutable fraud records + threshold anchoring.</h1>
              <p className="hero-copy">
                Every transaction, threshold value, and AI decision is stored on-chain.
                Dynamic threshold evolution is verifiable by anyone. Model hash proves AI was never tampered.
              </p>
            </section>

            <section className="panel-grid">
              {[
                {label:'RPC Endpoint',     value:'http://127.0.0.1:7545'},
                {label:'Latest Block',     value:ganacheBlk!=null?`#${ganacheBlk}`:blockInfo?.block_number?`#${blockInfo.block_number}`:'—'},
                {label:'Total TX Records', value:txList.length},
                {label:'Contract',         value:'FraudDetection.sol v2'},
              ].map(({label,value})=>(
                <article key={label} className="info-panel"><div className="panel-label">{label}</div><div className="panel-value address-value" style={{fontSize:13,color:'#818cf8'}}>{value}</div></article>
              ))}
            </section>

            {/* Phase 3: Model Integrity Panel */}
            <section className="send-panel" style={{border:`1px solid ${modelIntegrity?.verified?'#22c55e40':'#f59e0b40'}`}}>
              <div className="panel-header">
                <div><p className="eyebrow muted">Phase 3 — AI Security</p><h2>Model Hash Verification</h2></div>
                <span style={{fontSize:12,padding:'4px 12px',borderRadius:20,
                  background:modelIntegrity?.verified?'#22c55e18':'#f59e0b18',
                  color:modelIntegrity?.verified?'#22c55e':'#f59e0b',
                  border:`1px solid ${modelIntegrity?.verified?'#22c55e40':'#f59e0b40'}`}}>
                  {modelIntegrity?.verified?'✓ VERIFIED':'⚠ SIMULATED'}
                </span>
              </div>
              <div className="result-rows">
                {[
                  ['Status',        modelIntegrity?.status||'Loading...',          modelIntegrity?.verified?'green':'amber'],
                  ['Current Hash',  modelIntegrity?.current_hash?.slice(0,20)+'...'||'—','accent'],
                  ['Stored On-chain',modelIntegrity?.verified?'Yes — matches blockchain':'Simulated mode','muted'],
                  ['Model Version', 'XGBoost-v1.0-EthPhishing',                   'purple'],
                  ['Tamper Proof',  modelIntegrity?.verified?'✓ Hash verified on Ethereum':'Deploy contract for real verification','muted'],
                ].map(([k,v,c])=>(
                  <div key={k} className="result-row"><span className="result-key">{k}</span><span className={`result-val ${c}`}>{v}</span></div>
                ))}
              </div>
              <div style={{fontSize:11,color:'#475569',marginTop:10,padding:'8px 12px',background:'#ffffff06',borderRadius:8}}>
                Every Flask restart computes sha256(fraud_model.pkl) and stores it on-chain.
                If the model file is modified between restarts, this hash will mismatch — proving tampering.
              </div>
            </section>

            {/* Phase 5: Threshold History from Blockchain */}
            {(chainThreshHistory.length>0||walletAddr)&&(
              <section className="send-panel" style={{border:'1px solid #7c3aed40'}}>
                <div className="panel-header">
                  <div><p className="eyebrow muted">Phase 2 + 5 — Tamper-Proof Threshold</p><h2>Dynamic Threshold History — From Blockchain</h2></div>
                  <div style={{display:'flex',gap:8,alignItems:'center'}}>
                    <div className="panel-note">{chainThreshHistory.length} records on-chain</div>
                    {walletAddr&&<button className="export-btn" onClick={()=>fetchChainThresholdHistory(walletAddr)}>↻ Refresh</button>}
                  </div>
                </div>
                {chainThreshHistory.length===0
                  ?<div style={{color:'#475569',textAlign:'center',padding:'24px',fontSize:13}}>
                      No on-chain threshold records yet. Deploy FraudDetection.sol to Ganache and analyze transactions to see threshold evolution here.
                    </div>
                  :<>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={chainThreshHistory.map((h,i)=>({
                        tx        : `TX${i+1}`,
                        threshold : parseFloat((h.threshold*100).toFixed(1)),
                        score     : parseFloat((h.fraud_score*100).toFixed(1)),
                        amount    : parseFloat(h.amount_eth?.toFixed(3)||0),
                      }))}>
                        <defs>
                          <linearGradient id="tg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={0.4}/><stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/></linearGradient>
                          <linearGradient id="sg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
                        </defs>
                        <XAxis dataKey="tx" tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false}/>
                        <YAxis tick={{fill:'#475569',fontSize:10}} axisLine={false} tickLine={false} domain={[0,100]}/>
                        <Tooltip contentStyle={{background:'#111118',border:'1px solid #1e1e2e',borderRadius:8,fontSize:12}} formatter={(v,n)=>[`${v}%`,n==='threshold'?'Threshold':'Fraud Score']}/>
                        <Area type="monotone" dataKey="threshold" stroke="#7c3aed" fill="url(#tg2)" strokeWidth={2} dot={{fill:'#7c3aed',r:4}} name="threshold"/>
                        <Area type="monotone" dataKey="score"     stroke="#ef4444" fill="url(#sg2)" strokeWidth={2} strokeDasharray="4 2" dot={{fill:'#ef4444',r:3}} name="score"/>
                      </AreaChart>
                    </ResponsiveContainer>
                    <div style={{display:'flex',gap:16,justifyContent:'center',marginTop:8,fontSize:11,color:'#475569'}}>
                      <span><span style={{color:'#7c3aed'}}>●</span> Dynamic Threshold (on-chain)</span>
                      <span><span style={{color:'#ef4444'}}>- -</span> Fraud Score</span>
                    </div>
                    <div style={{marginTop:12,fontSize:11,color:'#475569',padding:'8px 12px',background:'#7c3aed08',border:'1px solid #7c3aed20',borderRadius:8}}>
                      ⬡ This graph is pulled directly from Ethereum blockchain state — not from SQLite.
                      Each data point is immutably anchored. The threshold evolution cannot be forged.
                    </div>
                    {/* Threshold chain table */}
                    <div className="table-wrap" style={{marginTop:12}}>
                      <table className="tx-table">
                        <thead><tr>{['TX #','Threshold','Fraud Score','Amount','Prev Hash','Time'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                        <tbody>
                          {chainThreshHistory.map((h,i)=>(
                            <tr key={i}>
                              <td className="mono" style={{color:'#818cf8'}}>TX{i+1}</td>
                              <td className="mono amber">{(h.threshold*100).toFixed(1)}%</td>
                              <td className="mono" style={{color:h.fraud_score>h.threshold?'#ef4444':'#22c55e'}}>{(h.fraud_score*100).toFixed(1)}%</td>
                              <td className="mono" style={{color:'#818cf8'}}>{parseFloat(h.amount_eth||0).toFixed(3)} ETH</td>
                              <td className="mono muted" style={{fontSize:10}}>{h.prev_hash?.slice(0,16)}...</td>
                              <td className="muted small">{h.time_str}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                }
              </section>
            )}

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
                          <div style={{display:'flex',gap:6,alignItems:'center'}}>
                            <span className={`action-badge ${block.action==='BLOCK'||block.action==='BLOCK_AND_BLACKLIST'?'block':block.action==='FREEZE'?'freeze':'approve'}`} style={{fontSize:9}}>{block.action}</span>
                            <button
                              onClick={()=>{
                                navigator.clipboard.writeText(block.blockchain_hash||'')
                                // Auto-fill verifier input
                                const inp=document.getElementById('verifyInput')
                                if(inp){inp.value=block.blockchain_hash||'';inp.focus()}
                                // Show toast
                                const t=document.createElement('div')
                                t.textContent='✓ Hash copied & ready to verify'
                                t.style.cssText='position:fixed;bottom:24px;right:24px;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;font-size:12px;z-index:9999;font-family:monospace;animation:fadeIn .3s'
                                document.body.appendChild(t)
                                setTimeout(()=>t.remove(),2500)
                              }}
                              style={{background:'#7c3aed20',border:'1px solid #7c3aed60',color:'#a855f7',borderRadius:6,padding:'3px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}
                            >⎘ Copy & Verify</button>
                          </div>
                        </div>
                        <div className="chain-meta">
                          <div className="chain-field">
                            <span className="chain-label">TX Hash</span>
                            <span style={{display:'flex',alignItems:'center',gap:6}}>
                              <span className="chain-val accent">{short(block.tx_hash)}</span>
                              <button onClick={()=>navigator.clipboard.writeText(block.tx_hash||'')} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:11,padding:'0 2px'}} title="Copy TX Hash">⎘</button>
                            </span>
                          </div>
                          <div className="chain-field">
                            <span className="chain-label">Block Hash</span>
                            <span style={{display:'flex',alignItems:'center',gap:6}}>
                              <span className="chain-val accent">{short(block.blockchain_hash)}</span>
                              <button onClick={()=>{
                                navigator.clipboard.writeText(block.blockchain_hash||'')
                                const inp=document.getElementById('verifyInput')
                                if(inp){inp.value=block.blockchain_hash||''}
                              }} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',fontSize:11,padding:'0 2px'}} title="Copy & fill verifier">⎘</button>
                            </span>
                          </div>
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

            {/* Smart Contract Events — persistent from DB */}
            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">Smart Contract</p><h2>FraudDetection.sol Events</h2></div>
                <div className="panel-note">{scEvents.length} events (persistent)</div>
              </div>
              {scEvents.length===0
                ?<div className="empty-result"><p>No events yet. Analyze a receiver wallet with medium/high risk to trigger a review.</p></div>
                :scEvents.map((ev,i)=>(
                  <div key={i} className="sc-event">
                    <div className="sc-fn">{ev.fn||ev.fn}</div>
                    <div className="sc-meta">
                      <span>Sender: <span className="accent">{short(ev.sender)}</span></span>
                      <span>Amount: <span style={{color:'#818cf8'}}>{ev.amount} ETH</span></span>
                      <span>Score: <span className="red">{ev.score}</span></span>
                      <span>Threshold: <span className="amber">{ev.threshold||ev.thresh}</span></span>
                      <span>Block: <span className="purple">{ev.block_num||ev.block||'—'}</span></span>
                      <span className="muted">{ev.timestamp?new Date(ev.timestamp).toLocaleTimeString():ev.time}</span>
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
                <span style={{marginLeft:16,color:'#475569',fontStyle:'italic'}}>// Wallet behavior drives the threshold; no fixed amount bands</span><br/>
                <span style={{marginLeft:16}}><span className="kw">uint256 public</span> dynamicThreshold = <span className="str">0</span>;</span><br/><br/>
                <span style={{marginLeft:16}}><span className="kw">function</span> <span className="fn">logTransaction</span>(</span><br/>
                <span style={{marginLeft:32,color:'#64748b'}}>string txHash, address sender,</span><br/>
                <span style={{marginLeft:32,color:'#64748b'}}>uint256 amountWei, uint256 fraudScore, string decision</span><br/>
                <span style={{marginLeft:16}}>) <span className="kw">public onlyOwner</span> {'{'}</span><br/>
                <span style={{marginLeft:32}}><span className="kw">if</span>(fraudScore {'>'} dynamicThreshold) {'{'}</span><br/>
                <span style={{marginLeft:48}} className="fn">reviewTransaction(sender);</span><br/>
                <span style={{marginLeft:32}}>{'}'} <span className="kw">else</span> {'{'}</span><br/>
                <span style={{marginLeft:48}} className="fn">approveTransaction(sender);</span><br/>
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
              <p className="hero-copy">All alerts persist across page refreshes. Blacklist viewer, gas analytics, network stats, and TX receipt verifier included.</p>
            </section>
            <section className="panel-grid">
              {[
                {label:'Total Alerts',      value:alerts.length,                  color:'#ef4444'},
                {label:'Blocked / Frozen',  value:stats?.transactions_blocked??0, color:'#f59e0b'},
                {label:'Fraud Detected',    value:stats?.fraud_detected??0,       color:'#a855f7'},
                {label:'Total TX',          value:stats?.total_transactions??0,   color:'#818cf8'},
                {label:'Active Wallets',    value:stats?.active_wallets??0,       color:'#22c55e'},
              ].map(({label,value,color})=>(
                <article key={label} className="info-panel"><div className="panel-label">{label}</div><div className="panel-value" style={{color}}>{value}</div></article>
              ))}
            </section>

            <section className="send-panel">
              <div className="panel-header">
                <div><p className="eyebrow muted">Fraud Alerts (Persistent)</p><h2>Blocked & Frozen Transactions</h2></div>
                <div style={{display:'flex',gap:8}}>
                  <button className="export-btn" onClick={fetchAlertsFromDB}>↻ Refresh</button>
                  {alerts.length>0&&<button className="clear-btn" onClick={clearAlertsDB}>Clear All</button>}
                </div>
              </div>
              {alerts.length===0
                ?<div className="empty-result"><div className="empty-hex">🛡</div><p>No alerts yet. Try a receiver wallet with risky history in the Analyze tab.</p></div>
                :alerts.map((a,i)=>(
                  <div key={i} className={`alert-item ${a.type==='warn'?'alert-warn':''}`}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <span style={{fontSize:18}}>{a.type==='warn'?'🧊':'⚠'}</span><span>{a.text}</span>
                    </div>
                    <span className="muted small" style={{whiteSpace:'nowrap'}}>{a.timestamp?new Date(a.timestamp).toLocaleTimeString():a.time}</span>
                  </div>
                ))
              }
            </section>

            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">Blacklist Management</p><h2>Blacklisted Wallets</h2></div><div className="panel-note">{blacklist.length} wallets</div></div>
              {blacklist.length===0
                ?<div style={{color:'#475569',padding:'16px',textAlign:'center',fontSize:13}}>No blacklisted wallets. Wallets auto-blacklist when fraud score exceeds 88%.</div>
                :blacklist.map((w,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 0',borderBottom:'1px solid #1e1e2e50',fontSize:12}}>
                    <div><div className="mono accent">{w.address}</div><div style={{color:'#475569',fontSize:11,marginTop:2}}>{w.reason} · {w.added_at?new Date(w.added_at).toLocaleString():''}</div></div>
                    <button onClick={()=>removeFromBlacklist(w.address)} style={{background:'#ef444418',border:'1px solid #ef444440',color:'#ef4444',borderRadius:6,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>Remove</button>
                  </div>
                ))
              }
            </section>

            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">Gas Analytics</p><h2>Blockchain Gas Usage</h2></div></div>
              {gasAnalytics
                ?<>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
                    {[{label:'Total Gas',value:gasAnalytics.total_gas_used?.toLocaleString()||'0',color:'#818cf8'},{label:'Avg Gas/TX',value:gasAnalytics.avg_gas_per_tx?.toLocaleString()||'0',color:'#22c55e'},{label:'Total TX',value:gasAnalytics.total_tx||0,color:'#a855f7'}].map(({label,value,color})=>(
                      <div key={label} style={{background:'#0a0f1e',border:'1px solid #1e1e2e',borderRadius:8,padding:'12px 14px'}}>
                        <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:1,marginBottom:6}}>{label}</div>
                        <div style={{fontSize:20,fontWeight:700,color,fontFamily:'monospace'}}>{value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="table-wrap"><table className="tx-table">
                    <thead><tr>{['Action','Count','Gas Each','Total Gas'].map(h=><th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{(gasAnalytics.breakdown||[]).map((b,i)=>(
                      <tr key={i}>
                        <td><span className={`action-badge ${b.action?.startsWith('BLOCK')?'block':b.action==='FREEZE'?'freeze':b.action?.includes('WARNING')?'warn':'approve'}`}>{b.action}</span></td>
                        <td className="mono" style={{color:'#818cf8'}}>{b.count}</td>
                        <td className="mono muted">{b.gas_each?.toLocaleString()}</td>
                        <td className="mono" style={{color:'#22c55e'}}>{b.total_gas?.toLocaleString()}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                </>
                :<div style={{color:'#475569',padding:20,textAlign:'center'}}>Loading...</div>
              }
            </section>

            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">Ganache Network</p><h2>Network Statistics</h2></div>
                <span className={`net-badge ${networkStats?.connected?'live':''}`}><span className="status-dot connected-dot"/>{networkStats?.connected?'Live':'Offline'}</span>
              </div>
              {networkStats?.connected
                ?<>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:16}}>
                    {[
                      {label:'Block Number',    value:`#${networkStats.block_number||'—'}`,     color:'#818cf8'},
                      {label:'Gas Price',       value:`${networkStats.gas_price_gwei||0} Gwei`, color:'#22c55e'},
                      {label:'Gas Utilization', value:`${networkStats.gas_utilization||0}%`,    color:'#f59e0b'},
                      {label:'Pending TX',      value:networkStats.pending_tx||0,               color:'#a855f7'},
                      {label:'Total Accounts',  value:networkStats.total_accounts||0,           color:'#818cf8'},
                      {label:'Network ID',      value:networkStats.network_id||'—',             color:'#22c55e'},
                    ].map(({label,value,color})=>(
                      <div key={label} style={{background:'#0a0f1e',border:'1px solid #1e1e2e',borderRadius:8,padding:'10px 14px'}}>
                        <div style={{fontSize:10,color:'#475569',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>{label}</div>
                        <div style={{fontSize:16,fontWeight:700,color,fontFamily:'monospace'}}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {networkStats.accounts?.length>0&&(<>
                    <div style={{fontSize:11,color:'#475569',letterSpacing:1,textTransform:'uppercase',marginBottom:8}}>Ganache Accounts</div>
                    {networkStats.accounts.map((acc,i)=>(
                      <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid #1e1e2e40',fontSize:12}}>
                        <span className="mono muted">{short(acc.address)}</span>
                        <span className="mono" style={{color:'#22c55e',fontWeight:700}}>{acc.balance} ETH</span>
                      </div>
                    ))}
                  </>)}
                </>
                :<div style={{color:'#475569',padding:20,textAlign:'center',fontSize:13}}>Start Ganache on port 7545 to see network stats.</div>
              }
            </section>

            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">On-chain Verification</p><h2>Transaction Receipt Verifier</h2></div></div>
              <div style={{display:'flex',gap:10,marginBottom:16}}>
                <input className="form-input" placeholder="Enter blockchain hash to verify on Ganache..." style={{flex:1}} value={verifyHash} onChange={e=>setVerifyHash(e.target.value)}/>
                <button className="primary-button" style={{whiteSpace:'nowrap'}} onClick={async()=>{
                  const hash=verifyHash.trim()
                  if(!hash){return}
                  try{const res=await fetch(`${API}/verify/${hash}`);const d=await res.json();setVerifyResult(d)}catch(_){setVerifyResult({verified:false,message:'Backend not reachable'})}
                }}>Verify</button>
              </div>
              {verifyResult&&(
                <div style={{background:verifyResult.verified?'#22c55e12':'#ef444412',border:`1px solid ${verifyResult.verified?'#22c55e40':'#ef444440'}`,borderRadius:10,padding:16}}>
                  <div style={{fontSize:13,fontWeight:700,color:verifyResult.verified?'#22c55e':'#ef4444',marginBottom:10}}>{verifyResult.verified?'✓ VERIFIED ON-CHAIN':'✗ SIMULATED / NOT FOUND'}</div>
                  {[['TX Hash',verifyResult.tx_hash],['Status',verifyResult.status],['Block',verifyResult.block_number?'#'+verifyResult.block_number:'—'],['Confirmations',verifyResult.confirmations!=null?verifyResult.confirmations+' blocks':'—'],['Gas Used',verifyResult.gas_used?.toLocaleString()||'—'],['Message',verifyResult.message||'']].filter(([,v])=>v).map(([k,v])=>(
                    <div key={k} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'5px 0',borderBottom:'1px solid #ffffff10'}}>
                      <span style={{color:'#64748b'}}>{k}</span><span style={{fontFamily:'monospace',color:'#e2e8f0'}}>{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="send-panel">
              <div className="panel-header"><div><p className="eyebrow muted">System</p><h2>System Events</h2></div></div>
              {[
                {ev:`Flask API running — ${API}`,ok:true},
                {ev:'XGBoost — Ethereum Phishing Dataset (2.97M nodes)',ok:true},
                {ev:'SQLite — transactions, alerts, events all persisted',ok:true},
                {ev:'History-driven review replaces fixed amount rules',ok:true},
                {ev:'Dynamic threshold engine — per-wallet adaptation',ok:true},
                {ev:`Blockchain — Ganache ${chainLive?'connected port 7545':'offline'}`,ok:chainLive},
                {ev:`MetaMask ${connStatus==='connected'?'connected: '+compactAddr:'not connected'}`,ok:connStatus==='connected'},
                {ev:`Alerts: ${alerts.length} stored · SC Events: ${scEvents.length} stored`,ok:true},
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
      {pendingTx&&(
        <div className="confirmation-overlay" style={{position:'fixed',inset:0,background:'rgba(2,6,23,.72)',backdropFilter:'blur(10px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999,padding:24}}>
          <div style={{width:'min(1180px,100%)',maxHeight:'95vh',overflowY:'auto',background:'#0b1020',border:'1px solid #334155',borderRadius:22,boxShadow:'0 24px 80px rgba(0,0,0,.45)',padding:24}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,marginBottom:18}}>
              <div>
                <div style={{fontSize:12,color:'#f59e0b',textTransform:'uppercase',letterSpacing:1}}>Receiver Review</div>
                <h2 style={{margin:'6px 0 0',fontSize:24,color:'#fff'}}>Confirm this transaction?</h2>
                <div style={{marginTop:8,color:'#cbd5e1',fontSize:14}}>
                  Review the receiver risk, threshold, and blockchain details before sending the transfer on-chain.
                </div>
              </div>
              <button className="export-btn" onClick={()=>confirmPendingTransaction(false)} disabled={sending}>Cancel</button>
            </div>
            <div style={{marginTop:18,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12}}>
              <div style={{padding:14,background:'#111827',border:'1px solid #1f2937',borderRadius:14}}>
                <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.8}}>Status</div>
                <div style={{marginTop:6,fontSize:18,fontWeight:700,color:'#f59e0b'}}>{confirmationResult?.action?.includes('REVIEW') ? 'REVIEW REQUIRED' : 'APPROVED'}</div>
              </div>
              <div style={{padding:14,background:'#111827',border:'1px solid #1f2937',borderRadius:14}}>
                <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.8}}>Receiver Risk Score</div>
                <div style={{marginTop:6,fontSize:18,fontWeight:700,color:'#fff'}}>{confirmationResult ? pct(confirmationResult.fraud_probability) : '—'}</div>
              </div>
              <div style={{padding:14,background:'#111827',border:'1px solid #1f2937',borderRadius:14}}>
                <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.8}}>Dynamic Threshold</div>
                <div style={{marginTop:6,fontSize:18,fontWeight:700,color:'#fff'}}>{confirmationResult ? pct(confirmationResult.threshold) : '—'}</div>
              </div>
              <div style={{padding:14,background:'#111827',border:'1px solid #1f2937',borderRadius:14}}>
                <div style={{fontSize:11,color:'#94a3b8',textTransform:'uppercase',letterSpacing:.8}}>Confirmation Level</div>
                <div style={{marginTop:6,fontSize:18,fontWeight:700,color:'#fff'}}>{(confirmationResult?.confirmation_level||'high').toUpperCase()}</div>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1.2fr .8fr',gap:16,marginTop:18}}>
              <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:16,padding:16}}>
                <h3 style={{margin:'0 0 12px',color:'#fff',fontSize:16}}>Fraud Detection Output</h3>
                <table style={{width:'100%',borderCollapse:'collapse',color:'#e2e8f0',fontSize:13}}>
                  <tbody>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Transaction ID</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult?.tx_hash || pendingTx.tx_hash || '—'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Receiver Risk Score</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult ? pct(confirmationResult.fraud_probability) : '—'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Normal Probability</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult ? pct(confirmationResult.normal_probability) : '—'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Dynamic Threshold</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult ? pct(confirmationResult.threshold) : '—'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Decision</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right',color:'#f59e0b'}}>{confirmationResult?.decision || '—'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Risk Level</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{(confirmationResult?.risk_level||'').toUpperCase() || '—'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Model Used</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult?.model_used || 'XGBoost (2.97M Ethereum wallets)'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Block Number</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult?.block_number || 'Pending'}</td></tr>
                    <tr><td style={{padding:'8px 0',color:'#94a3b8'}}>Blockchain Hash</td><td style={{padding:'8px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult?.blockchain_hash || 'Simulated'}</td></tr>
                  </tbody>
                </table>
              </div>

              <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:16,padding:16}}>
                <h3 style={{margin:'0 0 12px',color:'#fff',fontSize:16}}>Transaction Review</h3>
                <div style={{display:'grid',gap:10,color:'#e2e8f0',fontSize:13}}>
                  <div style={{padding:12,background:'#111827',borderRadius:12}}>Confirmation: {confirmationResult?.requires_confirmation ? 'USER CONFIRMATION' : 'AUTO PROCEED'}</div>
                  <div style={{padding:12,background:'#111827',borderRadius:12}}>Confirmation Level: {(confirmationResult?.confirmation_level || 'high').toUpperCase()}</div>
                  <div style={{padding:12,background:'#111827',borderRadius:12}}>Amount: {pendingTx.amount} ETH</div>
                  <div style={{padding:12,background:'#111827',borderRadius:12}}>Sender: {short(pendingTx.sender)}</div>
                  <div style={{padding:12,background:'#111827',borderRadius:12}}>Receiver: {short(pendingTx.receiver)}</div>
                </div>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:16}}>
              <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:16,padding:16}}>
                <h3 style={{margin:'0 0 12px',color:'#fff',fontSize:16}}>Receiver Wallet Analysis</h3>
                {receiverRisk ? (
                  <table style={{width:'100%',borderCollapse:'collapse',color:'#e2e8f0',fontSize:13}}>
                    <tbody>
                      <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Receiver Address</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{short(receiverRisk.address)}</td></tr>
                      <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Receiver Fraud Score</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{pct(receiverRisk.fraud_score)}</td></tr>
                      <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Receiver Risk Level</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{(receiverRisk.risk_level||'').toUpperCase() || '—'}</td></tr>
                      <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Known TX Count</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{receiverRisk.tx_count}</td></tr>
                      <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Unique Senders</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{receiverRisk.recv_unique}</td></tr>
                      <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>High Fan-out</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{receiverRisk.high_fan_out ? 'YES — Suspicious' : 'No'}</td></tr>
                      <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Only Receives</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{receiverRisk.zero_recv ? 'Yes — Suspicious' : 'No'}</td></tr>
                    </tbody>
                  </table>
                ) : (
                  <div style={{color:'#94a3b8'}}>Receiver analysis is not available yet.</div>
                )}
              </div>

              <div style={{background:'#0f172a',border:'1px solid #334155',borderRadius:16,padding:16}}>
                <h3 style={{margin:'0 0 12px',color:'#fff',fontSize:16}}>Dynamic Threshold Evolution</h3>
                {confirmationHistory.length ? (
                  <>
                    <div style={{height:220,marginBottom:12}}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={confirmationHistory.slice().reverse()}>
                          <XAxis dataKey="tx" tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false} />
                          <YAxis tick={{fill:'#64748b',fontSize:11}} axisLine={false} tickLine={false} domain={[0,100]} />
                          <Tooltip contentStyle={{background:'#0f172a',border:'1px solid #334155',borderRadius:12,color:'#e2e8f0'}} />
                          <Area type="monotone" dataKey="score" stroke="#f87171" fill="url(#thresholdFillPopup)" strokeWidth={2} dot={{r:3}} />
                          <Area type="monotone" dataKey="threshold" stroke="#f59e0b" fill="transparent" strokeDasharray="5 5" strokeWidth={2} dot={{r:3}} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{display:'grid',gap:10}}>
                      {confirmationHistory.map((item, idx) => (
                        <div key={`${item.tx}-${idx}`} style={{padding:12,background:'#111827',borderRadius:12,border:'1px solid #1f2937'}}>
                          <div style={{display:'flex',justifyContent:'space-between',gap:12,color:'#e2e8f0',fontSize:13}}>
                            <span style={{fontFamily:'monospace'}}>{item.tx}</span>
                            <span style={{color:'#94a3b8'}}>{item.time}</span>
                          </div>
                          <div style={{marginTop:8,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,fontSize:12,color:'#cbd5e1'}}>
                            <div>Fraud: {item.score}%</div>
                            <div>Threshold: {item.threshold}%</div>
                            <div>Amount: {fmtEth(item.amount)} ETH</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{color:'#94a3b8'}}>No threshold history preview available yet.</div>
                )}
              </div>
            </div>

            {confirmationResult?.explanation?.length ? (
              <div style={{marginTop:16,background:'#0f172a',border:'1px solid #334155',borderRadius:16,padding:16}}>
                <h3 style={{margin:'0 0 12px',color:'#fff',fontSize:16}}>AI Explanation</h3>
                <ul style={{margin:0,paddingLeft:18,color:'#e2e8f0',lineHeight:1.6}}>
                  {confirmationResult.explanation.map((reason, idx) => <li key={idx}>{reason}</li>)}
                </ul>
              </div>
            ) : null}

            <div style={{marginTop:16,background:'#0f172a',border:'1px solid #334155',borderRadius:16,padding:16}}>
              <h3 style={{margin:'0 0 12px',color:'#fff',fontSize:16}}>Analysis Summary</h3>
              <table style={{width:'100%',borderCollapse:'collapse',color:'#e2e8f0',fontSize:13}}>
                <tbody>
                  <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Transaction ID</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult?.tx_hash || pendingTx.tx_hash || '—'}</td></tr>
                  <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Sender Address</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{short(pendingTx.sender)}</td></tr>
                  <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Receiver Address</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{short(pendingTx.receiver)}</td></tr>
                  <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Receiver Risk Score</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult ? pct(confirmationResult.fraud_probability) : '—'}</td></tr>
                  <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Dynamic Threshold</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult ? pct(confirmationResult.threshold) : '—'}</td></tr>
                  <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Decision</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right',color:'#f59e0b'}}>{confirmationResult?.decision || '—'}</td></tr>
                  <tr><td style={{padding:'7px 0',color:'#94a3b8'}}>Confirmation</td><td style={{padding:'7px 0',fontFamily:'monospace',textAlign:'right'}}>{confirmationResult?.requires_confirmation ? 'USER CONFIRMATION' : 'AUTO PROCEED'}</td></tr>
                </tbody>
              </table>
            </div>

            <svg width="0" height="0" style={{position:'absolute'}} aria-hidden="true">
              <defs>
                <linearGradient id="thresholdFillPopup" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f87171" stopOpacity={0.35}/>
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0.03}/>
                </linearGradient>
              </defs>
            </svg>

            <div style={{display:'flex',gap:12,justifyContent:'flex-end',marginTop:24}}>
              <button className="scenario-btn" onClick={()=>confirmPendingTransaction(false)} disabled={sending}>Cancel transaction</button>
              <button className="primary-button" onClick={()=>confirmPendingTransaction(true)} disabled={sending}>{sending?'Completing...':'Yes, proceed'}</button>
            </div>
          </div>
        </div>
      )}
      </main>
    </div>
  )
}
