import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { auth, db } from "./firebase.js";

const STORAGE_KEY = "doktori-ui-preferences";
const defaults = { contrast: false, largeText: false, reduceMotion: false };
let installPrompt = null;

function installUtilityStyles() {
    const style = document.createElement("style");
    style.textContent = `
        .utility-toggle{position:fixed;right:14px;bottom:14px;z-index:1001;padding:10px 14px;border:2px solid #171717;border-radius:0;background:#171717;color:#fff;font-weight:700;box-shadow:3px 3px 0 #ff664d}
        .utility-panel{position:fixed;right:14px;bottom:64px;z-index:1000;display:grid;gap:10px;min-width:210px;padding:16px;border:2px solid #171717;background:#fffdf4;color:#171717;box-shadow:5px 5px 0 #171717;text-align:left}
        .utility-panel[hidden],.network-banner[hidden]{display:none!important}.utility-option{display:flex;gap:8px;align-items:center}.utility-install{padding:9px}
        .network-banner{position:sticky;top:0;z-index:2000;padding:9px 16px;background:#171717;color:#fff;text-align:center;font-weight:700}
        html.large-text{font-size:118%}html.reduce-motion *,html.reduce-motion *::before,html.reduce-motion *::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
        html.high-contrast{filter:contrast(1.25)}html.high-contrast body{background-color:#fff!important}
    `;
    document.head.append(style);
}

function readPreferences() {
    try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
        return { ...defaults };
    }
}

function applyPreferences(preferences) {
    document.documentElement.classList.toggle("high-contrast", preferences.contrast);
    document.documentElement.classList.toggle("large-text", preferences.largeText);
    document.documentElement.classList.toggle("reduce-motion", preferences.reduceMotion);
}

function savePreferences(preferences) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    applyPreferences(preferences);
}

function createUtilityPanel() {
    const preferences = readPreferences();
    applyPreferences(preferences);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "utility-toggle button--ink";
    toggle.textContent = "화면 설정";
    toggle.setAttribute("aria-expanded", "false");

    const panel = document.createElement("aside");
    panel.className = "utility-panel panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "화면 및 설치 설정");

    const title = document.createElement("strong");
    title.textContent = "보기 편하게 조정";
    panel.append(title);

    const options = [
        ["contrast", "고대비"],
        ["largeText", "글자 크게"],
        ["reduceMotion", "움직임 줄이기"]
    ];
    options.forEach(([key, labelText]) => {
        const label = document.createElement("label");
        label.className = "utility-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = preferences[key];
        input.addEventListener("change", () => {
            preferences[key] = input.checked;
            savePreferences(preferences);
        });
        label.append(input, document.createTextNode(labelText));
        panel.append(label);
    });

    const install = document.createElement("button");
    install.type = "button";
    install.className = "utility-install button--paper";
    install.textContent = "홈 화면에 설치";
    install.hidden = true;
    install.addEventListener("click", async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        install.hidden = true;
    });
    panel.append(install);

    toggle.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    document.body.append(toggle, panel);

    window.addEventListener("beforeinstallprompt", (event) => {
        event.preventDefault();
        installPrompt = event;
        install.hidden = false;
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

installUtilityStyles();
createUtilityPanel();
createNetworkBanner();

if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register(new URL("./sw.js", import.meta.url)).catch((error) => reportError(error, "service-worker"));
}

