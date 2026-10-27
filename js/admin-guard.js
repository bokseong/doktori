import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getUserAccess, requireUser } from "./auth.js";
import { db } from "./firebase.js";

const user = await requireUser();
let access = await getUserAccess(user);
let requiredLevel = "booth";
let writeBlockReason = navigator.onLine ? null : "network";

const safetyMessage = document.createElement("p");
safetyMessage.id = "adminSafetyMessage";
safetyMessage.className = "status";
safetyMessage.setAttribute("role", "alert");
safetyMessage.hidden = true;

function mountSafetyMessage() {
    if (safetyMessage.isConnected) return;
    const anchor = document.querySelector("header, main");
    (anchor?.parentNode || document.body).insertBefore(safetyMessage, anchor?.nextSibling || null);
}

function applyWriteSafety() {
    mountSafetyMessage();
    document.querySelectorAll("[data-admin-write]").forEach((control) => {
        if (writeBlockReason) {
            if (!control.disabled) control.dataset.adminSafetyDisabled = "true";
            control.disabled = true;
        } else if (control.dataset.adminSafetyDisabled === "true") {
            control.disabled = false;
            delete control.dataset.adminSafetyDisabled;
        }
    });
}

export function isAdminWriteBlocked() {
    return Boolean(writeBlockReason);
}

export function clearAdminError() {
    if (!navigator.onLine || writeBlockReason === "permission") return;
    writeBlockReason = null;
    safetyMessage.hidden = true;
    safetyMessage.textContent = "";
    applyWriteSafety();
}

export function reportAdminError(error, localTarget = null, fallback = "관리자 데이터를 처리하지 못했습니다.") {
    const code = String(error?.code || "");
    const permission = code.includes("permission-denied") || code.includes("unauthenticated");
    const network = !navigator.onLine || ["unavailable", "deadline-exceeded", "network-request-failed"].some((item) => code.includes(item));
    const message = permission
        ? "권한 확인에 실패했습니다. 관리자 등급과 배포된 보안 규칙을 확인하세요. 저장 기능을 비활성화했습니다."
        : network
            ? "네트워크 연결을 확인할 수 없습니다. 연결이 복구될 때까지 저장 기능을 비활성화했습니다."
            : fallback;
    if (permission) writeBlockReason = "permission";
    else if (network) writeBlockReason = "network";
    if (localTarget) localTarget.textContent = message;
    safetyMessage.textContent = message;
    safetyMessage.hidden = false;
    applyWriteSafety();
    return message;
}

window.addEventListener("offline", () => reportAdminError({ code: "network-request-failed" }));
window.addEventListener("online", () => {
    if (writeBlockReason === "network") clearAdminError();
});
new MutationObserver(applyWriteSafety).observe(document.documentElement, { childList: true, subtree: true });
if (writeBlockReason === "network") reportAdminError({ code: "network-request-failed" });
else applyWriteSafety();

function deny() {
    location.replace(new URL("../index.html", import.meta.url));
}

if (!access.isAdmin) {
    deny();
    await new Promise(() => {});
}

const stopWatching = onSnapshot(doc(db, "users", user.uid), async () => {
    access = await getUserAccess(user);
    if (!hasLevel(requiredLevel)) deny();
    clearAdminError();
}, (error) => reportAdminError(error, null, "관리자 권한을 다시 확인하지 못했습니다."));
window.addEventListener("pagehide", () => stopWatching(), { once: true });

function hasLevel(level) {
    return level === "booth" ? access.canManageBooths : access.isGrade1;
}

export function requireAdminLevel(level = "grade1") {
    requiredLevel = level;
    if (hasLevel(level)) return true;
    location.replace(new URL("../admin/", import.meta.url));
    return false;
}

export function requireHubEntry({ fallbackUrl = "./index.html", level = "grade1" } = {}) {
    if (!requireAdminLevel(level)) return false;
    const key = "doktori-admin-hub-entry";
    let ticket = null;
    try { ticket = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { /* ignore */ }
    const valid = ticket
        && ticket.path === location.pathname
        && Number.isFinite(ticket.issuedAt)
        && Date.now() - ticket.issuedAt < 10 * 60 * 1000;
    if (!valid) {
        location.replace(new URL(fallbackUrl, location.href));
        return false;
    }
    return true;
}

export { user as adminUser, access as adminAccess };
