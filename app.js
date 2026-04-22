/* ═══════════════════════════════════════════════════════════
   app.js — TES Pro (Merged: App A UI + App B Firebase/Paystack)
   ───────────────────────────────────────────────────────────
   Keeps ALL App A features: Checklist, Journal, Analytics,
   Fundamentals (Macro Bias + Currency Strength), Trainer,
   Settings, Streak, etc.
   Imports from App B: Firebase Auth, Paystack, Subscription,
   Risk Calculator, stability fixes.
   Removed: Screenshot system (no image fields).
   Pricing: $15 monthly, $120 annually.
   ═══════════════════════════════════════════════════════════ */

'use strict';

/* ─── CONSTANTS (from App B) ──────────────────────────────── */
const SUB_MS = {
  monthly: 30  * 24 * 60 * 60 * 1000,
  annual:  365 * 24 * 60 * 60 * 1000
};

/* ─── GLOBAL STATE ────────────────────────────────────────── */
let currentUser = null;        // Firebase user object
let currentUserData = null;    // profile with subscription info
let trades = [];
let trainerState = { score:0, streak:0, total:0, correct:0, currentQ:null, answered:false };
let equityChart = null, distChart = null, winrateChart = null;
let checklistState = {};
let tradeOutcome = '';
let tradeTags = [];
let journalFilter = 'all';
let pendingTrade = null;
let weeklyBiasDraft = {};

/* ═══════════════════════════════════════════════════════════
   UTILITIES (Toast, Storage, DOM helpers)
   ═══════════════════════════════════════════════════════════ */
function showToast(msg, type = 'success') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function getStorage(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch(e) { return null; }
}
function setStorage(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
}
function getUserKey(k) { return 'tes_' + (currentUser?.uid || 'guest') + '_' + k; }
function getUserData(k, def = []) {
  if (!currentUser) return def;
  const val = getStorage(getUserKey(k));
  return (val !== null && val !== undefined) ? val : def;
}
function setUserData(k, v) {
  if (!currentUser) return;
  setStorage(getUserKey(k), v);
}

/* ═══════════════════════════════════════════════════════════
   SUBSCRIPTION SYSTEM (from App B)
   ═══════════════════════════════════════════════════════════ */
function subRead(uid) {
  try { return JSON.parse(localStorage.getItem('tes_sub_' + uid)); } catch { return null; }
}
function subWrite(uid, sub) {
  localStorage.setItem('tes_sub_' + uid, JSON.stringify(sub));
}
function grantAccess(plan) {
  if (!currentUser) return;
  const sub = { status: 'active', plan: plan, expiresAt: Date.now() + SUB_MS[plan] };
  subWrite(currentUser.uid, sub);
  currentUserData = { uid: currentUser.uid, email: currentUser.email, paymentStatus: 'paid', plan, expiresAt: sub.expiresAt };
  showToast('Subscription activated! Welcome to TES Pro 🎉', 'success');
  launchApp();
}
function checkSubscription() {
  if (!currentUser) return false;
  const sub = subRead(currentUser.uid);
  if (sub && sub.status === 'active' && Date.now() < sub.expiresAt) {
    currentUserData = { uid: currentUser.uid, email: currentUser.email, paymentStatus: 'paid', plan: sub.plan, expiresAt: sub.expiresAt };
    return true;
  }
  currentUserData = { uid: currentUser.uid, email: currentUser.email, paymentStatus: 'free' };
  return false;
}

/* ═══════════════════════════════════════════════════════════
   PAYSTACK INTEGRATION (from App B)
   ═══════════════════════════════════════════════════════════ */
