import { getLimitedUseToken } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    increment,
    query,
    serverTimestamp,
    setDoc,
    where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { appCheck } from "./firebase.js";
import { db } from "./firebase.js";

export const SHEET_SYNC_URL = "https://script.google.com/macros/s/AKfycbzoFNZlH3gEvRaHImoIsXIzwcphOQYnPdNhC2EJqHDJ9GnggGQOkhBvKiCr4uBXhdVg3w/exec";

async function postSheetSync(user, payload) {
    if (SHEET_SYNC_URL.startsWith("__")) {
        throw new Error("Google Sheets 동기화 URL이 설정되지 않았습니다.");
    }

    const idToken = await user.getIdToken();
    const appCheckToken = await getLimitedUseToken(appCheck);
    await fetch(SHEET_SYNC_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
            idToken,
            appCheckToken: appCheckToken.token,
            ...payload
        })
    });
}

function queueId(user, payload) {
    return `${user.uid}_${payload.action}_${payload.qrId || "profile"}`;
}

async function queueFailedSync(user, payload, error) {
    await setDoc(doc(db, "syncQueue", queueId(user, payload)), {
        uid: user.uid,
        action: payload.action,
        qrId: payload.qrId || "",
        attempts: increment(1),
        lastErrorCode: String(error?.code || error?.name || "network-error").slice(0, 80),
        lastAttemptAt: serverTimestamp(),
        createdAt: serverTimestamp()
    }, { merge: true });
}

async function syncWithQueue(user, payload) {
    try {
        await postSheetSync(user, payload);
        await deleteDoc(doc(db, "syncQueue", queueId(user, payload))).catch(() => {});
        return { queued: false };
    } catch (error) {
        await queueFailedSync(user, payload, error).catch(() => {});
        return { queued: true, error };
    }
}

export function syncMemberToSheet(user) {
    return syncWithQueue(user, { action: "profile" });
}

export function queueMemberSheetSync(user) {
    return queueFailedSync(user, { action: "profile" }, { code: "pending-navigation" });
}

export function syncProgressToSheet(user, qrId) {
    return syncWithQueue(user, { action: "progress", qrId });
}

export async function retryPendingSheetSyncs(user) {
    if (!user || !navigator.onLine) return { retried: 0, remaining: 0 };
    const snapshot = await getDocs(query(
        collection(db, "syncQueue"),
        where("uid", "==", user.uid)
    ));
    const pending = snapshot.docs;
    let retried = 0;
    for (const item of pending) {
        const data = item.data();
        try {
            await postSheetSync(user, { action: data.action, ...(data.qrId ? { qrId: data.qrId } : {}) });
            await deleteDoc(item.ref);
            retried += 1;
        } catch (error) {
            await setDoc(item.ref, {
                attempts: increment(1),
                lastErrorCode: String(error?.code || error?.name || "network-error").slice(0, 80),
                lastAttemptAt: serverTimestamp()
            }, { merge: true });
        }
    }
    return { retried, remaining: pending.length - retried };
}
