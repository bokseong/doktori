import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

export const DEFAULT_EVENT_CONFIG = Object.freeze({
    notice: "학교 곳곳에 숨은 QR을 찾아 6개의 미션을 완료하세요.",
    startAt: null,
    endAt: null,
    retentionAt: null,
    qrStatus: Object.freeze({ qr1: "active", qr2: "active", qr3: "active", qr4: "active", qr5: "active", qr6: "active" })
});

export async function getEventConfig() {
    const snapshot = await getDoc(doc(db, "eventConfig", "current"));
    if (!snapshot.exists()) return { ...DEFAULT_EVENT_CONFIG, qrStatus: { ...DEFAULT_EVENT_CONFIG.qrStatus } };
    const data = snapshot.data();
    return {
        ...DEFAULT_EVENT_CONFIG,
        ...data,
        qrStatus: { ...DEFAULT_EVENT_CONFIG.qrStatus, ...(data.qrStatus || {}) }
    };
}

export function getMissionAvailability(config, qrId, now = new Date()) {
    const start = config.startAt?.toDate?.();
    const end = config.endAt?.toDate?.();
    if (start && now < start) return { available: false, message: `행사는 ${start.toLocaleString("ko-KR")}부터 시작합니다.` };
    if (end && now > end) return { available: false, message: "행사가 종료되어 더 이상 답안을 제출할 수 없습니다." };
    const status = config.qrStatus?.[qrId] || "active";
    if (status === "paused") return { available: false, message: "이 QR 문제는 현재 운영자가 일시 중지했습니다." };
    if (status === "closed") return { available: false, message: "이 QR 문제는 종료되었습니다." };
    return { available: true, message: "" };
}

