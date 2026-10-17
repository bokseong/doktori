import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

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

async function reportError(error, context) {
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

if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register(new URL("./sw.js", import.meta.url)).catch((error) => reportError(error, "service-worker"));
}

