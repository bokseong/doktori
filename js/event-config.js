import { doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

export const BOOTH_IDS = Object.freeze(["booth1", "booth2", "booth3", "booth4", "booth5", "booth6"]);

export const DEFAULT_EVENT_CONFIG = Object.freeze({
    notice: "2·3층 곳곳의 QR 6개 중 3개 이상을 완료하면 QR 미션 성공입니다.",
    participationEnabled: true,
    startAt: null,
    endAt: null,
    retentionAt: null,
    qrStatus: Object.freeze({ qr1: "active", qr2: "active", qr3: "active", qr4: "active", qr5: "active", qr6: "active" }),
    boothStatus: Object.freeze({ booth1: "active", booth2: "active", booth3: "active", booth4: "active", booth5: "active", booth6: "active" })
});

function normalizeConfig(data = {}) {
    return {
        ...DEFAULT_EVENT_CONFIG,
        ...data,
        qrStatus: { ...DEFAULT_EVENT_CONFIG.qrStatus, ...(data.qrStatus || {}) },
        boothStatus: { ...DEFAULT_EVENT_CONFIG.boothStatus, ...(data.boothStatus || {}) }
    };
}

export async function getEventConfig() {
    const snapshot = await getDoc(doc(db, "eventConfig", "current"));
    return normalizeConfig(snapshot.exists() ? snapshot.data() : {});
}

export function watchEventConfig(onChange, onError = () => {}) {
    return onSnapshot(doc(db, "eventConfig", "current"), (snapshot) => onChange(normalizeConfig(snapshot.exists() ? snapshot.data() : {})), onError);
}

export function getMissionAvailability(config, qrId, now = new Date()) {
    if (config.participationEnabled === false) {
        return { available: false, message: "현재 QR 이벤트 참여가 일시 중지되어 있습니다. 운영 안내를 확인해 주세요." };
    }
    const start = config.startAt?.toDate?.();
    const end = config.endAt?.toDate?.();
    if (start && now < start) return { available: false, message: `행사는 ${start.toLocaleString("ko-KR")}부터 시작합니다.` };
    if (end && now > end) return { available: false, message: "행사가 종료되어 더 이상 답안을 제출할 수 없습니다." };
    const status = config.qrStatus?.[qrId] || "active";
    if (status === "paused") return { available: false, message: "이 QR 문제는 현재 운영자가 일시 중지했습니다." };
    if (status === "closed") return { available: false, message: "이 QR 문제는 종료되었습니다." };
    return { available: true, message: "" };
}

export function getQrEventAvailability(config, now = new Date()) {
    if (config.participationEnabled === false) return { available: false, message: "현재 QR 이벤트 참여가 일시 중지되어 있습니다." };
    const start = config.startAt?.toDate?.();
    const end = config.endAt?.toDate?.();
    if (start && now < start) return { available: false, message: `행사는 ${start.toLocaleString("ko-KR")}부터 시작합니다.` };
    if (end && now > end) return { available: false, message: "행사가 종료되었습니다." };
    const states = Object.values(config.qrStatus || {});
    const activeCount = states.filter((state) => state === "active").length;
    if (!activeCount) return { available: false, message: "현재 진행 가능한 QR이 없습니다." };
    return { available: true, partial: activeCount < 6, message: activeCount < 6 ? `현재 QR ${activeCount}개를 진행할 수 있습니다.` : "" };
}

export function getBoothAvailability(config, boothId, now = new Date()) {
    if (config.participationEnabled === false) return { available: false, message: "현재 행사 참여가 일시 중지되어 있습니다." };
    const start = config.startAt?.toDate?.();
    const end = config.endAt?.toDate?.();
    if (start && now < start) return { available: false, message: "행사 시작 전입니다." };
    if (end && now > end) return { available: false, message: "행사가 종료되었습니다." };
    const status = config.boothStatus?.[boothId] || "active";
    if (status === "paused") return { available: false, message: "이 부스는 현재 참여를 잠시 받고 있지 않습니다." };
    return { available: true, message: "" };
}

