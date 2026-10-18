import { getToken } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    limit,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getUserAccess, MASTER_ADMIN_EMAIL, requireUser } from "./auth.js";
import { DEFAULT_EVENT_CONFIG, getEventConfig } from "./event-config.js";
import { appCheck, db } from "./firebase.js";

const QR_IDS = Array.from({ length: 6 }, (_, index) => `qr${index + 1}`);
const user = await requireUser();
const access = await getUserAccess(user);
if (!access.isAdmin) await new Promise(() => {});

const configMessage = document.getElementById("configMessage");
const manualMessage = document.getElementById("manualMessage");
const userSelect = document.getElementById("manualUser");
const qrSelect = document.getElementById("manualQr");
const qrStateGrid = document.getElementById("qrStateGrid");
const statsContainer = document.getElementById("quizStats");
let currentConfig = null;

function toInputValue(timestamp) {
    const date = timestamp?.toDate?.();
    if (!date) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

function fromInput(id) {
    const value = document.getElementById(id).value;
    return value ? Timestamp.fromDate(new Date(value)) : null;
}

async function audit(action, details = {}, targetUid = "", qrId = "") {
    await addDoc(collection(db, "auditLogs"), {
        actorUid: user.uid,
        actorEmail: user.email || "",
        action,
        targetUid,
        qrId,
        details: JSON.stringify(details).slice(0, 500),
        createdAt: serverTimestamp()
    });
}

function createQrStateControls() {
    QR_IDS.forEach((qrId, index) => {
        const label = document.createElement("label");
        label.textContent = `QR ${String(index + 1).padStart(2, "0")}`;
        const select = document.createElement("select");
        select.id = `state-${qrId}`;
        select.append(new Option("진행 가능", "active"), new Option("일시 중지", "paused"), new Option("종료", "closed"));
        label.append(select);
        qrStateGrid.append(label);
    });
}

async function loadConfig() {
    currentConfig = await getEventConfig().catch(() => ({ ...DEFAULT_EVENT_CONFIG, qrStatus: { ...DEFAULT_EVENT_CONFIG.qrStatus } }));
    document.getElementById("eventNotice").value = currentConfig.notice || DEFAULT_EVENT_CONFIG.notice;
    document.getElementById("eventStartAt").value = toInputValue(currentConfig.startAt);
    document.getElementById("eventEndAt").value = toInputValue(currentConfig.endAt);
    document.getElementById("retentionAt").value = toInputValue(currentConfig.retentionAt);
    QR_IDS.forEach((qrId) => { document.getElementById(`state-${qrId}`).value = currentConfig.qrStatus?.[qrId] || "active"; });
}

async function saveConfig() {
    const button = document.getElementById("saveEventConfig");
    button.disabled = true;
    configMessage.textContent = "운영 설정을 저장하는 중...";
    const qrStatus = Object.fromEntries(QR_IDS.map((qrId) => [qrId, document.getElementById(`state-${qrId}`).value]));
    try {
        await setDoc(doc(db, "eventConfig", "current"), {
            notice: document.getElementById("eventNotice").value.trim(),
            startAt: fromInput("eventStartAt"),
            endAt: fromInput("eventEndAt"),
            retentionAt: fromInput("retentionAt"),
            qrStatus,
            updatedAt: serverTimestamp(),
            updatedBy: user.uid
        });
        await audit("event-config-updated", { qrStatus });
        await loadConfig();
        configMessage.textContent = "운영 설정을 저장했습니다.";
    } catch (error) {
        console.error(error);
        configMessage.textContent = "설정을 저장하지 못했습니다. 배포된 보안 규칙을 확인하세요.";
    } finally {
        button.disabled = false;
    }
}

async function loadUserOptions() {
    const snapshot = await getDocs(collection(db, "users"));
    const previous = userSelect.value;
    userSelect.replaceChildren();
    snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((record) => (record.role || "participant") === "participant")
        .sort((a, b) => (a.studentName || a.email || "").localeCompare(b.studentName || b.email || "", "ko"))
        .forEach((record) => userSelect.append(new Option(`${record.studentName || "이름 미등록"} · ${record.studentNumber || record.email || record.id}`, record.id)));
    if ([...userSelect.options].some((option) => option.value === previous)) userSelect.value = previous;
}

async function setManualProgress(completed) {
    const targetUid = userSelect.value;
    const qrId = qrSelect.value;
    if (!targetUid || !qrId) return;
    const action = completed ? "수동 완료" : "완료 취소";
    if (!window.confirm(`${userSelect.selectedOptions[0].textContent}의 ${qrId.toUpperCase()}를 ${action} 처리할까요? 변경 이력이 기록됩니다.`)) return;
    manualMessage.textContent = `${action} 처리 중...`;
    try {
        const reference = doc(db, "users", targetUid, "progress", qrId);
        const existing = await getDoc(reference);
        if (completed && existing.exists()) {
            manualMessage.textContent = "이미 완료된 미션입니다.";
            return;
        }
        const batch = writeBatch(db);
        if (completed) batch.set(reference, { qrId, found: true, completedAt: serverTimestamp(), manualBy: user.uid });
        else batch.delete(reference);
        batch.set(doc(collection(db, "auditLogs")), {
            actorUid: user.uid,
            actorEmail: user.email || "",
            action: completed ? "progress-manual-complete" : "progress-manual-cancel",
            targetUid,
            qrId,
            details: "{}",
            createdAt: serverTimestamp()
        });
        await batch.commit();
        manualMessage.textContent = `${action}했습니다.`;
        document.getElementById("refreshButton").click();
    } catch (error) {
        console.error(error);
        manualMessage.textContent = `${action}하지 못했습니다. 배포된 보안 규칙을 확인하세요.`;
    }
}

function renderStats(documents) {
    statsContainer.replaceChildren();
    QR_IDS.forEach((qrId, index) => {
        const events = documents.map((item) => item.data()).filter((item) => item.qrId === qrId);
        const correct = events.filter((item) => item.outcome === "correct").length;
        const incorrect = events.filter((item) => item.outcome === "incorrect").length;
        const total = correct + incorrect;
        const card = document.createElement("div");
        card.className = "stat-card";
        const title = document.createElement("strong");
        title.textContent = `QR ${String(index + 1).padStart(2, "0")}`;
        const detail = document.createElement("span");
        detail.textContent = `정답 ${correct} · 오답 ${incorrect} · 정답률 ${total ? Math.round((correct / total) * 100) : 0}%`;
        card.append(title, detail);
        statsContainer.append(card);
    });
}

function renderAuditLogs(documents) {
    const container = document.getElementById("auditLogList");
    container.replaceChildren();
    if (!documents.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "아직 기록된 관리자 변경 이력이 없습니다.";
        container.append(empty);
        return;
    }
    documents.forEach((item) => {
        const data = item.data();
        const date = data.createdAt?.toDate?.();
        const row = document.createElement("div");
        row.className = "diagnostic-item";
        row.textContent = `${date ? date.toLocaleString("ko-KR") : "처리 중"} · ${data.actorEmail || data.actorUid || "관리자"} · ${data.action}${data.targetUid ? ` · 대상 ${data.targetUid.slice(0, 8)}…` : ""}${data.qrId ? ` · ${data.qrId.toUpperCase()}` : ""}`;
        container.append(row);
    });
}

function addDiagnostic(label, ok, detail) {
    const item = document.createElement("div");
    item.className = "diagnostic-item";
    item.style.borderColor = ok ? "#2d8a43" : "#9b321e";
    item.textContent = `${ok ? "정상" : "확인 필요"} · ${label}${detail ? ` — ${detail}` : ""}`;
    document.getElementById("diagnosticList").append(item);
}

async function runDiagnostics() {
    const list = document.getElementById("diagnosticList");
    list.replaceChildren();
    addDiagnostic("네트워크", navigator.onLine, navigator.onLine ? "온라인" : "오프라인");
    try { await getToken(appCheck, false); addDiagnostic("Firebase App Check", true, "토큰 발급 성공"); }
    catch (error) { addDiagnostic("Firebase App Check", false, String(error.code || error.name)); }
    try { await getDoc(doc(db, "eventConfig", "current")); addDiagnostic("Firestore", true, "읽기 성공"); }
    catch (error) { addDiagnostic("Firestore", false, String(error.code || error.name)); }
}

async function saveAnnouncement(active) {
    const message = document.getElementById("announcementMessage");
    const title = document.getElementById("announcementHeading").value.trim();
    const body = document.getElementById("announcementBody").value.trim();
    const severity = document.getElementById("announcementSeverity").value;
    if (active && (!title || !body)) {
        message.textContent = "공지 제목과 내용을 모두 입력해 주세요.";
        return;
    }
    message.textContent = active ? "공지를 게시하는 중..." : "현재 공지를 내리는 중...";
    try {
        await setDoc(doc(db, "announcements", "current"), {
            title: title || "공지",
            message: body || "",
            active,
            severity,
            updatedAt: serverTimestamp(),
            updatedBy: user.uid
        });
        await audit(active ? "announcement-published" : "announcement-disabled", { severity });
        message.textContent = active ? "실시간 공지를 게시했습니다." : "현재 공지를 내렸습니다.";
    } catch (error) {
        console.error(error);
        message.textContent = "공지를 저장하지 못했습니다. 권한과 배포된 규칙을 확인하세요.";
    }
}

function loadAnnouncement(snapshot) {
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    document.getElementById("announcementHeading").value = data.title || "";
    document.getElementById("announcementBody").value = data.message || "";
    document.getElementById("announcementSeverity").value = data.severity || "info";
    document.getElementById("announcementMessage").textContent = data.active ? "현재 공지가 게시 중입니다." : "게시 중인 공지가 없습니다.";
}

async function anonymizeExpiredUsers() {
    if ((user.email || "").toLowerCase() !== MASTER_ADMIN_EMAIL) return;
    const config = await getEventConfig();
    const retentionDate = config.retentionAt?.toDate?.();
    if (!retentionDate || new Date() < retentionDate) {
        configMessage.textContent = "아직 개인정보 보유기간이 끝나지 않았습니다.";
        return;
    }
    const users = await getDocs(collection(db, "users"));
    const targets = users.docs.filter((item) => (item.data().role || "participant") === "participant" && item.data().privacyConsent === true);
    if (!targets.length) { configMessage.textContent = "익명화할 참여자가 없습니다."; return; }
    if (!window.confirm(`${targets.length}명의 이름·학번·이메일을 익명화하고 QR 진행 기록을 삭제합니다. 이 작업은 되돌리기 어렵습니다. 실행할까요?`)) return;
    configMessage.textContent = "개인정보를 익명화하는 중...";
    try {
        for (const target of targets) {
            const batch = writeBatch(db);
            batch.update(target.ref, { email: "", displayName: "", studentNumber: "0000", studentName: "삭제됨", privacyConsent: false, privacyConsentVersion: "expired", privacyConsentAt: serverTimestamp(), lastActivityAt: serverTimestamp() });
            QR_IDS.forEach((qrId) => {
                batch.delete(doc(db, "users", target.id, "progress", qrId));
                batch.delete(doc(db, "answerAttempts", `${target.id}_${qrId}`));
            });
            await batch.commit();
        }
        await audit("retention-anonymization", { count: targets.length });
        configMessage.textContent = `${targets.length}명의 Firestore 회원정보와 진행 기록을 익명화했습니다. Firebase Authentication 계정은 별도 관리 대상입니다.`;
    } catch (error) {
        console.error(error);
        configMessage.textContent = "익명화를 완료하지 못했습니다. 권한과 로그를 확인하세요.";
    }
}

createQrStateControls();
QR_IDS.forEach((qrId, index) => qrSelect.append(new Option(`QR ${String(index + 1).padStart(2, "0")}`, qrId)));
document.getElementById("saveEventConfig").addEventListener("click", saveConfig);
document.getElementById("manualComplete").addEventListener("click", () => setManualProgress(true));
document.getElementById("manualCancel").addEventListener("click", () => setManualProgress(false));
document.getElementById("runDiagnostics").addEventListener("click", runDiagnostics);
document.getElementById("publishAnnouncement").addEventListener("click", () => saveAnnouncement(true));
document.getElementById("disableAnnouncement").addEventListener("click", () => saveAnnouncement(false));
document.getElementById("anonymizeExpired").addEventListener("click", anonymizeExpiredUsers);
if ((user.email || "").toLowerCase() !== MASTER_ADMIN_EMAIL) document.getElementById("anonymizeExpired").hidden = true;

await Promise.all([loadConfig(), loadUserOptions()]);
onSnapshot(collection(db, "quizTelemetry"), (snapshot) => renderStats(snapshot.docs), (error) => console.warn("문항 통계 실시간 갱신 실패", error));
onSnapshot(collection(db, "users"), loadUserOptions, () => {});
onSnapshot(doc(db, "announcements", "current"), loadAnnouncement, (error) => console.warn("공지 상태 갱신 실패", error));
onSnapshot(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(20)), (snapshot) => renderAuditLogs(snapshot.docs), (error) => console.warn("감사 로그 갱신 실패", error));

