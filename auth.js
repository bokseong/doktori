import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    doc,
    getDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

export const MASTER_ADMIN_EMAIL = "github.jwastro09@gmail.com";
export const PRIVACY_CONSENT_VERSION = "2026-10-16-v1";

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function isMasterAdmin(user) {
    return (user?.email || "").toLowerCase() === MASTER_ADMIN_EMAIL;
}

export function waitForAuth() {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
        }, reject);
    });
}

export function isMemberProfileComplete(profile) {
    return Boolean(
        profile?.studentNumber?.trim()
        && profile?.studentName?.trim()
        && profile?.privacyConsent === true
        && profile?.privacyConsentVersion === PRIVACY_CONSENT_VERSION
    );
}

export async function getMemberProfile(user = auth.currentUser) {
    if (!user) return null;
    const snapshot = await getDoc(doc(db, "users", user.uid));
    return snapshot.exists() ? snapshot.data() : null;
}

export async function requireUser() {
    const user = await waitForAuth();
    if (user) {
        const profile = await getMemberProfile(user);
        if (isMemberProfileComplete(profile)) return user;
    }

    const next = `${location.pathname}${location.search}${location.hash}`;
    const signInUrl = new URL("./signin.html", import.meta.url);
    signInUrl.searchParams.set("next", next);
    location.replace(signInUrl);
    return new Promise(() => {});
}

export async function signInWithGoogle() {
    const result = await signInWithPopup(auth, provider);
    return result.user;
}

export async function registerMember(user, studentNumber, studentName, privacyConsent) {
    if (privacyConsent !== true) {
        throw new Error("개인정보 수집·이용에 동의해야 참여할 수 있습니다.");
    }

    const reference = doc(db, "users", user.uid);
    const snapshot = await getDoc(reference);
    const profile = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        studentNumber: studentNumber.trim(),
        studentName: studentName.trim(),
        privacyConsent: true,
        privacyConsentVersion: PRIVACY_CONSENT_VERSION,
        privacyConsentAt: serverTimestamp(),
        registeredAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
    };

    if (!snapshot.exists()) {
        profile.createdAt = serverTimestamp();
        profile.role = isMasterAdmin(user) ? "admin" : "participant";
    } else if (isMasterAdmin(user) && snapshot.data().role !== "admin") {
        profile.role = "admin";
    }

    await setDoc(reference, profile, { merge: true });
    return { ...(snapshot.exists() ? snapshot.data() : {}), ...profile };
}

export async function touchMemberProfile(user) {
    const profile = await getMemberProfile(user);
    if (!isMemberProfileComplete(profile)) return profile;

    const update = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        lastLoginAt: serverTimestamp()
    };
    if (isMasterAdmin(user) && profile.role !== "admin") update.role = "admin";
    await setDoc(doc(db, "users", user.uid), update, { merge: true });
    return { ...profile, ...update };
}

export async function getUserAccess(user = auth.currentUser) {
    if (!user) return { role: null, isAdmin: false };
    if (isMasterAdmin(user)) return { role: "admin", isAdmin: true };

    const profile = await getMemberProfile(user);
    const role = profile?.role || "participant";
    return { role, isAdmin: role === "admin" };
}

export async function logout() {
    await signOut(auth);
    location.replace(new URL("./signin.html", import.meta.url));
}
