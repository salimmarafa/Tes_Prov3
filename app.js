// app.js
(function(){
'use strict';

// ================= CONFIG =================
const OWNER_EMAIL = "salimmarafa12@gmail.com";
const PAYSTACK_PUBLIC_KEY = "pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // replace for LIVE
const USD_TO_NGN = 1600; // approximate conversion for Paystack (NGN-based)

const CURRENCIES = ["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF"];

let currentUser = null;
let unsubTrades = null;
let tradesCache = [];
let strengthCache = {};

// ================= SCREEN ROUTER =================
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el = document.getElementById(id);
  if(el) el.classList.add('active');
}

// ================= TOAST =================
function toast(msg, type){
  type = type || 'info';
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast '+type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; }, 2600);
  setTimeout(()=>t.remove(), 3000);
}

// ================= AUTH OBSERVER =================
auth.onAuthStateChanged(async (user)=>{
  if(!user){
    currentUser = null;
    if(unsubTrades){ unsubTrades(); unsubTrades = null; }
    showScreen('screen-auth');
    return;
  }
  currentUser = user;
  document.getElementById('user-email').textContent = user.email;

  // Owner bypass
  if(user.email && user.email.toLowerCase() === OWNER_EMAIL.toLowerCase()){
    await ensureUserDoc(user, {owner:true});
    enterApp();
    return;
  }

  // Check subscription
  const sub = await getSubscription(user.uid);
  if(sub && sub.status === 'active' && sub.expiresAt && sub.expiresAt.toDate() > new Date()){
    enterApp();
  } else {
    showScreen('screen-locked');
  }
});

async function ensureUserDoc(user, extra){
  const ref = db.collection('users').doc(user.uid);
  const snap = await ref.get();
  if(!snap.exists){
    await ref.set({
      name: user.displayName || '',
      email: user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      ...(extra||{})
    });
  }
}

async function getSubscription(uid){
  try{
    const snap = await db.collection('subscriptions').doc(uid).get();
    return snap.exists ? snap.data() : null;
  }catch(e){ return null; }
}

function enterApp(){
  showScreen('screen-app');
  initAppData();
}

// ================= AUTH UI =================
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const tab = t.dataset.tab;
    document.getElementById('login-form').classList.toggle('hidden', tab!=='login');
    document.getElementById('signup-form').classList.toggle('hidden', tab!=='signup');
    document.getElementById('auth-title').textContent = tab==='login'?'Welcome back':'Create Account';
    document.getElementById('auth-sub').textContent = tab==='login'?'Login to continue':'Start your trading journey';
  });
});

document.getElementById('btn-signup').addEventListener('click', async ()=>{
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pw = document.getElementById('signup-password').value;
  if(!name||!email||pw.length<6){ toast('Fill all fields (password 6+ chars)','error'); return; }
  try{
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    await cred.user.updateProfile({ displayName: name });
    await ensureUserDoc(cred.user, { name });
    toast('Account created','success');
  }catch(e){ toast(e.message,'error'); }
});

document.getElementById('btn-login').addEventListener('click', async ()=>{
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-password').value;
  if(!email||!pw){ toast('Enter email & password','error'); return; }
  try{
    await auth.signInWithEmailAndPassword(email, pw);
    toast('Logged in','success');
  }catch(e){ toast(e.message,'error'); }
});

document.getElementById('btn-logout').addEventListener('click', ()=>auth.signOut());
document.getElementById('btn-logout-locked').addEventListener('click', ()=>auth.signOut());

// ================= PAYSTACK =================
document.querySelectorAll('[data-buy]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const plan = btn.dataset.buy;
    initiatePaystack(plan);
  });
});

function initiatePaystack(plan){
  if(!currentUser){ toast('Login first','error'); return; }
  const testMode = document.getElementById('test-mode-toggle').checked;
  const amountUSD = plan === 'annual' ? 120 : 15;

  if(testMode){
    toast('Test payment simulated...','info');
    setTimeout(()=>grantAccess(plan), 900);
    return;
  }

  if(typeof PaystackPop === 'undefined'){
    toast('Paystack not loaded','error'); return;
  }
  const handler = PaystackPop.setup({
    key: PAYSTACK_PUBLIC_KEY,
    email: currentUser.email,
    amount: Math.round(amountUSD * USD_TO_NGN * 100),
    currency: 'NGN',
    ref: 'fxe_'+Date.now(),
    metadata:{ plan, uid: currentUser.uid },
    callback: function(response){
      grantAccess(plan, response.reference);
    },
    onClose: function(){ toast('Payment cancelled','info'); }
  });
  handler.openIframe();
}

