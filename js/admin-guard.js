import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getUserAccess, requireUser } from "./auth.js";
import { db } from "./firebase.js";

const user = await requireUser();
let access = await getUserAccess(user);

function deny() {
    location.replace(new URL("../index.html", import.meta.url));
}

if (!access.isAdmin) {
    deny();
    await new Promise(() => {});
}

const stopWatching = onSnapshot(doc(db, "users", user.uid), async () => {
    access = await getUserAccess(user);
    if (!access.isAdmin) deny();
}, () => {
    // 네트워크 오류만으로 관리자를 로그아웃시키지 않습니다. 다음 쓰기 규칙 검증이 최종 방어선입니다.
});
window.addEventListener("pagehide", () => stopWatching(), { once: true });

export function requireHubEntry() {
    const key = "doktori-admin-hub-entry";
    let ticket = null;
    try { ticket = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { /* ignore */ }
    const valid = ticket
        && ticket.path === location.pathname
        && Number.isFinite(ticket.issuedAt)
        && Date.now() - ticket.issuedAt < 10 * 60 * 1000;
    if (!valid) {
        location.replace(new URL("./index.html", location.href));
        return false;
    }
    return true;
}

export { user as adminUser, access as adminAccess };
