import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { addDoc, collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getUserAccess } from "./auth.js";
import { auth, db } from "./firebase.js";

let chatShortcut = null;
let stopChatAlerts = () => {};
let stopAccountStatusGuard = () => {};

function startAccountStatusGuard() {
    onAuthStateChanged(auth, (user) => {
        stopAccountStatusGuard();
        stopAccountStatusGuard = () => {};
        if (!user || /\/(?:blocked|chat)\.html$/i.test(location.pathname)) return;
        stopAccountStatusGuard = onSnapshot(doc(db, "users", user.uid), (snapshot) => {
            if (snapshot.exists() && snapshot.data().accountStatus === "blocked") {
                location.replace(new URL("../blocked.html", import.meta.url));
            }
        }, (error) => console.warn("계정 상태를 확인하지 못했습니다.", error));
    });
}

function createNetworkBanner() {
    const banner = document.createElement("div");
    banner.className = "network-banner";
    banner.setAttribute("role", "status");
    banner.hidden = navigator.onLine;
    banner.textContent = "인터넷 연결이 끊겼습니다. 연결 후 저장을 다시 시도해 주세요.";
    document.body.prepend(banner);
    window.addEventListener("offline", () => { banner.hidden = false; });
    window.addEventListener("online", () => {
        banner.textContent = "인터넷 연결이 복구되었습니다.";
        banner.hidden = false;
        setTimeout(() => {
            banner.hidden = true;
            banner.textContent = "인터넷 연결이 끊겼습니다. 연결 후 저장을 다시 시도해 주세요.";
        }, 2200);
    });
}

function createChatShortcut() {
    if (/\/chat\.html$/i.test(location.pathname)) return;
    const link = document.createElement("a");
    link.className = "support-chat-link";
    link.href = new URL("../chat.html", import.meta.url).href;
    link.textContent = "1:1 도움 채팅";
    link.setAttribute("aria-label", "관리자와 1대1 도움 채팅 열기");
    document.body.append(link);
    chatShortcut = link;
}

function showAdminChatAlert(message) {
    if (!chatShortcut) return;
    const identity = [message.studentNumber, message.studentName].filter(Boolean).join(" · ") || "참여자";
    chatShortcut.classList.add("has-new-message");
    chatShortcut.textContent = "1:1 도움 채팅 · 새 메시지";
    chatShortcut.setAttribute("aria-label", `${identity}님의 새 도움 메시지 확인하기`);

    document.querySelector(".admin-chat-alert")?.remove();
    const alert = document.createElement("a");
    alert.className = "admin-chat-alert";
    const conversationUrl = new URL(chatShortcut.href);
    if (message.conversationUid) conversationUrl.searchParams.set("user", message.conversationUid);
    alert.href = conversationUrl.href;
    alert.setAttribute("role", "status");
    const title = document.createElement("strong");
    title.textContent = `새 도움 메시지 · ${identity}`;
    const preview = document.createElement("span");
    preview.textContent = String(message.text || "메시지를 확인해 주세요.").slice(0, 80);
    alert.append(title, preview);
    document.body.append(alert);
    setTimeout(() => alert.remove(), 8000);
}

function startAdminChatAlerts() {
    onAuthStateChanged(auth, async (user) => {
        stopChatAlerts();
        stopChatAlerts = () => {};
        if (!user || /\/chat\.html$/i.test(location.pathname)) return;
        try {
            const access = await getUserAccess(user);
            if (!access.isAdmin) return;
            let initialSnapshotReceived = false;
            const latestMessage = query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(1));
            stopChatAlerts = onSnapshot(latestMessage, (snapshot) => {
                if (!initialSnapshotReceived) {
                    initialSnapshotReceived = true;
                    return;
                }
                snapshot.docChanges().forEach((change) => {
                    const message = change.doc.data();
                    if (change.type === "added" && !change.doc.metadata.hasPendingWrites && message.senderRole === "participant" && message.senderUid !== user.uid) {
                        showAdminChatAlert(message);
                    }
                });
            }, (error) => console.warn("관리자 채팅 알림을 불러오지 못했습니다.", error));
        } catch (error) {
            console.warn("관리자 권한을 확인하지 못해 채팅 알림을 시작하지 않았습니다.", error);
        }
    });
}

function createAnnouncementPopup() {
    const overlay = document.createElement("div");
    overlay.className = "announcement-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `<section class="announcement-card" role="alertdialog" aria-modal="true" aria-labelledby="doktoriAnnouncementTitle"><span class="announcement-label">LIVE NOTICE</span><h2 id="doktoriAnnouncementTitle"></h2><p></p><button type="button">확인</button></section>`;
    const card = overlay.querySelector(".announcement-card");
    const title = card.querySelector("h2");
    const message = card.querySelector("p");
    const close = card.querySelector("button");
    const dismiss = () => {
        overlay.hidden = true;
        document.body.classList.remove("announcement-open");
    };
    close.addEventListener("click", dismiss);
    overlay.addEventListener("click", (event) => { if (event.target === overlay) dismiss(); });
    document.body.append(overlay);

    onSnapshot(doc(db, "announcements", "current"), (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (data.active !== true || !data.title || !data.message) return;
        const revision = `${data.updatedAt?.seconds || 0}:${data.title}:${data.message}`;
        if (sessionStorage.getItem("doktori-announcement-seen") === revision) return;
        sessionStorage.setItem("doktori-announcement-seen", revision);
        title.textContent = String(data.title).slice(0, 80);
        message.textContent = String(data.message).slice(0, 500);
        card.dataset.severity = ["info", "warning", "urgent"].includes(data.severity) ? data.severity : "info";
        overlay.hidden = false;
        document.body.classList.add("announcement-open");
        close.focus();
    }, (error) => console.warn("실시간 공지를 불러오지 못했습니다.", error));
}

async function reportError(error, context) {
    if (window.__DOKTORI_ACCOUNT_DELETING__ === true) return;
    const user = auth.currentUser;
    if (!user) return;
    const code = String(error?.code || error?.name || "unknown").slice(0, 80);
    try {
        await addDoc(collection(db, "clientErrors"), {
            uid: user.uid,
            code,
            context: String(context || "page").slice(0, 80),
            path: location.pathname.slice(0, 180),
            online: navigator.onLine,
            createdAt: serverTimestamp()
        });
    } catch {
        // 오류 기록 실패가 사용자 흐름을 방해하지 않도록 무시합니다.
    }
}

window.addEventListener("error", (event) => reportError(event.error || { name: "window-error" }, "window-error"));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason || { name: "unhandled-rejection" }, "unhandled-rejection"));

createNetworkBanner();
startAccountStatusGuard();
createChatShortcut();
startAdminChatAlerts();
createAnnouncementPopup();

if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url)).catch((error) => reportError(error, "service-worker"));
}