async function grantAccess(plan, reference){
  if(!currentUser) return;
  const days = plan === 'annual' ? 365 : 30;
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  try{
    await db.collection('subscriptions').doc(currentUser.uid).set({
      status:'active',
      plan,
      reference: reference || 'test_mode',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt: firebase.firestore.Timestamp.fromDate(expires)
    }, { merge:true });
    toast('Subscription active!','success');
    enterApp();
  }catch(e){ toast(e.message,'error'); }
}

// ================= NAV =================
document.querySelectorAll('.nav-tab').forEach(b=>{
  b.addEventListener('click', ()=>{
    document.querySelectorAll('.nav-tab').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const v = b.dataset.view;
    document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
    document.getElementById('view-'+v).classList.add('active');
  });
});

// ================= APP INIT =================
function initAppData(){
  buildMacroGrid();
  loadMacroFromStorage();
  computeStrength();
  renderStrength();
  renderSuggestions();
  listenTrades();
}

// ================= MACRO ENGINE =================
function buildMacroGrid(){
  const grid = document.getElementById('macro-grid');
  if(grid.children.length) return;
  CURRENCIES.forEach(c=>{
    const card = document.createElement('div');
    card.className = 'macro-card';
    card.innerHTML = `
      <h4>${c}</h4>
      <label>Interest Rate (%)</label>
      <input type="number" step="0.01" data-ccy="${c}" data-field="rate" />
      <label>CPI (%)</label>
      <input type="number" step="0.01" data-ccy="${c}" data-field="cpi" />
      <label>Employment</label>
      <select data-ccy="${c}" data-field="emp">
        <option value="Strong">Strong</option>
        <option value="Weak">Weak</option>
      </select>
      <label>Central Bank Stance</label>
      <select data-ccy="${c}" data-field="cb">
        <option value="Hawkish">Hawkish</option>
        <option value="Dovish">Dovish</option>
      </select>
    `;
    grid.appendChild(card);
  });
}

function getMacroInputs(){
  const data = {};
  CURRENCIES.forEach(c=>data[c]={rate:0,cpi:0,emp:'Strong',cb:'Hawkish'});
  document.querySelectorAll('#macro-grid [data-ccy]').forEach(el=>{
    const c = el.dataset.ccy, f = el.dataset.field;
    data[c][f] = el.type==='number' ? parseFloat(el.value)||0 : el.value;
  });
  return data;
}

function setMacroInputs(data){
  document.querySelectorAll('#macro-grid [data-ccy]').forEach(el=>{
    const c = el.dataset.ccy, f = el.dataset.field;
    if(data[c] && data[c][f]!==undefined) el.value = data[c][f];
  });
}

function computeStrength(){
  const data = getMacroInputs();
  const scores = {};
  CURRENCIES.forEach(c=>{
    const d = data[c];
    let s = 0;
    s += (d.rate||0) * 2;        // Higher rates = stronger
    s += (d.cpi||0) * 0.5;       // Inflation mild positive (pricing in hikes)
    s += d.emp === 'Strong' ? 3 : -3;
    s += d.cb === 'Hawkish' ? 4 : -4;
    scores[c] = +s.toFixed(2);
  });
  strengthCache = scores;
  return scores;
}

function renderStrength(){
  const scores = strengthCache;
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const wrap = document.getElementById('strength-ranking');
  wrap.innerHTML = '';
  const max = Math.max(...sorted.map(s=>Math.abs(s[1])),1);
  sorted.forEach(([c,v],i)=>{
    const pct = Math.min(100, Math.abs(v)/max*100);
    const row = document.createElement('div');
    row.className = 'rank-row';
    row.innerHTML = `
      <div class="pos">#${i+1}</div>
      <div class="ccy">${c}</div>
      <div class="bar-wrap"><div class="bar" style="width:${pct}%"></div></div>
      <div class="score" style="color:${v>=0?'var(--green)':'var(--red)'}">${v>=0?'+':''}${v}</div>
    `;
    wrap.appendChild(row);
  });
}

function renderSuggestions(){
  const scores = strengthCache;
  const sorted = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
  const wrap = document.getElementById('suggestions-list');
  wrap.innerHTML = '';
  if(!sorted.length){ wrap.innerHTML = '<p class="muted">Input macro data first.</p>'; return; }

  const strongest = sorted.slice(0,3);
  const weakest = sorted.slice(-3).reverse();

  strongest.forEach(s=>{
    weakest.forEach(w=>{
      if(s[0]===w[0]) return;
      const pair = buildPair(s[0], w[0]);
      if(!pair) return;
      const sug = document.createElement('div');
      sug.className='sug';
      sug.innerHTML = `<div><div style="font-weight:700">${pair.symbol}</div><div class="muted" style="font-size:12px">${s[0]} strong vs ${w[0]} weak</div></div><div class="action ${pair.action==='BUY'?'buy':'sell'}">${pair.action}</div>`;
      wrap.appendChild(sug);
    });
  });
}

