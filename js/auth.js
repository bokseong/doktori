import {
    deleteUser,
    GoogleAuthProvider,
    onAuthStateChanged,
    reauthenticateWithPopup,
    signInWithPopup,
    signOut
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    serverTimestamp,
    setDoc,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

export const MASTER_ADMIN_EMAIL = "github.jwastro09@gmail.com";
export const PRIVACY_CONSENT_VERSION = "2026-10-19-v2";

const STUDENT_NUMBER_PATTERN = /^[0-9]{4,20}$/;
const STUDENT_NAME_PATTERN = /^[가-힣A-Za-z][가-힣A-Za-z .·-]{0,29}$/u;
const QR_IDS = Array.from({ length: 6 }, (_, index) => `qr${index + 1}`);

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
        && profile?.privacyConsent === true
        && profile?.privacyConsentVersion === PRIVACY_CONSENT_VERSION
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

export async function requireUser({ allowBlocked = false } = {}) {
    const user = await waitForAuth();
    const next = `${location.pathname}${location.search}${location.hash}`;

    if (!user) {
        redirectTo("../signin.html", next);
        return new Promise(() => {});
    }

    const profile = await getMemberProfile(user);
    if (isAccountBlocked(profile) && !allowBlocked) {
        location.replace(new URL("../blocked.html", import.meta.url));
        return new Promise(() => {});
    }
    if (isMemberProfileComplete(profile)) return user;

    redirectTo("../register.html", next);
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
    if (snapshot.exists() && isAccountBlocked(snapshot.data())) {
        throw new Error("차단된 계정은 회원 정보를 변경할 수 없습니다.");
    }
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
    if (isAccountBlocked(profile)) return profile;
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
    if (!user) return { role: null, isAdmin: false, isBlocked: false };
    if (isMasterAdmin(user)) return { role: "admin", isAdmin: true, isBlocked: false };

    const profile = await getMemberProfile(user);
    const role = profile?.role || "participant";
    const isBlocked = isAccountBlocked(profile);
    return { role, isAdmin: role === "admin" && !isBlocked, isBlocked };
}

export async function logout() {
    if (!window.confirm("로그아웃하면 다시 로그인해야 진행 상황을 확인할 수 있습니다. 로그아웃할까요?")) return;
    await signOut(auth);
    location.replace(new URL("../signin.html", import.meta.url));
}

async function deleteOwnedDocuments(collectionName, uid) {
    while (true) {
        const snapshot = await getDocs(query(
            collection(db, collectionName),
            where("uid", "==", uid),
            limit(300)
        ));
        if (snapshot.empty) return;
        const batch = writeBatch(db);
        snapshot.docs.forEach((item) => batch.delete(item.ref));
        await batch.commit();
        if (snapshot.size < 300) return;
    }
}

export async function deleteMemberAccount(user = auth.currentUser) {
    if (!user) throw new Error("로그인한 사용자만 회원 탈퇴를 진행할 수 있습니다.");
    if (isMasterAdmin(user)) throw new Error("마스터 관리자 계정은 사이트에서 탈퇴할 수 없습니다.");

    await reauthenticateWithPopup(user, provider);
    await deleteOwnedDocuments("quizTelemetry", user.uid);
    await deleteOwnedDocuments("clientErrors", user.uid);
    await deleteOwnedDocuments("chatMessages", user.uid);
    while (true) {
        const conversation = await getDocs(query(
            collection(db, "chatMessages"),
            where("conversationUid", "==", user.uid),
            limit(300)
        ));
        if (conversation.empty) break;
        const chatBatch = writeBatch(db);
        conversation.docs.forEach((item) => chatBatch.delete(item.ref));
        await chatBatch.commit();
        if (conversation.size < 300) break;
    }

    const profileBatch = writeBatch(db);
    QR_IDS.forEach((qrId) => {
        profileBatch.delete(doc(db, "users", user.uid, "progress", qrId));
        profileBatch.delete(doc(db, "answerAttempts", `${user.uid}_${qrId}`));
    });
    profileBatch.delete(doc(db, "chatRateLimits", user.uid));
    profileBatch.set(doc(db, "users", user.uid), {
        uid: user.uid,
        email: "",
        displayName: "",
        studentNumber: "0000",
        studentName: "탈퇴회원",
        role: "withdrawn",
        privacyConsent: false,
        privacyConsentVersion: "withdrawn",
        privacyConsentAt: serverTimestamp(),
        withdrawnAt: serverTimestamp(),
        lastActivityAt: serverTimestamp()
    });
    await profileBatch.commit();
    await deleteUser(user);
}
