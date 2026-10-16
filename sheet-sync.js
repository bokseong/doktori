import { getLimitedUseToken } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import { appCheck } from "./firebase.js";

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

export function syncMemberToSheet(user) {
    return postSheetSync(user, { action: "profile" });
}

export function syncProgressToSheet(user, qrId) {
    return postSheetSync(user, { action: "progress", qrId });
}
