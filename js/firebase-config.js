/* ───────── Firebase 專案設定 ─────────
   此段 web config 非機密（本來就會出現在網頁原始碼），安全由 Firestore 安全規則把關。
   若日後換專案，只需替換這一段。*/
const firebaseConfig = {
  apiKey: "AIzaSyD6Os8EovLVlFYx0LYubK9_DiQoH_C4kR0",
  authDomain: "warriors-baseball.firebaseapp.com",
  projectId: "warriors-baseball",
  storageBucket: "warriors-baseball.firebasestorage.app",
  messagingSenderId: "445497533036",
  appId: "1:445497533036:web:854ccada7ddb68b427ae49"
};
firebase.initializeApp(firebaseConfig);
