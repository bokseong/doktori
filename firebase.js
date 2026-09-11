// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBUZ1IU5exTw3gELm7criA7ECT_Z4osld4",
  authDomain: "bit-code-lab-2026.firebaseapp.com",
  projectId: "bit-code-lab-2026",
  storageBucket: "bit-code-lab-2026.firebasestorage.app",
  messagingSenderId: "733037971628",
  appId: "1:733037971628:web:676a495a46c127e3fdb709",
  measurementId: "G-RERP9D8VL0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);