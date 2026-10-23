import { doc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { adminAccess, adminUser, requireHubEntry } from "./admin-guard.js";
import { BOOTH_IDS, DEFAULT_EVENT_CONFIG, getEventConfig, watchEventConfig } from "./event-config.js";
import { db } from "./firebase.js";

const BOOTHS = Object.freeze([
    { id: "booth1", number: "01", name: "프랑켄슈타인 박사의 도서 대출" },
    { id: "booth2", number: "02", name: "물약을 완성하라!" },
    { id: "booth3", number: "03", name: "잭오랜턴 부적 인형 만들기" },
    { id: "booth4", number: "04", name: "카드뽑기 · 상품 수령" },
    { id: "booth5", number: "05", name: "포토존" },
    { id: "booth6", number: "06", name: "방명록" }
]);

if (!requireHubEntry({ fallbackUrl: "../", level: "booth" })) await new Promise(() => {});

const panel = document.getElementById("boothAvailabilityPanel");
const grid = document.getElementById("boothAvailabilityGrid");
const save = document.getElementById("saveBoothAvailability");
const message = document.getElementById("boothAvailabilityMessage");
let currentConfig = null;

if (!adminAccess.isGrade1) {
    panel.hidden = true;
} else {
    BOOTHS.forEach((booth) => {
        const label = document.createElement("label");
        label.htmlFor = `booth-availability-${booth.id}`;
        const title = document.createElement("strong");
        title.textContent = `${booth.number} · ${booth.name}`;
        const select = document.createElement("select");
        select.id = `booth-availability-${booth.id}`;
        select.dataset.boothAvailability = booth.id;
        select.append(new Option("참여 가능", "active"), new Option("참여 불가능", "paused"));
        label.append(title, select);
        grid.append(label);
    });
    panel.hidden = false;

    const render = (config) => {
        currentConfig = config;
        BOOTH_IDS.forEach((boothId) => {
            const select = document.querySelector(`[data-booth-availability="${boothId}"]`);
            if (select) select.value = config.boothStatus?.[boothId] || "active";
        });
    };
    const stopConfig = watchEventConfig(render, () => {
        message.textContent = "부스 참여 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    });

    save.addEventListener("click", async () => {
        save.disabled = true;
        message.textContent = "부스 참여 상태를 저장하는 중...";
        const boothStatus = Object.fromEntries(BOOTH_IDS.map((boothId) => [
            boothId,
            document.querySelector(`[data-booth-availability="${boothId}"]`)?.value === "paused" ? "paused" : "active"
        ]));
        const config = currentConfig || await getEventConfig();
        try {
            await setDoc(doc(db, "eventConfig", "current"), {
                notice: config.notice || DEFAULT_EVENT_CONFIG.notice,
                participationEnabled: config.participationEnabled !== false,
                startAt: config.startAt || null,
                endAt: config.endAt || null,
                retentionAt: config.retentionAt || null,
                qrStatus: { ...DEFAULT_EVENT_CONFIG.qrStatus, ...(config.qrStatus || {}) },
                boothStatus,
                updatedAt: serverTimestamp(),
                updatedBy: adminUser.uid
            });
            message.textContent = "저장했습니다. 메인 화면의 부스 상태가 즉시 갱신됩니다.";
        } catch (error) {
            console.error(error);
            message.textContent = error.code === "permission-denied"
                ? "저장 권한이 없습니다. 1급 관리자 권한과 보안 규칙 배포 상태를 확인하세요."
                : "부스 참여 상태를 저장하지 못했습니다.";
        } finally {
            save.disabled = false;
        }
    });
    window.addEventListener("pagehide", () => stopConfig(), { once: true });
}