function initiatePaystack(plan) {
  if (!currentUser) { showToast('Please sign in first.', 'error'); return; }
  const key = typeof PAYSTACK_PUBLIC_KEY !== 'undefined' ? PAYSTACK_PUBLIC_KEY : '';
  const rate = typeof USD_TO_NGN !== 'undefined' ? USD_TO_NGN : 1500;
  const prices = typeof PLAN_PRICES_USD !== 'undefined' ? PLAN_PRICES_USD : { monthly: 15, annual: 120 };
  const usd = prices[plan] || 15;
  const ngn = usd * rate;
  const kobo = Math.round(ngn * 100);

  if (!key || key.startsWith('pk_test_')) {
    showToast(`[Test] Simulating ${plan} payment…`, 'warning');
    setTimeout(() => grantAccess(plan), 900);
    return;
  }
  const openPopup = () => {
    PaystackPop.setup({
      key, email: currentUser.email, amount: kobo, currency: 'NGN',
      ref: 'TES_' + currentUser.uid + '_' + Date.now(),
      metadata: { uid: currentUser.uid, plan },
      callback: () => grantAccess(plan),
      onClose: () => showToast('Payment window closed.', 'warning')
    }).openIframe();
  };
  if (typeof PaystackPop !== 'undefined') openPopup();
  else {
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.onload = openPopup;
    script.onerror = () => showToast('Could not load Paystack.', 'error');
    document.head.appendChild(script);
  }
}

/* ═══════════════════════════════════════════════════════════
   FIREBASE AUTH (from App B)
   ═══════════════════════════════════════════════════════════ */
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  if (!email || !pass) { errEl.textContent = 'Enter email and password.'; errEl.style.display = 'block'; return; }
  try {
    await _auth.signInWithEmailAndPassword(email, pass);
    // onAuthStateChanged will handle routing
  } catch (e) {
    errEl.textContent = e.message || 'Login failed';
    errEl.style.display = 'block';
  }
}
async function doSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const pass = document.getElementById('signup-pass').value;
  const errEl = document.getElementById('signup-error');
  if (!email || !pass) { errEl.textContent = 'Fill all fields.'; errEl.style.display = 'block'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  try {
    await _auth.createUserWithEmailAndPassword(email, pass);
  } catch (e) {
    errEl.textContent = e.message || 'Signup failed';
    errEl.style.display = 'block';
  }
}
async function doLogout() {
  try { await _auth.signOut(); } catch(e) {}
  currentUser = null;
  currentUserData = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('screen-locked').style.display = 'none';
  showToast('Logged out.', '');
}

/* ═══════════════════════════════════════════════════════════
   AUTH STATE OBSERVER & BOOT
   ═══════════════════════════════════════════════════════════ */
