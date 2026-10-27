import {
    deleteUser,
    GoogleAuthProvider,
    onAuthStateChanged,
    reauthenticateWithPopup,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    deleteField,
    doc,
    getDoc,
    serverTimestamp,
    setDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

export const MASTER_ADMIN_EMAIL = "github.jwastro09@gmail.com";
export const PRIVACY_CONSENT_VERSION = "2026-10-28-v3";
export const TERMS_CONSENT_VERSION = "2026-10-28-v1";

const STUDENT_NUMBER_PATTERN = /^[0-9]{4,20}$/;
const STUDENT_NAME_PATTERN = /^[가-힣A-Za-z][가-힣A-Za-z .·-]{0,29}$/u;
const AUTH_RETURN_KEY = "doktori-auth-return";

function normalizeIdentityPart(value) {
    return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function identityReservationId(studentNumber, studentName) {
    return `${normalizeIdentityPart(studentNumber)}~${normalizeIdentityPart(studentName)}`;
}

export function normalizeRole(role) {
    if (role === "admin") return "grade1";
    if (role === "participant") return "member";
    return role || "member";
}

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function isMasterAdmin(user) {
    return (user?.email || "").toLowerCase() === MASTER_ADMIN_EMAIL;
}

export function waitForAuth(timeoutMilliseconds = 10000) {
    return new Promise((resolve, reject) => {
        let unsubscribe = () => {};
        const timeout = setTimeout(() => {
            unsubscribe();
            const error = new Error("로그인 상태 확인 시간이 초과되었습니다.");
            error.code = "auth/state-timeout";
            reject(error);
        }, timeoutMilliseconds);

        unsubscribe = onAuthStateChanged(auth, (user) => {
            clearTimeout(timeout);
            unsubscribe();
            resolve(user);
        }, (error) => {
            clearTimeout(timeout);
            unsubscribe();
            reject(error);
        });
    });
}

export function isMemberProfileComplete(profile) {
    return Boolean(
        STUDENT_NUMBER_PATTERN.test(profile?.studentNumber || "")
        && STUDENT_NAME_PATTERN.test(profile?.studentName || "")
        && profile?.identityReservationId === identityReservationId(profile?.studentNumber, profile?.studentName)
        && profile?.privacyConsent === true
        && profile?.privacyConsentVersion === PRIVACY_CONSENT_VERSION
        && profile?.termsConsent === true
        && profile?.termsConsentVersion === TERMS_CONSENT_VERSION
    );
}

export function isAccountBlocked(profile) {
    return profile?.accountStatus === "blocked";
}

export async function getMemberProfile(user = auth.currentUser) {
    if (!user) return null;
    const snapshot = await getDoc(doc(db, "users", user.uid));
    return snapshot.exists() ? snapshot.data() : null;
}

export function getSafeNext(fallback = "./index.html") {
    const fallbackUrl = new URL(fallback, location.href);
    const requested = new URLSearchParams(location.search).get("next");
    const stored = sessionStorage.getItem(AUTH_RETURN_KEY);
    for (const candidate of [requested, stored]) {
        if (!candidate) continue;
        try {
            const target = new URL(candidate, location.href);
            const isAuthPage = /\/(?:signin|register)\.html$/i.test(target.pathname);
            if (target.origin !== location.origin || isAuthPage) continue;
            const safe = `${target.pathname}${target.search}${target.hash}`;
            sessionStorage.setItem(AUTH_RETURN_KEY, safe);
            return safe;
        } catch { /* 다음 후보를 확인합니다. */ }
    }
    return `${fallbackUrl.pathname}${fallbackUrl.search}${fallbackUrl.hash}`;
}

export function rememberAuthReturn(next) {
    try {
        const target = new URL(next, location.href);
        const isAuthPage = /\/(?:signin|register)\.html$/i.test(target.pathname);
        if (target.origin !== location.origin || isAuthPage) return;
        sessionStorage.setItem(AUTH_RETURN_KEY, `${target.pathname}${target.search}${target.hash}`);
    } catch { /* 잘못된 주소는 저장하지 않습니다. */ }
}

export function clearAuthReturn() {
    sessionStorage.removeItem(AUTH_RETURN_KEY);
}

function redirectTo(page, next) {
    const url = new URL(page, import.meta.url);
    url.searchParams.set("next", next);
    location.replace(url);
}

export async function requireUser({ allowBlocked = false } = {}) {
    const user = await waitForAuth();
    const next = `${location.pathname}${location.search}${location.hash}`;
    rememberAuthReturn(next);

    if (!user) {
        redirectTo("../account/signin.html", next);
        return new Promise(() => {});
    }

    const profile = await getMemberProfile(user);
    if (isAccountBlocked(profile) && !allowBlocked) {
        location.replace(new URL("../account/blocked.html", import.meta.url));
        return new Promise(() => {});
    }
    if (isMemberProfileComplete(profile)) return user;

    redirectTo("../account/register.html", next);
    return new Promise(() => {});
}

export async function signInWithGoogle() {
    const result = await signInWithPopup(auth, provider);
    return result.user;
}

export async function registerMember(user, studentNumber, studentName, privacyConsent, termsConsent) {
    if (!user) {
        throw new Error("로그인한 사용자만 회원 정보를 등록할 수 있습니다.");
    }
    if (privacyConsent !== true) {
        throw new Error("개인정보 수집·이용에 동의해야 참여할 수 있습니다.");
    }
    if (termsConsent !== true) {
        throw new Error("독토리 이용약관에 동의해야 참여할 수 있습니다.");
    }

    const normalizedStudentNumber = String(studentNumber || "").normalize("NFKC").trim();
    const normalizedStudentName = String(studentName || "").normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!STUDENT_NUMBER_PATTERN.test(normalizedStudentNumber)) {
        throw new Error("학번은 숫자 4~20자리로 입력해 주세요.");
    }
    if (!STUDENT_NAME_PATTERN.test(normalizedStudentName)) {
        throw new Error("이름 형식을 확인해 주세요.");
    }

    const reference = doc(db, "users", user.uid);
    const snapshot = await getDoc(reference);
    if (snapshot.exists() && isAccountBlocked(snapshot.data())) {
        throw new Error("차단된 계정은 회원 정보를 변경할 수 없습니다.");
    }
    if (snapshot.exists()) {
        const previous = snapshot.data();
        const changedIdentity = previous.studentNumber && previous.studentName
            && (normalizeIdentityPart(previous.studentNumber) !== normalizeIdentityPart(normalizedStudentNumber)
                || normalizeIdentityPart(previous.studentName) !== normalizeIdentityPart(normalizedStudentName));
        if (changedIdentity) throw new Error("등록한 학번·이름은 직접 변경할 수 없습니다. 관리자에게 문의해 주세요.");
    }
    const reservationId = identityReservationId(normalizedStudentNumber, normalizedStudentName);
    const profile = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        studentNumber: normalizedStudentNumber,
        studentName: normalizedStudentName,
        identityReservationId: reservationId,
        privacyConsent: true,
        privacyConsentVersion: PRIVACY_CONSENT_VERSION,
        privacyConsentAt: serverTimestamp(),
        termsConsent: true,
        termsConsentVersion: TERMS_CONSENT_VERSION,
        termsConsentAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
    };

    if (!snapshot.exists()) {
        profile.createdAt = serverTimestamp();
        profile.registeredAt = serverTimestamp();
        profile.role = isMasterAdmin(user) ? "grade1" : "member";
    } else if (isMasterAdmin(user) && normalizeRole(snapshot.data().role) !== "grade1") {
        profile.role = "grade1";
    }

    const batch = writeBatch(db);
    batch.set(doc(db, "identityReservations", reservationId), {
        identityKey: reservationId,
        uid: user.uid,
        updatedAt: serverTimestamp()
    });
    batch.set(reference, profile, { merge: true });
    try {
        await batch.commit();
    } catch (error) {
        if (error?.code === "permission-denied") {
            const duplicate = new Error("이미 존재하는 계정입니다.");
            duplicate.code = "registration/duplicate-identity";
            throw duplicate;
        }
        throw error;
    }
    return { ...(snapshot.exists() ? snapshot.data() : {}), ...profile };
}

