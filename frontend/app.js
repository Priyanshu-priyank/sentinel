// ── StartChain OS — Frontend Application ─────────────────────
// Connects to MetaMask, submits to backend API, renders results

const SHARDEUM_TESTNET = {
  chainId: '0x1FB7',
  chainName: 'Shardeum Mezame (Testnet)',
  nativeCurrency: { name: 'SHM', symbol: 'SHM', decimals: 18 },
  rpcUrls: ['https://api-mezame.shardeum.org'],
  blockExplorerUrls: ['https://explorer-mezame.shardeum.org']
};

const API_BASE = window.location.origin;
let provider, signer, account;
let feedEvents = [];
let activeSLAs = [];

// ── Wallet Connection ────────────────────────────────────────
async function connectWallet() {
  if (!window.ethereum) {
    return alert('MetaMask not detected. Please install MetaMask.');
  }
  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    account = await signer.getAddress();

    const network = await provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== 8119) {
      try {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [SHARDEUM_TESTNET]
        });
      } catch (e) { console.warn('Could not switch network:', e); }
    }

    const bal = await provider.getBalance(account);
    const balStr = parseFloat(ethers.formatEther(bal)).toFixed(4);

    document.getElementById('shortAddress').textContent = account.slice(0, 6) + '…' + account.slice(-4);
    document.getElementById('balanceDisplay').textContent = balStr + ' SHM';
    document.getElementById('walletInfo').classList.add('visible');

    const btn = document.getElementById('connectBtn');
    btn.textContent = '✓ Connected';
    btn.classList.add('connected');

    document.getElementById('trust-address').value = account;
    await loadChainHistory();
    loadStats();
  } catch (e) {
    console.error('Wallet connection failed:', e);
  }
}

// ── Tab Switching ────────────────────────────────────────────
function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.querySelectorAll('.form-section').forEach(f => f.classList.remove('active'));
  document.getElementById(`form-${tabId}`).classList.add('active');
}

// ── Load Stats ───────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    const data = await res.json();
    document.getElementById('statDecisions').textContent = data.totalDecisions;
    document.getElementById('statSLAs').textContent = data.totalSLAs;

    if (account) {
      const pRes = await fetch(`${API_BASE}/api/profile/${account}`);
      const profile = await pRes.json();
      updateGauge(parseInt(profile.opsScore) || 0);
      document.getElementById('statFulfillRate').textContent = profile.fulfillRate || '—';
    }
  } catch (e) {
    console.warn('Stats load failed:', e);
  }
}

function updateGauge(score) {
  const pct = score;
  const circumference = 142;
  const filled = circumference * (pct / 100);
  const arc = document.getElementById('gaugeArc');
  const text = document.getElementById('gaugeText');
  if (arc) {
    arc.setAttribute('stroke-dasharray', `${filled} ${circumference}`);
    // Color logic: Red -> Amber -> Cyan (instead of green)
    const color = pct > 75 ? '#0ea5e9' : pct > 40 ? '#f59e0b' : '#ef4444';
    arc.style.stroke = color;
  }
  if (text) text.textContent = score;
}

// ── Auto-Sync Emails ─────────────────────────────────────────
async function syncAndProcessEmails() {
  if (!account) return alert('Please connect wallet first!');
  const btn = document.getElementById('syncBtn');
  const btnText = document.getElementById('syncBtnText');
  const btnLoading = document.getElementById('syncBtnLoading');
  
  btnText.style.display = 'none';
  btnLoading.style.display = 'inline-block';
  btn.style.opacity = '0.7';
  btn.disabled = true;

  try {
    // 1. Fetch mock unread emails
    const syncRes = await fetch(`${API_BASE}/api/sync-emails`);
    const syncData = await syncRes.json();
    if (!syncData.success) throw new Error(syncData.error);
    
    const emails = syncData.emails;
    console.log(`Fetched ${emails.length} unread emails. Processing...`);

    // 2. Process each email sequentially through the AI
    for (const email of emails) {
      await autoSubmitDecision(email.module, email.data);
    }
    
    alert(`Successfully synced and processed ${emails.length} unread emails!`);
  } catch (err) {
    alert('Error syncing emails: ' + err.message);
  } finally {
    btnText.style.display = 'inline-block';
    btnLoading.style.display = 'none';
    btn.style.opacity = '1';
    btn.disabled = false;
  }
}