function buildPair(strong, weak){
  const majors = ["EURUSD","GBPUSD","AUDUSD","NZDUSD","USDJPY","USDCAD","USDCHF","EURJPY","GBPJPY","EURGBP","AUDJPY","EURAUD","GBPJPY","CHFJPY","CADJPY","NZDJPY","EURCAD","EURCHF","GBPAUD","GBPCAD","GBPCHF","AUDCAD","AUDCHF","AUDNZD","NZDCAD","NZDCHF"];
  const direct = strong + weak;
  const inverse = weak + strong;
  if(majors.includes(direct)) return { symbol: direct, action:'BUY' };
  if(majors.includes(inverse)) return { symbol: inverse, action:'SELL' };
  return null;
}

document.getElementById('btn-calc-macro').addEventListener('click', ()=>{
  computeStrength();
  saveMacroToStorage();
  renderStrength();
  renderSuggestions();
  toast('Strength calculated','success');
});
document.getElementById('btn-reset-macro').addEventListener('click', ()=>{
  document.querySelectorAll('#macro-grid input').forEach(i=>i.value='');
  document.querySelectorAll('#macro-grid select').forEach(s=>s.selectedIndex=0);
  localStorage.removeItem('fxe_macro');
  computeStrength();
  renderStrength();
  renderSuggestions();
  toast('Macro reset','info');
});

function saveMacroToStorage(){
  localStorage.setItem('fxe_macro', JSON.stringify(getMacroInputs()));
}
function loadMacroFromStorage(){
  try{
    const d = JSON.parse(localStorage.getItem('fxe_macro'));
    if(d) setMacroInputs(d);
  }catch(e){}
}

// ================= TRADES =================
function listenTrades(){
  if(!currentUser) return;
  if(unsubTrades) unsubTrades();
  unsubTrades = db.collection('users').doc(currentUser.uid).collection('trades')
    .orderBy('createdAt','desc')
    .onSnapshot(snap=>{
      tradesCache = snap.docs.map(d=>({id:d.id,...d.data()}));
      renderTrades();
      renderStats();
    }, err=>{ toast(err.message,'error'); });
}

