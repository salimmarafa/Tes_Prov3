// firebase.js
var firebaseConfig = {
  apiKey: "AIzaSyDD057lBgAKAelh3tWZsGtK0OMYzqq50dQ",
  authDomain: "trading-web-app-d3959.firebaseapp.com",
  projectId: "trading-web-app-d3959",
  storageBucket: "trading-web-app-d3959.appspot.com",
  messagingSenderId: "277574845686",
  appId: "1:277574845686:web:116ec8d94076c1060858d7"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();