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

const STUDENT_NUMBER_PATTERN = /^[0-9]{4,20}$/;
const STUDENT_NAME_PATTERN = /^[가-힣A-Za-z][가-힣A-Za-z .·-]{0,29}$/u;

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
        STUDENT_NUMBER_PATTERN.test(profile?.studentNumber || "")
        && STUDENT_NAME_PATTERN.test(profile?.studentName || "")
        && profile?.privacyConsent === true
        && profile?.privacyConsentVersion === PRIVACY_CONSENT_VERSION
    );
}

export async function getMemberProfile(user = auth.currentUser) {
    if (!user) return null;
    const snapshot = await getDoc(doc(db, "users", user.uid));
    return snapshot.exists() ? snapshot.data() : null;
}

export function getSafeNext(fallback = "./index.html") {
    const fallbackUrl = new URL(fallback, location.href);
    const requested = new URLSearchParams(location.search).get("next");

    if (!requested) {
        return `${fallbackUrl.pathname}${fallbackUrl.search}${fallbackUrl.hash}`;
    }

    try {
        const target = new URL(requested, location.href);
        const isAuthPage = /\/(?:signin|register)\.html$/i.test(target.pathname);
        return target.origin === location.origin && !isAuthPage
            ? `${target.pathname}${target.search}${target.hash}`
            : `${fallbackUrl.pathname}${fallbackUrl.search}${fallbackUrl.hash}`;
    } catch {
        return `${fallbackUrl.pathname}${fallbackUrl.search}${fallbackUrl.hash}`;
    }
}

function redirectTo(page, next) {
    const url = new URL(page, import.meta.url);
    url.searchParams.set("next", next);
    location.replace(url);
}

export async function requireUser() {
    const user = await waitForAuth();
    const next = `${location.pathname}${location.search}${location.hash}`;

    if (!user) {
        redirectTo("./signin.html", next);
        return new Promise(() => {});
    }

    const profile = await getMemberProfile(user);
    if (isMemberProfileComplete(profile)) return user;

    redirectTo("./register.html", next);
    return new Promise(() => {});
}

export async function signInWithGoogle() {
    const result = await signInWithPopup(auth, provider);
    return result.user;
}

export async function registerMember(user, studentNumber, studentName, privacyConsent) {
    if (!user) {
        throw new Error("로그인한 사용자만 회원 정보를 등록할 수 있습니다.");
    }
    if (privacyConsent !== true) {
        throw new Error("개인정보 수집·이용에 동의해야 참여할 수 있습니다.");
    }

    const normalizedStudentNumber = String(studentNumber || "").trim();
    const normalizedStudentName = String(studentName || "").trim();
    if (!STUDENT_NUMBER_PATTERN.test(normalizedStudentNumber)) {
        throw new Error("학번은 숫자 4~20자리로 입력해 주세요.");
    }
    if (!STUDENT_NAME_PATTERN.test(normalizedStudentName)) {
        throw new Error("이름 형식을 확인해 주세요.");
    }

    const reference = doc(db, "users", user.uid);
    const snapshot = await getDoc(reference);
    const profile = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        studentNumber: normalizedStudentNumber,
        studentName: normalizedStudentName,
        privacyConsent: true,
        privacyConsentVersion: PRIVACY_CONSENT_VERSION,
        privacyConsentAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
    };

    if (!snapshot.exists()) {
        profile.createdAt = serverTimestamp();
        profile.registeredAt = serverTimestamp();
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
    if (!window.confirm("로그아웃하면 다시 로그인해야 진행 상황을 확인할 수 있습니다. 로그아웃할까요?")) return;
    await signOut(auth);
    location.replace(new URL("./signin.html", import.meta.url));
}