document.getElementById('btn-add-trade').addEventListener('click', async ()=>{
  if(!currentUser) return;
  const pair = document.getElementById('tr-pair').value.trim().toUpperCase();
  const entry = parseFloat(document.getElementById('tr-entry').value);
  const sl = parseFloat(document.getElementById('tr-sl').value);
  const tp = parseFloat(document.getElementById('tr-tp').value);
  const outcome = document.getElementById('tr-outcome').value;
  const r = parseFloat(document.getElementById('tr-r').value) || 0;
  const notes = document.getElementById('tr-notes').value.trim();
  if(!pair){ toast('Enter pair','error'); return; }
  try{
    await db.collection('users').doc(currentUser.uid).collection('trades').add({
      pair, entry:entry||0, sl:sl||0, tp:tp||0, outcome, r, notes,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    ['tr-pair','tr-entry','tr-sl','tr-tp','tr-r','tr-notes'].forEach(id=>document.getElementById(id).value='');
    toast('Trade added','success');
  }catch(e){ toast(e.message,'error'); }
});

function renderTrades(){
  const tbody = document.querySelector('#all-trades tbody');
  tbody.innerHTML = '';
  tradesCache.forEach(t=>{
    const tr = document.createElement('tr');
    const date = t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().toLocaleDateString() : '-';
    tr.innerHTML = `
      <td>${date}</td>
      <td>${t.pair||''}</td>
      <td>${t.entry||''}</td>
      <td>${t.sl||''}</td>
      <td>${t.tp||''}</td>
      <td style="color:${t.outcome==='Win'?'var(--green)':t.outcome==='Loss'?'var(--red)':'var(--yellow)'}">${t.outcome||''}</td>
      <td>${t.r||0}</td>
      <td style="max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.notes||''}</td>
      <td><button class="del-btn" data-id="${t.id}">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('.del-btn').forEach(b=>{
    b.addEventListener('click', async ()=>{
      try{
        await db.collection('users').doc(currentUser.uid).collection('trades').doc(b.dataset.id).delete();
        toast('Deleted','info');
      }catch(e){ toast(e.message,'error'); }
    });
  });

  // recent (top 5)
  const recent = document.querySelector('#recent-trades tbody');
  recent.innerHTML='';
  tradesCache.slice(0,5).forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.pair||''}</td><td>${t.entry||''}</td><td>${t.sl||''}</td><td>${t.tp||''}</td>
      <td style="color:${t.outcome==='Win'?'var(--green)':t.outcome==='Loss'?'var(--red)':'var(--yellow)'}">${t.outcome||''}</td>
      <td>${t.r||0}</td>`;
    recent.appendChild(tr);
  });
}

function renderStats(){
  const total = tradesCache.length;
  const wins = tradesCache.filter(t=>t.outcome==='Win').length;
  const losses = tradesCache.filter(t=>t.outcome==='Loss').length;
  const winRate = total ? ((wins/total)*100).toFixed(1) : 0;
  const rs = tradesCache.map(t=>parseFloat(t.r)||0);
  const netR = rs.reduce((a,b)=>a+b,0).toFixed(2);
  const avgR = rs.length ? (rs.reduce((a,b)=>a+Math.abs(b),0)/rs.length).toFixed(2) : '0.00';

  document.getElementById('stat-trades').textContent = total;
  document.getElementById('stat-winrate').textContent = winRate + '%';
  document.getElementById('stat-rr').textContent = avgR;
  document.getElementById('stat-netr').textContent = netR;
}

// ================= EXPORT =================
document.getElementById('btn-export-csv').addEventListener('click', ()=>{
  if(!tradesCache.length){ toast('No trades to export','error'); return; }
  const header = ['Date','Pair','Entry','SL','TP','Outcome','R','Notes'];
  const rows = tradesCache.map(t=>[
    t.createdAt && t.createdAt.toDate ? t.createdAt.toDate().toISOString() : '',
    t.pair||'', t.entry||'', t.sl||'', t.tp||'', t.outcome||'', t.r||0, (t.notes||'').replace(/"/g,'""')
  ]);
  const csv = [header, ...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'trades_'+Date.now()+'.csv';
  a.click();
  toast('CSV exported','success');
});

document.getElementById('btn-export-pdf').addEventListener('click', ()=>{
  if(!tradesCache.length){ toast('No trades to export','error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('FX Edge — Trade Journal', 14, 16);
  doc.setFontSize(10);
  doc.text('Exported: '+new Date().toLocaleString(), 14, 22);

  let y = 32;
  doc.setFont(undefined,'bold');
  doc.text('Pair', 14, y); doc.text('Entry', 40, y); doc.text('SL', 65, y);
  doc.text('TP', 85, y); doc.text('Outcome', 110, y); doc.text('R', 145, y);
  doc.setFont(undefined,'normal');
  y += 6;
  tradesCache.forEach(t=>{
    if(y>280){ doc.addPage(); y=20; }
    doc.text(String(t.pair||''),14,y);
    doc.text(String(t.entry||''),40,y);
    doc.text(String(t.sl||''),65,y);
    doc.text(String(t.tp||''),85,y);
    doc.text(String(t.outcome||''),110,y);
    doc.text(String(t.r||0),145,y);
    y+=6;
  });
  doc.save('trades_'+Date.now()+'.pdf');
  toast('PDF exported','success');
});

// ================= RISK CALC =================
const rcIds = ['rc-balance','rc-risk','rc-pair','rc-entry','rc-sl','rc-tp'];
rcIds.forEach(id=>{
  document.getElementById(id).addEventListener('input', calcRisk);
  document.getElementById(id).addEventListener('change', calcRisk);
});

function calcRisk(){
  const bal = parseFloat(document.getElementById('rc-balance').value)||0;
  const riskPct = parseFloat(document.getElementById('rc-risk').value)||0;
  const pair = document.getElementById('rc-pair').value;
  const entry = parseFloat(document.getElementById('rc-entry').value)||0;
  const sl = parseFloat(document.getElementById('rc-sl').value)||0;
  const tp = parseFloat(document.getElementById('rc-tp').value)||0;

  const isJPY = pair.includes('JPY');
  const pipSize = isJPY ? 0.01 : 0.0001;

  const pipDist = entry && sl ? Math.abs(entry - sl)/pipSize : 0;
  const tpDist = entry && tp ? Math.abs(tp - entry)/pipSize : 0;

  const riskUSD = bal * (riskPct/100);
  const rr = pipDist>0 ? (tpDist/pipDist) : 0;
  const rewardUSD = riskUSD * rr;

  // lot size estimation: for USD-quoted pairs, $10 per pip per standard lot; JPY ~$9.3 — approximate $10
  const pipValuePerLot = 10;
  const lot = pipDist>0 ? (riskUSD / (pipDist * pipValuePerLot)) : 0;

  document.getElementById('out-pips').textContent = pipDist.toFixed(1);
  document.getElementById('out-risk').textContent = '$'+riskUSD.toFixed(2);
  document.getElementById('out-reward').textContent = '$'+rewardUSD.toFixed(2);
  document.getElementById('out-rr').textContent = rr.toFixed(2);
  document.getElementById('out-lot').textContent = lot.toFixed(2);
}

// splash → auth fallback
setTimeout(()=>{
  if(document.getElementById('screen-splash').classList.contains('active') && !currentUser){
    showScreen('screen-auth');
  }
}, 1200);

})();