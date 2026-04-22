/* firebase.js — TES Pro
   ─────────────────────────────────────────────────────────
   Firebase configuration and auth for the merged app.
   No screenshot storage references.
   Paystack constants and pricing as required.
   ───────────────────────────────────────────────────────── */

// Firebase config (from App B — unchanged)
var firebaseConfig = {
  apiKey:            'AIzaSyDD057lBgAKAelh3tWZsGtK0OMYzqq50dQ',
  authDomain:        'trading-web-app-d3959.firebaseapp.com',
  projectId:         'trading-web-app-d3959',
  storageBucket:     'trading-web-app-d3959.appspot.com',
  messagingSenderId: '277574845686',
  appId:             '1:277574845686:web:116ec8d94076c1060858d7'
};

// Firebase init
var FIREBASE_CONFIGURED = false;
var _auth = null;
var _db   = null;

try {
  firebase.initializeApp(firebaseConfig);
  _auth = firebase.auth();
  _db   = firebase.firestore();
  FIREBASE_CONFIGURED = true;
  console.log('[TES] Firebase initialized');
} catch (e) {
  console.warn('[TES] Firebase init error:', e);
}

// Owner bypass (unchanged)
function isOwner(email) {
  return email === 'salimmarafa12@gmail.com';
}

/* ─────────────────────────────────────────────────────────
   Paystack & pricing constants
   Used by app.js for payments and subscription display.
   ───────────────────────────────────────────────────────── */

// Paystack public key.
// pk_test_ → payment simulated (no real charge).
// pk_live_ → real Paystack popup charges the user.
const PAYSTACK_PUBLIC_KEY = 'pk_test_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

// NGN exchange rate (adjust as needed)
const USD_TO_NGN = 1500;

// Plan prices in USD – strictly $15 monthly, $120 annually
const PLAN_PRICES_USD = {
  monthly: 15,
  annual:  120
};
