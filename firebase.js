import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBUZ1IU5exTw3gELm7criA7ECT_Z4osld4",
  authDomain: "bit-code-lab-2026.firebaseapp.com",
  projectId: "bit-code-lab-2026",
  storageBucket: "bit-code-lab-2026.firebasestorage.app",
  messagingSenderId: "733037971628",
  appId: "1:733037971628:web:676a495a46c127e3fdb709",
  measurementId: "G-RERP9D8VL0"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);