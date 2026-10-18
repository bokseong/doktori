import {
    collection,
    collectionGroup,
    doc,
    getDocs,
    onSnapshot,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getUserAccess, requireUser } from "./auth.js";
import { db } from "./firebase.js";

const QR_IDS = Array.from({ length: 6 }, (_, index) => `qr${index + 1}`);
const user = await requireUser();
const access = await getUserAccess(user);
const dashboard = document.getElementById("dashboard");
const denied = document.getElementById("denied");
const rows = document.getElementById("progressRows");
const status = document.getElementById("dashboardStatus");
const search = document.getElementById("searchInput");
let records = [];

if (!access.isAdmin) {
    denied.hidden = false;
    document.body.style.visibility = "visible";
    await new Promise(() => {});
}

dashboard.hidden = false;
document.body.style.visibility = "visible";

function createCell(value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    return cell;
}

async function setPrizeReceived(record, received) {
    const action = received ? "수령 완료" : "수령 취소";
    if (!confirm(`${record.studentName || record.email}의 상품을 ${action} 처리할까요?`)) return;
    status.textContent = `${action} 처리 중...`;
    const batch = writeBatch(db);
    batch.set(doc(db, "prizeClaims", record.id), {
        uid: record.id,
        received,
        receivedAt: received ? serverTimestamp() : null,
        receivedBy: user.uid,
        updatedAt: serverTimestamp()
    });
    batch.set(doc(collection(db, "auditLogs")), {
        actorUid: user.uid,
        actorEmail: user.email || "",
        action: received ? "prize-received" : "prize-receipt-cancelled",
        targetUid: record.id,
        qrId: "",
        details: "{}",
        createdAt: serverTimestamp()
    });
    try {
        await batch.commit();
        status.textContent = `${action}했습니다.`;
        await loadRecords();
    } catch (error) {
        console.error(error);
        status.textContent = "상품 수령 상태를 저장하지 못했습니다.";
    }
}

function render() {
    const keyword = search.value.trim().toLowerCase();
    const filtered = records.filter((record) => [record.studentName, record.studentNumber, record.email].some((value) => String(value || "").toLowerCase().includes(keyword)));
    rows.replaceChildren();
    filtered.forEach((record) => {
        const row = document.createElement("tr");
        row.append(createCell(record.studentName || "이름 미등록"), createCell(record.studentNumber || "-"), createCell(record.email || "-"));
        const participation = document.createElement("td");
        const participationBadge = document.createElement("span");
        participationBadge.className = `badge${record.found.length ? " yes" : ""}`;
        participationBadge.textContent = record.found.length ? "참여" : "미참여";
        participation.append(participationBadge);
        row.append(participation, createCell(`${record.found.length} / 6`), createCell(record.found.length ? record.found.map((id) => id.toUpperCase()).join(", ") : "-"));
        const eligible = record.found.length === QR_IDS.length;
        row.append(createCell(eligible ? "대상" : "미완주"), createCell(record.received ? "수령 완료" : "미수령"));
        const actionCell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "receipt-button";
        button.textContent = record.received ? "수령 취소" : "수령 완료";
        button.disabled = !eligible && !record.received;
        button.addEventListener("click", () => setPrizeReceived(record, !record.received));
        actionCell.append(button);
        row.append(actionCell);
        rows.append(row);
    });
    document.getElementById("registeredCount").textContent = String(records.length);
    document.getElementById("startedCount").textContent = String(records.filter((record) => record.found.length > 0).length);
    document.getElementById("completedCount").textContent = String(records.filter((record) => record.found.length === QR_IDS.length).length);
    document.getElementById("receivedCount").textContent = String(records.filter((record) => record.received).length);
    status.textContent = `${filtered.length}명을 표시하고 있습니다.`;
}

async function loadRecords() {
    status.textContent = "전체 진행률을 불러오는 중...";
    try {
        const [usersSnapshot, progressSnapshot, claimsSnapshot] = await Promise.all([
            getDocs(collection(db, "users")),
            getDocs(collectionGroup(db, "progress")),
            getDocs(collection(db, "prizeClaims"))
        ]);
        const progressByUser = new Map();
        progressSnapshot.docs.forEach((item) => {
            const uid = item.ref.parent.parent?.id;
            if (!uid || item.data().found !== true || !QR_IDS.includes(item.id)) return;
            const found = progressByUser.get(uid) || [];
            found.push(item.id);
            progressByUser.set(uid, found);
        });
        const claims = new Map(claimsSnapshot.docs.map((item) => [item.id, item.data()]));
        records = usersSnapshot.docs
            .map((item) => ({ id: item.id, ...item.data(), found: (progressByUser.get(item.id) || []).sort(), received: claims.get(item.id)?.received === true }))
            .filter((record) => record.role !== "withdrawn")
            .sort((a, b) => (a.studentName || a.email || "").localeCompare(b.studentName || b.email || "", "ko"));
        render();
    } catch (error) {
        console.error(error);
        status.textContent = "전체 진행률을 불러오지 못했습니다. 권한과 네트워크를 확인하세요.";
    }
}

function exportCsv() {
    const header = ["이름", "학번", "이메일", "참여 여부", "완료 수", "찾은 QR", "상품 대상", "상품 수령"];
    const values = records.map((record) => [record.studentName || "", record.studentNumber || "", record.email || "", record.found.length ? "참여" : "미참여", record.found.length, record.found.join(" "), record.found.length === 6 ? "대상" : "미완주", record.received ? "수령 완료" : "미수령"]);
    const csv = [header, ...values].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `doktori-progress-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

search.addEventListener("input", render);
document.getElementById("exportButton").addEventListener("click", exportCsv);
await loadRecords();
onSnapshot(collection(db, "prizeClaims"), loadRecords, () => {});
onSnapshot(collection(db, "users"), loadRecords, () => {});
onSnapshot(collectionGroup(db, "progress"), loadRecords, () => {});