function showScreen(id) {
  ['auth-screen', 'screen-locked', 'app'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(id);
  if (target) target.style.display = id === 'app' ? 'block' : 'flex';
}

function launchApp() {
  showScreen('app');
  updateDashboard();
  renderJournal();
  updateJournalStats();
  buildFundamentalsInputs();
  buildWeeklyBiasInputs();
  loadWeeklyBias();
  loadTrainer();
  setupRiskCalculator();
  updateSubscriptionUI();
  goPage('dashboard');
}

function updateSubscriptionUI() {
  const daysEl = document.getElementById('tb-days');
  const renewBtn = document.getElementById('btn-renew');
  if (!currentUserData || currentUserData.paymentStatus !== 'paid') {
    if (daysEl) daysEl.style.display = 'none';
    if (renewBtn) renewBtn.style.display = 'none';
    return;
  }
  const daysLeft = Math.max(0, Math.ceil((currentUserData.expiresAt - Date.now()) / 86400000));
  if (daysEl) {
    daysEl.textContent = daysLeft + (daysLeft === 1 ? ' day left' : ' days left');
    daysEl.style.display = 'inline-block';
    daysEl.style.color = daysLeft <= 5 ? '#ff4d6a' : '#f0b429';
  }
  if (renewBtn) renewBtn.style.display = daysLeft <= 7 ? 'inline-flex' : 'none';
}

// On Firebase auth change
if (typeof _auth !== 'undefined') {
  _auth.onAuthStateChanged(async user => {
    if (user) {
      currentUser = user;
      const hasSub = checkSubscription();
      if (hasSub) {
        launchApp();
      } else {
        // Show locked screen with email
        document.getElementById('locked-email').textContent = user.email || '';
        // Set prices from constants
        const prices = typeof PLAN_PRICES_USD !== 'undefined' ? PLAN_PRICES_USD : { monthly: 15, annual: 120 };
        const moEl = document.getElementById('price-monthly');
        const yrEl = document.getElementById('price-annual');
        if (moEl) moEl.textContent = `$${prices.monthly} / month`;
        if (yrEl) yrEl.textContent = `$${prices.annual} / year`;
        showScreen('screen-locked');
      }
    } else {
      currentUser = null;
      currentUserData = null;
      showScreen('auth-screen');
    }
  });
} else {
  console.warn('Firebase not initialized');
  showScreen('auth-screen');
}

/* ═══════════════════════════════════════════════════════════
   RISK CALCULATOR (from App B, live updates)
   ═══════════════════════════════════════════════════════════ */
function calcRisk() {
  const balance = parseFloat(document.getElementById('rc-balance')?.value) || 0;
  const riskPct = parseFloat(document.getElementById('rc-risk')?.value) || 0;
  const entry = parseFloat(document.getElementById('rc-entry')?.value) || 0;
  const sl = parseFloat(document.getElementById('rc-sl')?.value) || 0;
  const tp = parseFloat(document.getElementById('rc-tp')?.value) || 0;
  const resultEl = document.getElementById('rc-result');
  if (!resultEl) return;
  if (!balance || !riskPct || !entry || !sl) {
    resultEl.innerHTML = '<span style="color:var(--text-secondary)">Fill in Balance, Risk %, Entry, and Stop Loss.</span>';
    return;
  }
  const pipDist = Math.abs(entry - sl) * 10000;
  if (pipDist === 0) { resultEl.innerHTML = '<span style="color:var(--red)">Entry and SL cannot be same.</span>'; return; }
  const riskAmt = (balance * riskPct) / 100;
  const lotSize = riskAmt / (pipDist * 10);
  let profitHtml = '';
  let rrHtml = '';
  if (tp && tp !== entry) {
    const rewardPips = Math.abs(tp - entry) * 10000;
    const profit = rewardPips * lotSize * 10;
    const rr = (profit / riskAmt).toFixed(2);
    profitHtml = `<div><strong>Potential Profit:</strong> $${profit.toFixed(2)}</div>`;
    rrHtml = `<div><strong>R:R:</strong> 1 : ${rr}</div>`;
  }
  resultEl.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between;">
      <div><strong>Pip Distance:</strong> ${pipDist.toFixed(1)}</div>
      <div><strong>Risk Amount:</strong> $${riskAmt.toFixed(2)}</div>
      <div><strong>Lot Size:</strong> ${lotSize.toFixed(2)}</div>
      ${profitHtml}
      ${rrHtml}
    </div>`;
}
function setupRiskCalculator() {
  ['rc-balance','rc-risk','rc-entry','rc-sl','rc-tp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calcRisk);
  });
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD & STREAK (from App A)
   ═══════════════════════════════════════════════════════════ */
function updateDashboard() {
  const allTrades = getUserData('trades', []);
  trades = allTrades;
  const wins = trades.filter(t => t.outcome === 'win').length;
  const wr = trades.length ? Math.round(wins/trades.length*100) : 0;
  const avgRR = trades.length ? (trades.reduce((s,t)=>s+(parseFloat(t.rr)||0),0)/trades.length).toFixed(1) : '0.0';
  document.getElementById('dash-total').textContent = trades.length;
  document.getElementById('dash-winrate').textContent = wr+'%';
  document.getElementById('dash-rr').textContent = avgRR;

  const streak = getUserData('streak', {count:0,lastDate:''});
  document.getElementById('streak-num').textContent = streak.count||0;
  document.getElementById('streak-msg').textContent = streak.count>=3 ? "You're on fire! Keep it going." : streak.count>0 ? 'Complete a checklist today!' : 'Start your streak today!';

  const recent = trades.slice(-3).reverse();
  const el = document.getElementById('dash-recent');
  if (!recent.length) { el.innerHTML='<div class="no-trades"><div class="no-icon">📊</div><p>No trades yet.</p></div>'; return; }
  el.innerHTML = recent.map(t => tradeCardHTML(t, false)).join('');

  const wb = getUserData('weeklyBias', {});
  const hasBias = Object.keys(wb).length > 0;
  document.getElementById('weekly-bias-summary').style.display = hasBias ? 'block' : 'none';
  if (hasBias) {
    const pills = document.getElementById('weekly-bias-pills');
    pills.innerHTML = Object.entries(wb).map(([p,b]) => `<div class="bias-pill ${b}">${p}: ${b.toUpperCase()}</div>`).join('');
  }
}

/* ═══════════════════════════════════════════════════════════
   CHECKLIST (from App A)
   ═══════════════════════════════════════════════════════════ */
function toggleCheck(el) {
  el.classList.toggle('checked');
  const checked = document.querySelectorAll('.check-item.checked').length;
  const total = document.querySelectorAll('.check-item').length;
  const pct = total ? Math.round(checked/total*100) : 0;
  const bar = document.getElementById('check-bar');
  if (bar) bar.style.width = pct+'%';
  const prog = document.getElementById('check-progress-text');
  if (prog) prog.textContent = `${checked} / ${total}`;
}
function completeChecklist() {
  const checked = document.querySelectorAll('.check-item.checked').length;
  const total = document.querySelectorAll('.check-item').length;
  if (checked < 8) { showToast(`Complete at least 8 checks (${checked}/${total})`, 'warning'); return; }
  const score = Math.round(checked/total*100);
  setUserData('lastChecklist', {score, date: new Date().toISOString()});
  const streak = getUserData('streak', {count:0,lastDate:''});
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now()-86400000).toDateString();
  if (streak.lastDate !== today) {
    if (streak.lastDate === yesterday) streak.count++;
    else streak.count = 1;
    streak.lastDate = today;
    setUserData('streak', streak);
  }
  showToast(`Checklist complete! Score: ${score}%`, 'success');
  goPage('journal');
  setTimeout(() => document.getElementById('journal-form')?.scrollIntoView({behavior:'smooth'}), 300);
}
function resetChecklist() {
  document.querySelectorAll('.check-item').forEach(i => i.classList.remove('checked'));
  const bar = document.getElementById('check-bar'); if(bar) bar.style.width='0%';
  const prog = document.getElementById('check-progress-text'); if(prog) prog.textContent='0 / 12';
}

/* ═══════════════════════════════════════════════════════════
   JOURNAL (no screenshot)
   ═══════════════════════════════════════════════════════════ */
function renderJournal() {
  const all = getUserData('trades', []);
  let filtered = all.slice().reverse();
  if (journalFilter !== 'all') {
    filtered = filtered.filter(t => t.outcome === journalFilter || t.pair === journalFilter || (t.tags && t.tags.includes(journalFilter)));
  }
  const container = document.getElementById('journal-list');
  if (!filtered.length) { container.innerHTML = '<div class="no-trades">📓 No trades yet.</div>'; return; }
  container.innerHTML = filtered.map(t => tradeCardHTML(t, true)).join('');
}
function tradeCardHTML(t, showDelete) {
  const d = new Date(t.date);
  const dateStr = d.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
  const tagsHtml = t.tags?.length ? `<div class="trade-tags">${t.tags.map(tag=>`<div class="trade-tag">${tag}</div>`).join('')}</div>` : '';
  const notesHtml = t.notes ? `<div class="trade-notes">${t.notes}</div>` : '';
  const del = showDelete ? `<div style="cursor:pointer;" onclick="deleteTrade(${t.id})">🗑</div>` : '';
  return `<div class="trade-card"><div class="trade-card-header"><div class="trade-pair">${t.pair}</div><div class="trade-outcome ${t.outcome}">${t.outcome.toUpperCase()}</div>${del}</div>
    <div class="trade-meta">📅 ${dateStr} | R:R 1:${t.rr||'—'} | Entry ${t.entry}</div>${tagsHtml}${notesHtml}</div>`;
}
function deleteTrade(id) {
  let all = getUserData('trades', []);
  all = all.filter(t => t.id !== id);
  setUserData('trades', all);
  renderJournal();
  updateJournalStats();
  updateDashboard();
  showToast('Trade deleted');
}
function submitTrade() {
  const pair = document.getElementById('j-pair').value;
  const entry = parseFloat(document.getElementById('j-entry').value);
  const sl = parseFloat(document.getElementById('j-sl').value);
  const tp = parseFloat(document.getElementById('j-tp').value);
  const direction = document.getElementById('j-direction').value;
  const notes = document.getElementById('j-notes').value;
  if (!entry || !sl || !tp) { showToast('Fill entry, SL, TP', 'warning'); return; }
  if (!tradeOutcome) { showToast('Select outcome', 'warning'); return; }
  const lastCheck = getUserData('lastChecklist', null);
  if (!lastCheck) { showToast('Complete pre-trade checklist first!', 'warning'); return; }
  const rr = Math.abs(tp-entry) / Math.abs(entry-sl);
  const newTrade = {
    id: Date.now(), date: new Date().toISOString(), pair, direction, entry, sl, tp,
    rr: rr.toFixed(2), outcome: tradeOutcome, tags: [...tradeTags], notes,
    checklistScore: lastCheck.score
  };
  const tradesArr = getUserData('trades', []);
  tradesArr.push(newTrade);
  setUserData('trades', tradesArr);
  tradeOutcome = ''; tradeTags = [];
  document.getElementById('j-entry').value = '';
  document.getElementById('j-sl').value = '';
  document.getElementById('j-tp').value = '';
  document.getElementById('j-notes').value = '';
  document.querySelectorAll('.outcome-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tag-pill').forEach(b=>b.classList.remove('active'));
  renderJournal();
  updateJournalStats();
  updateDashboard();
  showToast('Trade logged!');
}
function updateJournalStats() {
  const all = getUserData('trades', []);
  const wins = all.filter(t=>t.outcome==='win').length;
  const wr = all.length ? Math.round(wins/all.length*100) : 0;
  const avgRR = all.length ? (all.reduce((s,t)=>s+(parseFloat(t.rr)||0),0)/all.length).toFixed(1) : '0.0';
  document.getElementById('j-total').textContent = all.length;
  document.getElementById('j-winrate').textContent = wr+'%';
  document.getElementById('j-avgrr').textContent = avgRR;
  document.getElementById('journal-summary-text').textContent = `${all.length} trade${all.length!==1?'s':''} logged`;
}
function setOutcome(type, btn) {
  document.querySelectorAll('.outcome-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  tradeOutcome = type;
}
function toggleTag(el, tag) {
  el.classList.toggle('active');
  if (el.classList.contains('active')) tradeTags.push(tag);
  else tradeTags = tradeTags.filter(t=>t!==tag);
}
function calcRRForForm() {
  const entry = parseFloat(document.getElementById('j-entry').value);
  const sl = parseFloat(document.getElementById('j-sl').value);
  const tp = parseFloat(document.getElementById('j-tp').value);
  if (isNaN(entry)||isNaN(sl)||isNaN(tp)) { document.getElementById('rr-display').textContent='— : —'; return; }
  const risk = Math.abs(entry-sl);
  const reward = Math.abs(tp-entry);
  if (!risk) { document.getElementById('rr-display').textContent='— : —'; return; }
  const rr = (reward/risk).toFixed(2);
  document.getElementById('rr-display').textContent = `1 : ${rr}`;
}
function filterJournal(f, el) {
  journalFilter = f;
  document.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  renderJournal();
}

/* ═══════════════════════════════════════════════════════════
   ANALYTICS (from App A)
   ═══════════════════════════════════════════════════════════ */
function renderAnalytics() {
  const tradesArr = getUserData('trades', []);
  const wins = tradesArr.filter(t=>t.outcome==='win').length;
  const losses = tradesArr.filter(t=>t.outcome==='loss').length;
  const bes = tradesArr.filter(t=>t.outcome==='be').length;
  const avgRR = tradesArr.length ? (tradesArr.reduce((s,t)=>s+(parseFloat(t.rr)||0),0)/tradesArr.length).toFixed(2) : '0.00';
  document.getElementById('an-wins').textContent = wins;
  document.getElementById('an-losses').textContent = losses;
  document.getElementById('an-be').textContent = bes;
  document.getElementById('an-rr').textContent = avgRR;
  // Equity curve
  let equity = 0;
  const eqData = [0], labels = ['Start'];
  tradesArr.forEach((t,i) => {
    equity += t.outcome==='win' ? (parseFloat(t.rr)||1) : t.outcome==='loss' ? -1 : 0;
    eqData.push(parseFloat(equity.toFixed(2)));
    labels.push(`T${i+1}`);
  });
  const ctx1 = document.getElementById('equity-chart')?.getContext('2d');
  if (ctx1) {
    if (equityChart) equityChart.destroy();
    equityChart = new Chart(ctx1, { type:'line', data:{ labels, datasets:[{ data:eqData, borderColor:'#f0b429', fill:true, tension:0.4 }] }, options:{ responsive:true, maintainAspectRatio:false } });
  }
  // Distribution
  const ctx2 = document.getElementById('dist-chart')?.getContext('2d');
  if (ctx2) {
    if (distChart) distChart.destroy();
    distChart = new Chart(ctx2, { type:'doughnut', data:{ labels:['Wins','Losses','BE'], datasets:[{ data:[wins,losses,bes], backgroundColor:['#00c896','#ff4d6a','#4a9eff'] }] } });
  }
}

/* ═══════════════════════════════════════════════════════════
   FUNDAMENTALS (Currency Strength Engine from App A)
   ═══════════════════════════════════════════════════════════ */
const CURRENCIES = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF'];
const CURRENCY_NAMES = {USD:'US Dollar',EUR:'Euro',GBP:'British Pound',JPY:'Japanese Yen',AUD:'Aus Dollar',NZD:'NZ Dollar',CAD:'Can Dollar',CHF:'Swiss Franc'};
function buildFundamentalsInputs() {
  const container = document.getElementById('currency-inputs');
  if (!container) return;
  container.innerHTML = CURRENCIES.map(c => `
    <div class="currency-card">
      <div class="cc-sym">${c}</div>
      <div class="currency-input-row"><label>Rate</label><select id="fund-${c}-Rate"><option value="0">Neutral</option><option value="1">Bullish</option><option value="-1">Bearish</option></select></div>
      <div class="currency-input-row"><label>CPI</label><select id="fund-${c}-CPI"><option value="0">Neutral</option><option value="1">Rising</option><option value="-1">Falling</option></select></div>
      <div class="currency-input-row"><label>Employment</label><select id="fund-${c}-Employment"><option value="0">Neutral</option><option value="1">Strong</option><option value="-1">Weak</option></select></div>
      <div class="currency-input-row"><label>CB Stance</label><select id="fund-${c}-CBStance"><option value="0">Neutral</option><option value="1">Hawkish</option><option value="-1">Dovish</option></select></div>
    </div>`).join('');
}
function calcFundamentals() {
  const scores = {};
  CURRENCIES.forEach(c => {
    let total = 0;
    total += parseInt(document.getElementById(`fund-${c}-Rate`)?.value || 0);
    total += parseInt(document.getElementById(`fund-${c}-CPI`)?.value || 0);
    total += parseInt(document.getElementById(`fund-${c}-Employment`)?.value || 0);
    total += parseInt(document.getElementById(`fund-${c}-CBStance`)?.value || 0);
    scores[c] = total;
  });
  setUserData('currencyStrength', scores);
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const table = document.getElementById('strength-table');
  if (table) {
    table.innerHTML = `<thead><tr><th>#</th><th>Currency</th><th>Score</th><th>Bias</th></tr></thead><tbody>${
      sorted.map(([c,s],i)=>`<tr><td>${i+1}</td><td>${c}</td><td>${s>0?'+':''}${s}</td><td>${s>1?'BULL':s<-1?'BEAR':'NEU'}</td></tr>`).join('')
    }</tbody>`;
    document.getElementById('strength-table-card').style.display = 'block';
  }
  // Suggestions
  const suggestions = [];
  const top3 = sorted.slice(0,3);
  const bottom3 = sorted.slice(-3).reverse();
  top3.forEach(([strong,ss]) => {
    bottom3.forEach(([weak,ws]) => {
      const pair = strong+weak;
      if (['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD'].includes(pair))
        suggestions.push({dir:'BUY',pair,reason:`${strong} strong (${ss}) vs ${weak} weak (${ws})`});
      else if (['USDEUR','USDGBP','JPYUSD'].includes(weak+strong))
        suggestions.push({dir:'SELL',pair:weak+strong,reason:`${strong} strong vs ${weak} weak`});
    });
  });
  const suggDiv = document.getElementById('suggestions-list');
  if (suggDiv) suggDiv.innerHTML = suggestions.slice(0,5).map(s=>`<div class="suggestion-card"><div class="suggestion-direction ${s.dir.toLowerCase()}">${s.dir}</div><div class="suggestion-pair">${s.pair}</div><div class="suggestion-reason">${s.reason}</div></div>`).join('');
  document.getElementById('suggestions-card').style.display = 'block';
  showToast('Fundamentals calculated');
}

/* ═══════════════════════════════════════════════════════════
   WEEKLY BIAS, TRAINER, NAVIGATION (from App A)
   ═══════════════════════════════════════════════════════════ */
function buildWeeklyBiasInputs() {
  const pairs = ['XAUUSD','GBPUSD','EURUSD','USDJPY'];
  const el = document.getElementById('weekly-bias-inputs');
  if (!el) return;
  el.innerHTML = pairs.map(p => `<div class="weekly-bias-row"><label>${p}</label><div class="bias-btn-group"><button class="bias-btn bull" onclick="setWeeklyBias('${p}','bull',this)">BULL</button><button class="bias-btn bear" onclick="setWeeklyBias('${p}','bear',this)">BEAR</button><button class="bias-btn neut" onclick="setWeeklyBias('${p}','neut',this)">NEU</button></div></div>`).join('');
}
function setWeeklyBias(pair, bias, btn) {
  btn.closest('.bias-btn-group').querySelectorAll('.bias-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  weeklyBiasDraft[pair] = bias;
}
function saveWeeklyBias() {
  setUserData('weeklyBias', weeklyBiasDraft);
  showToast('Weekly bias saved');
}
function loadWeeklyBias() {
  const wb = getUserData('weeklyBias', {});
  weeklyBiasDraft = { ...wb };
  document.querySelectorAll('#weekly-bias-inputs .weekly-bias-row').forEach(row => {
    const label = row.querySelector('label')?.textContent.trim();
    if (label && wb[label]) {
      const btn = row.querySelector(`.bias-btn.${wb[label]}`);
      if (btn) btn.click();
    }
  });
}
function loadTrainer() {
  const saved = getUserData('trainerStats', {score:0,streak:0,total:0,correct:0});
  trainerState = { ...trainerState, ...saved };
  document.getElementById('trainer-score').textContent = trainerState.score;
  document.getElementById('trainer-streak').textContent = trainerState.streak;
  const acc = trainerState.total ? Math.round(trainerState.correct/trainerState.total*100) : 0;
  document.getElementById('trainer-accuracy').textContent = acc+'%';
}
function goPage(id) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const page = document.getElementById('page-'+id);
  if (page) page.classList.add('active');
  const nav = document.querySelector(`[data-page="${id}"]`);
  if (nav) nav.classList.add('active');
  if (id === 'analytics') renderAnalytics();
  if (id === 'journal') renderJournal();
  if (id === 'dashboard') updateDashboard();
}
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('active', i === (tab==='login'?0:1)));
  document.getElementById('login-form').classList.toggle('active', tab==='login');
  document.getElementById('signup-form').classList.toggle('active', tab==='signup');
}

// Expose globals for inline onclick
window.doLogin = doLogin;
window.doSignup = doSignup;
window.doLogout = doLogout;
window.initiatePaystack = initiatePaystack;
window.goPage = goPage;
window.switchAuthTab = switchAuthTab;
window.toggleCheck = toggleCheck;
window.completeChecklist = completeChecklist;
window.resetChecklist = resetChecklist;
window.setOutcome = setOutcome;
window.toggleTag = toggleTag;
window.submitTrade = submitTrade;
window.deleteTrade = deleteTrade;
window.filterJournal = filterJournal;
window.calcRRForForm = calcRRForForm;
window.calcFundamentals = calcFundamentals;
window.saveWeeklyBias = saveWeeklyBias;
window.setWeeklyBias = setWeeklyBias;
window.calcRisk = calcRisk;

// DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const pairEl = document.getElementById('j-pair');
  const dirEl = document.getElementById('j-direction');
  if (pairEl) pairEl.addEventListener('change', () => {});
  if (dirEl) dirEl.addEventListener('change', () => {});
  const inputs = ['j-entry','j-sl','j-tp'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calcRRForForm);
  });
  setupRiskCalculator();
});
