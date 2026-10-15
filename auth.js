import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function waitForAuth() {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        }, reject);
    });
}

export async function requireUser() {
    const user = await waitForAuth();
    if (user) return user;

    const next = `${location.pathname}${location.search}${location.hash}`;
    const signInUrl = new URL("./signin.html", import.meta.url);
    signInUrl.searchParams.set("next", next);
    location.replace(signInUrl);
    return new Promise(() => {});
}

export async function signInWithGoogle() {
    const result = await signInWithPopup(auth, provider);
    await saveUserProfile(result.user);
    return result.user;
}

export async function saveUserProfile(user) {
    const reference = doc(db, "users", user.uid);
    const snapshot = await getDoc(reference);
    const profile = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        photoURL: user.photoURL || "",
        lastLoginAt: serverTimestamp()
    };
    if (!snapshot.exists()) profile.createdAt = serverTimestamp();
    await setDoc(reference, profile, { merge: true });
}

export async function logout() {
    await signOut(auth);
    location.replace(new URL("./signin.html", import.meta.url));
}
