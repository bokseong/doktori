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
    updateDoc,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { MASTER_ADMIN_EMAIL } from "./auth.js";
import { adminUser as user, clearAdminError, isAdminWriteBlocked, reportAdminError, requireHubEntry } from "./admin-guard.js";
import { DEFAULT_EVENT_CONFIG, getEventConfig } from "./event-config.js?v=20261023b";
import { BOOTH_IDS, DATA_RETENTION_END, QR_IDS } from "./event-policy.js";
import { appCheck, db } from "./firebase.js";

if (!requireHubEntry()) await new Promise(() => {});

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
    try {
        currentConfig = await getEventConfig();
        clearAdminError();
    } catch (error) {
        currentConfig = { ...DEFAULT_EVENT_CONFIG, qrStatus: { ...DEFAULT_EVENT_CONFIG.qrStatus }, boothStatus: { ...DEFAULT_EVENT_CONFIG.boothStatus } };
        reportAdminError(error, configMessage, "운영 설정을 불러오지 못했습니다.");
    }
    document.getElementById("eventNotice").value = currentConfig.notice || DEFAULT_EVENT_CONFIG.notice;
    document.getElementById("participationEnabled").value = currentConfig.participationEnabled === false ? "false" : "true";
    document.getElementById("eventStartAt").value = toInputValue(currentConfig.startAt);
    document.getElementById("eventEndAt").value = toInputValue(currentConfig.endAt);
    document.getElementById("retentionAt").value = "2026-10-30T14:00";
    QR_IDS.forEach((qrId) => { document.getElementById(`state-${qrId}`).value = currentConfig.qrStatus?.[qrId] || "active"; });
}

async function saveConfig() {
    const button = document.getElementById("saveEventConfig");
    button.disabled = true;
    configMessage.textContent = "운영 설정을 저장하는 중...";
    const qrStatus = Object.fromEntries(QR_IDS.map((qrId) => [qrId, document.getElementById(`state-${qrId}`).value]));
    try {
        await updateDoc(doc(db, "eventConfig", "current"), {
            notice: document.getElementById("eventNotice").value.trim(),
            participationEnabled: document.getElementById("participationEnabled").value === "true",
            startAt: fromInput("eventStartAt"),
            endAt: fromInput("eventEndAt"),
            retentionAt: Timestamp.fromDate(DATA_RETENTION_END),
            qrStatus,
            updatedAt: serverTimestamp(),
            updatedBy: user.uid
        });
        await audit("event-config-updated", { participationEnabled: document.getElementById("participationEnabled").value === "true", qrStatus });
        await loadConfig();
        configMessage.textContent = "운영 설정을 저장했습니다.";
        clearAdminError();
    } catch (error) {
        console.error(error);
        reportAdminError(error, configMessage, "설정을 저장하지 못했습니다.");
    } finally {
        button.disabled = isAdminWriteBlocked();
    }
}

async function loadUserOptions() {
    const snapshot = await getDocs(collection(db, "users"));
    const previous = userSelect.value;
    userSelect.replaceChildren();
    snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((record) => ["participant", "member"].includes(record.role || "member"))
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
        clearAdminError();
        document.getElementById("refreshButton").click();
    } catch (error) {
        console.error(error);
        reportAdminError(error, manualMessage, `${action}하지 못했습니다.`);
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
        clearAdminError();
    } catch (error) {
        console.error(error);
        reportAdminError(error, message, "공지를 저장하지 못했습니다.");
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

async function commitDeletes(references) {
    const unique = [...new Map(references.map((reference) => [reference.path, reference])).values()];
    for (let offset = 0; offset < unique.length; offset += 400) {
        const batch = writeBatch(db);
        unique.slice(offset, offset + 400).forEach((reference) => batch.delete(reference));
        await batch.commit();
    }
}

async function queryOwnedReferences(collectionName, field, uid) {
    const snapshot = await getDocs(query(collection(db, collectionName), where(field, "==", uid)));
    return snapshot.docs.map((item) => item.ref);
}

async function deleteExpiredUsers() {
    if ((user.email || "").toLowerCase() !== MASTER_ADMIN_EMAIL) return;
    const config = await getEventConfig();
    const retentionDate = config.retentionAt?.toDate?.();
    if (!retentionDate || retentionDate.getTime() !== DATA_RETENTION_END.getTime() || new Date() < DATA_RETENTION_END) {
        configMessage.textContent = "아직 개인정보 보유기간이 끝나지 않았습니다.";
        return;
    }
    const users = await getDocs(collection(db, "users"));
    const targets = users.docs.filter((item) => ["participant", "member", "withdrawn"].includes(item.data().role || "member"));
    if (!targets.length) { configMessage.textContent = "영구 삭제할 참여자 데이터가 없습니다."; return; }
    if (!window.confirm(`${targets.length}명의 회원정보·진행 기록·후기·문의·상품 기록을 영구 삭제합니다. 복구할 수 없습니다. 실행할까요?`)) return;
    configMessage.textContent = "보유기간이 끝난 데이터를 영구 삭제하는 중...";
    try {
        const references = [];
        for (const target of targets) {
            references.push(target.ref, doc(db, "prizeClaims", target.id), doc(db, "chatRateLimits", target.id));
            const reservationId = target.data().identityReservationId;
            if (typeof reservationId === "string" && reservationId.includes("~")) references.push(doc(db, "identityReservations", reservationId));
            QR_IDS.forEach((qrId) => {
                references.push(doc(db, "users", target.id, "progress", qrId));
                references.push(doc(db, "answerAttempts", `${target.id}_${qrId}`));
            });
            BOOTH_IDS.forEach((boothId) => {
                references.push(doc(db, "users", target.id, "boothParticipation", boothId));
            });
            references.push(...await queryOwnedReferences("boothReviews", "authorUid", target.id));
            references.push(...await queryOwnedReferences("quizTelemetry", "uid", target.id));
            references.push(...await queryOwnedReferences("clientErrors", "uid", target.id));
            references.push(...await queryOwnedReferences("chatMessages", "conversationUid", target.id));
            references.push(...await queryOwnedReferences("auditLogs", "targetUid", target.id));
        }
        await commitDeletes(references);
        configMessage.textContent = `${targets.length}명의 Firestore 회원정보와 관련 행사 기록을 영구 삭제했습니다.`;
        clearAdminError();
    } catch (error) {
        console.error(error);
        reportAdminError(error, configMessage, "영구 삭제를 완료하지 못했습니다.");
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
document.getElementById("deleteExpired").addEventListener("click", deleteExpiredUsers);
if ((user.email || "").toLowerCase() !== MASTER_ADMIN_EMAIL) document.getElementById("deleteExpired").hidden = true;

await Promise.all([loadConfig(), loadUserOptions()]);
onSnapshot(collection(db, "quizTelemetry"), (snapshot) => renderStats(snapshot.docs), (error) => reportAdminError(error, configMessage, "문항 통계를 갱신하지 못했습니다."));
onSnapshot(collection(db, "users"), loadUserOptions, (error) => reportAdminError(error, manualMessage, "참여자 목록을 갱신하지 못했습니다."));
onSnapshot(doc(db, "announcements", "current"), loadAnnouncement, (error) => reportAdminError(error, document.getElementById("announcementMessage"), "공지 상태를 갱신하지 못했습니다."));
onSnapshot(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(20)), (snapshot) => renderAuditLogs(snapshot.docs), (error) => reportAdminError(error, configMessage, "감사 기록을 갱신하지 못했습니다."));