export async function touchMemberProfile(user) {
    const profile = await getMemberProfile(user);
    if (isAccountBlocked(profile)) return profile;
    if (!isMemberProfileComplete(profile)) return profile;

    const update = {
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        lastLoginAt: serverTimestamp(),
        ...(Object.prototype.hasOwnProperty.call(profile, "storyMode") ? { storyMode: deleteField() } : {})
    };
    if (isMasterAdmin(user) && normalizeRole(profile.role) !== "grade1") update.role = "grade1";
    await setDoc(doc(db, "users", user.uid), update, { merge: true });
    return { ...profile, ...update };
}

export async function getUserAccess(user = auth.currentUser) {
    if (!user) return { role: null, isAdmin: false, isGrade1: false, isGrade2: false, canManageBooths: false, isBlocked: false };
    if (isMasterAdmin(user)) return { role: "grade1", isAdmin: true, isGrade1: true, isGrade2: false, canManageBooths: true, isBlocked: false };

    const profile = await getMemberProfile(user);
    const role = normalizeRole(profile?.role);
    const isBlocked = isAccountBlocked(profile);
    const isGrade1 = role === "grade1" && !isBlocked;
    const isGrade2 = role === "grade2" && !isBlocked;
    return { role, isAdmin: isGrade1 || isGrade2, isGrade1, isGrade2, canManageBooths: isGrade1 || isGrade2, isBlocked };
}

export async function logout() {
    if (!window.confirm("로그아웃하면 다시 로그인해야 진행 상황을 확인할 수 있습니다. 로그아웃할까요?")) return;
    await signOut(auth);
    location.replace(new URL("../account/signin.html", import.meta.url));
}

export async function deleteMemberAccount(user = auth.currentUser) {
    if (!user) throw new Error("로그인한 사용자만 회원 탈퇴를 진행할 수 있습니다.");
    if (isMasterAdmin(user)) throw new Error("마스터 관리자 계정은 사이트에서 탈퇴할 수 없습니다.");

    await reauthenticateWithPopup(user, provider);
    await setDoc(doc(db, "users", user.uid), {
        role: "withdrawn",
        withdrawnAt: serverTimestamp(),
        lastActivityAt: serverTimestamp()
    }, { merge: true });
    await deleteUser(user);
}