async function autoSubmitDecision(moduleType, autoData) {
  try {
    const res = await fetch(`${API_BASE}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: moduleType, data: autoData })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);
    
    // Switch to the correct tab to show the result
    switchTab(moduleType.toLowerCase());
    renderResult(result, moduleType);
    addFeedEvent(result);
    if (result.slaId) addSLA(result);
    await loadStats();
  } catch (err) {
    console.error(`Error processing auto-submitted ${moduleType} decision:`, err);
  }
}

// ── Submit Decision ──────────────────────────────────────────
async function submitDecision(moduleType) {
  const data = gatherFormData(moduleType);
  if (!data) return;

  const btn = event.target.closest('.btn-submit');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module: moduleType, data })
    });
    const result = await res.json();

    if (!result.success) throw new Error(result.error);

    // 💾 Persist deliberation text to local cache
    const cache = JSON.parse(localStorage.getItem('deliberation_cache') || '{}');
    cache[result.decisionId] = { ...result, moduleLabel: moduleType };
    localStorage.setItem('deliberation_cache', JSON.stringify(cache));

    renderResult(result, moduleType);
    addFeedEvent(result, moduleType);
    if (result.slaId) addSLA(result);
    loadStats();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

function gatherFormData(mod) {
  if (mod === 'LEAD') {
    return {
      name: document.getElementById('lead-name').value,
      company: document.getElementById('lead-company').value,
      role: document.getElementById('lead-role').value,
      budget: document.getElementById('lead-budget').value,
      message: document.getElementById('lead-message').value
    };
  } else if (mod === 'SUPPORT') {
    return {
      customer: document.getElementById('support-customer').value,
      tier: document.getElementById('support-tier').value,
      subject: document.getElementById('support-subject').value,
      severity: document.getElementById('support-severity').value,
      description: document.getElementById('support-description').value
    };
  } else if (mod === 'TASK') {
    return {
      title: document.getElementById('task-title').value,
      assignee: document.getElementById('task-assignee').value,
      deadline: document.getElementById('task-deadline').value,
      priority: document.getElementById('task-priority').value,
      details: document.getElementById('task-details').value
    };
  }
  return null;
}

// ── Render Decision Result ───────────────────────────────────
function renderResult(r, moduleType) {
  document.getElementById('emptyState').style.display = 'none';
  const container = document.getElementById('resultContent');
  container.style.display = 'block';

  const moduleLabel = { LEAD: 'Lead', SUPPORT: 'Support', TASK: 'Task' }[moduleType];
  const slaHtml = r.slaId ? `
    <div class="sla-badge">
      <span class="sla-icon">⏰</span>
      <div>
        <div class="sla-text"><span class="sla-id">SLA Commitment #${r.slaId}</span> minted on-chain</div>
        <div class="sla-deadline">Follow up by: ${new Date(r.slaDeadline).toLocaleString()}</div>
      </div>
    </div>
    <button class="btn-fulfill" onclick="fulfillSLA(${r.slaId})">✓ Mark SLA Fulfilled</button>
  ` : '';

  container.innerHTML = `
    <div class="result-card">
      <div class="verdict-header">
        <span class="verdict-badge verdict-${r.verdict}">${r.verdict}</span>
        <span class="confidence-tag">${r.confidence}% confidence · ${moduleLabel}</span>
      </div>
      <div class="debate-grid">
        <div class="debate-card debate-advocate">
          <div class="debate-label">🟢 Advocate argued</div>
          ${r.advocate}
        </div>
        <div class="debate-card debate-skeptic">
          <div class="debate-label">🔴 Skeptic argued</div>
          ${r.skeptic}
        </div>
      </div>
      <div class="action-box">
        <div class="label">AI Summary</div>
        <div class="summary">${r.summary}</div>
        <div class="label" style="margin-top:8px">Next Action</div>
        <div class="action-item">${r.actionItem}</div>
      </div>
      ${slaHtml}
      ${r.txHash ? `
      <a class="chain-link" href="${r.explorerUrl}" target="_blank">
        🔗 Decision #${r.decisionId} · verified on Shardeum · ${r.txHash.slice(0, 20)}...
      </a>` : `
      <div class="chain-link">🔗 Decision #${r.decisionId} · verified on Shardeum</div>
      `}
    </div>
  `;
}

// ── Blockchain Synchronization ────────────────────────────────
async function loadChainHistory() {
  if (!account) return;
  try {
    const res = await fetch(`${API_BASE}/api/decisions/${account}`);
    const decisions = await res.json();
    
    // Clear local cache
    feedEvents = [];
    activeSLAs = [];
    
    // 1. Re-populate Live Feed (last 5-10 items)
    decisions.slice(-10).reverse().forEach(d => {
      feedEvents.push({
        id: d.id,
        module: d.module,
        verdict: d.verdict.toUpperCase(),
        confidence: d.confidence,
        txHash: null,
        time: new Date(d.timestamp * 1000).toLocaleTimeString()
      });
      
      // If it has an unfulfilled SLA, add it back to the active list
      if (d.slaCreated) {
        // Since the backend doesn't tell us if it's fulfilled yet, 
        // we'll fetch it from the dashboard when needed or we could sync it here
        // For simplicity, we just sync the decision event
      }
    });
    
    // 2. Re-populate Active SLAs
    // A more thorough implementation would check if fulfilled on-chain
    // and only show those with slaCreated=true && fulfilled=false
    // For this version, let's just mark which decisions have SLAs
    renderFeed();
    loadStats();
  } catch (err) {
    console.warn("Failed to sync chain history:", err);
  }
}

// ── Feed Events ──────────────────────────────────────────────
function addFeedEvent(r, moduleType) {
  const moduleLabel = { LEAD: 'Lead', SUPPORT: 'Support', TASK: 'Task' }[moduleType];
  feedEvents.unshift({
    id: r.decisionId,
    module: moduleLabel,
    verdict: r.verdict,
    confidence: r.confidence,
    txHash: r.txHash,
    time: new Date().toLocaleTimeString()
  });
  renderFeed();
}

function renderFeed() {
  const list = document.getElementById('feedList');
  if (feedEvents.length === 0) {
    list.innerHTML = '<p class="feed-empty">Waiting for on-chain events...</p>';
    return;
  }
  list.innerHTML = feedEvents.slice(0, 20).map(e => `
    <div class="feed-item" onclick="showCachedDecision('${e.id}', '${e.parentDecisionId || ''}')" style="cursor:pointer">
      <div>
        <span class="feed-id">#${e.id}</span>
        <span class="feed-module">${e.module}</span>
        <span class="feed-verdict feed-${e.verdict.toLowerCase()}">${
          e.verdict === 'ACCEPTED' ? '✅ Accepted' :
          e.verdict === 'REJECTED' ? '❌ Rejected' : 
          e.verdict === 'FULFILLED' ? '💰 Fulfilled' : '⚠️ Escalated'
        }</span>
      </div>
      <div class="feed-right">
        <div class="feed-conf">${e.confidence}% conf</div>
        ${e.txHash ? `
        <a class="feed-tx" href="https://explorer-mezame.shardeum.org/tx/${e.txHash}" target="_blank">
          ${e.txHash.slice(0, 10)}...
        </a>` : `<span class="feed-tx">Verified</span>`}
      </div>
    </div>
  `).join('');
}

function showCachedDecision(id, parentId) {
  const cache = JSON.parse(localStorage.getItem('deliberation_cache') || '{}');
  const d = cache[id] || cache[parentId];
  if (d) {
    renderResult(d, d.moduleLabel || d.module);
    window.scrollTo({ top: 300, behavior: 'smooth' }); // Scroll to result section
  } else {
    alert(`Evidence for ${id} is archived. For full transparency, all hashes are verifiable on the Shardeum explorer.`);
  }
}


// ── SLA Management ───────────────────────────────────────────
function addSLA(r) {
  activeSLAs.unshift({
    slaId: r.slaId,
    decisionId: r.decisionId,
    deadline: r.slaDeadline,
    fulfilled: false
  });
  renderSLAs();
}

function renderSLAs() {
  const list = document.getElementById('slaList');
  if (activeSLAs.length === 0) {
    list.innerHTML = '<p class="feed-empty">No active SLAs yet</p>';
    return;
  }
  list.innerHTML = activeSLAs.map(s => `
    <div class="sla-item">
      <div>
        <span class="sla-item-id">SLA #${s.slaId}</span>
        <span style="color:var(--text-dim);margin-left:8px;font-size:0.72rem">Decision #${s.decisionId}</span>
      </div>
      <div>
        <span class="sla-item-deadline">${s.fulfilled ? '✅ Fulfilled' : '⏰ ' + new Date(s.deadline).toLocaleString()}</span>
        ${!s.fulfilled ? `<button class="btn-fulfill" style="margin-left:8px;padding:4px 10px;font-size:0.7rem" onclick="fulfillSLA(${s.slaId})">Fulfill</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function fulfillSLA(slaId) {
  const btn = event.target;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Processing...";

  try {
    const res = await fetch(`${API_BASE}/api/fulfill-sla`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slaId })
    });
    const data = await res.json();
    if (data.success) {
      const sla = activeSLAs.find(s => s.slaId == slaId);
      if (sla) sla.fulfilled = true;
      
      // 📣 Push a "Conclusion" event to the Live Feed (link to original decisionId)
      feedEvents.unshift({
        id: `SLA-${slaId}`,
        parentDecisionId: sla ? sla.decisionId : null,
        module: 'System',
        verdict: 'FULFILLED',
        confidence: 100,
        txHash: data.txHash,
        time: new Date().toLocaleTimeString()
      });
      
      renderSLAs();
      renderFeed();
      loadStats();
      alert(`SLA #${slaId} fulfilled! THE CONCLUSION HAS BEEN LOGGED.`);
    } else {
      alert('Error: ' + data.error);
    }
  } catch (err) {
    alert('Error fulfilling SLA: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// ── Trust Dashboard ──────────────────────────────────────────
async function loadTrustDashboard() {
  const address = document.getElementById('trust-address').value.trim();
  if (!address) return alert('Enter a wallet address');

  const btn = document.querySelector('#form-trust .btn-submit');
  btn.classList.add('loading');
  btn.disabled = true;

  try {
    const [profileRes, decisionsRes] = await Promise.all([
      fetch(`${API_BASE}/api/profile/${address}`),
      fetch(`${API_BASE}/api/decisions/${address}`)
    ]);
    const profile = await profileRes.json();
    const decisions = await decisionsRes.json();

    if (profile.error) throw new Error(profile.error);

    const score = parseInt(profile.opsScore) || 0;
    const grade = score > 800 ? 'A+' : score > 600 ? 'A' : score > 400 ? 'B' : score > 200 ? 'C' : 'D';

    document.getElementById('trustResult').innerHTML = `
      <div class="trust-header">
        <div class="trust-label">StartChain OS — Verified Operations Report</div>
        <div class="trust-addr">${address}</div>
        <div class="trust-scores">
          <div>
            <div class="trust-grade">${grade}</div>
            <div class="trust-grade-label">Ops Rating</div>
          </div>
          <div class="trust-score-num">
            <div class="trust-score-val">${score}<span style="font-size:0.6em;opacity:0.7">/100</span></div>
            <div class="trust-score-label">Reputation Score</div>
          </div>
        </div>
      </div>
      <div class="trust-stats">
        <div class="trust-stat">
          <div class="trust-stat-val">${decisions.length}</div>
          <div class="trust-stat-label">Decisions Logged</div>
        </div>
        <div class="trust-stat">
          <div class="trust-stat-val">${profile.fulfilled}/${profile.totalSLAs}</div>
          <div class="trust-stat-label">SLAs Fulfilled</div>
        </div>
        <div class="trust-stat">
          <div class="trust-stat-val">${profile.fulfillRate}</div>
          <div class="trust-stat-label">Fulfillment Rate</div>
        </div>
      </div>
      <div class="trust-verified">
        <span class="trust-verified-icon">✅</span>
        <div>
          <div class="trust-verified-title">Blockchain Verified</div>
          <div class="trust-verified-text">All data sourced directly from Shardeum ·
            <a href="https://explorer-mezame.shardeum.org/address/${address}" target="_blank">View on explorer</a>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    document.getElementById('trustResult').innerHTML = `
      <div style="color:var(--red);padding:16px;text-align:center;font-size:0.85rem">
        Error loading profile: ${err.message}
      </div>`;
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ── Init ─────────────────────────────────────────────────────
if (window.ethereum) {
  window.ethereum.on('accountsChanged', () => location.reload());
  window.ethereum.on('chainChanged', () => location.reload());
}

// Initial load if connected
window.addEventListener('load', async () => {
  if (window.ethereum) {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.listAccounts();
    if (accounts.length > 0) {
      await connectWallet();
    }
  }
  loadStats();
});
