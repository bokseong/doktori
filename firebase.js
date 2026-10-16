import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaV3Provider
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBUZ1IU5exTw3gELm7criA7ECT_Z4osld4",
  authDomain: "bit-code-lab-2026.firebaseapp.com",
  projectId: "bit-code-lab-2026",
  storageBucket: "bit-code-lab-2026.firebasestorage.app",
  messagingSenderId: "733037971628",
  appId: "1:733037971628:web:676a495a46c127e3fdb709",
  measurementId: "G-2XYG7TRQ0X"
};

export const app = initializeApp(firebaseConfig);
export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6LchkPEtAAAAAPJe8j2d3IekFE2eA_piKwYcp_pk"),
  isTokenAutoRefreshEnabled: true
});
export const auth = getAuth(app);
export const db = getFirestore(app);
