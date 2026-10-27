import {
    collection,
    collectionGroup,
    doc,
    getDocs,
    onSnapshot,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { adminAccess as access, adminUser as user, requireHubEntry } from "./admin-guard.js";
import { db } from "./firebase.js";
import { BOOTH_SUCCESS_REQUIRED, hasBoothSuccess, hasEventSuccess, hasQrSuccess, QR_IDS, QR_SUCCESS_REQUIRED } from "./event-policy.js";

const BOOTHS = Object.freeze([
    { id: "booth1", name: "프랑켄슈타인 박사의 도서 대출" },
    { id: "booth2", name: "물약을 완성하라!" },
    { id: "booth3", name: "잭오랜턴 부적 인형 만들기" },
    { id: "booth4", name: "카드뽑기 · 상품 수령" },
    { id: "booth5", name: "포토존" },
    { id: "booth6", name: "방명록" }
]);
if (!requireHubEntry()) await new Promise(() => {});
const dashboard = document.getElementById("dashboard");
const denied = document.getElementById("denied");
const rows = document.getElementById("progressRows");
const status = document.getElementById("dashboardStatus");
const search = document.getElementById("searchInput");
let records = [];
let selectedMemberId = null;
const memberDetail = document.getElementById("memberDetail");
const boothStatusGrid = document.getElementById("boothStatusGrid");

if (!access.isGrade1) {
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

function displayStudentNumber(record) {
    return ["admin", "grade1", "grade2"].includes(record.role) ? "관리자" : (record.studentNumber || "-");
}

function isAdministrator(record) {
    return ["admin", "grade1", "grade2"].includes(record.role);
}

function createMemberCell(record, value) {
    const cell = document.createElement("td");
    cell.className = "member-cell";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "member-button member-button--cell";
    button.textContent = value;
    button.setAttribute("aria-label", `${value} · 회원 참여 현황 보기`);
    button.addEventListener("click", () => showMemberDetail(record));
    cell.append(button);
    return cell;
}

function showMemberDetail(record, scroll = true) {
    selectedMemberId = record.id;
    document.getElementById("memberDetailTitle").textContent = record.studentName || record.displayName || "이름 미등록";
    document.getElementById("memberDetailMeta").textContent = `${displayStudentNumber(record)} · ${record.email || "이메일 없음"} · QR ${record.found.length}/6`;
    boothStatusGrid.replaceChildren();
    BOOTHS.forEach((booth, index) => {
        const state = record.booths[booth.id] || { participated: false, rank: null };
        const card = document.createElement("article");
        card.className = `booth-status-card${state.participated ? " yes" : ""}`;
        const title = document.createElement("strong");
        const summary = document.createElement("span");
        title.textContent = `${String(index + 1).padStart(2, "0")} · ${booth.name}`;
        summary.textContent = `${state.participated ? "참여" : "미참여"}${Number.isInteger(state.rank) ? ` · ${state.rank}등` : " · 등수 없음"}`;
        card.append(title, summary);
        boothStatusGrid.append(card);
    });
    memberDetail.hidden = false;
    if (scroll) memberDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function setPrizeReceived(record, received) {
    if (isAdministrator(record)) {
        status.textContent = "관리자 계정은 상품 수령 대상이 아닙니다.";
        return;
    }
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
        row.append(
            createMemberCell(record, record.studentName || "이름 미등록"),
            createMemberCell(record, displayStudentNumber(record)),
            createMemberCell(record, record.email || "이메일 없음")
        );
        const boothCount = Object.values(record.booths).filter((item) => item.participated === true).length;
        const participated = record.found.length > 0 || boothCount > 0;
        const participation = document.createElement("td");
        const participationBadge = document.createElement("span");
        participationBadge.className = `badge${participated ? " yes" : ""}`;
        participationBadge.textContent = participated ? "참여" : "미참여";
        participation.append(participationBadge);
        row.append(participation, createCell(`${record.found.length} / 6`), createCell(`${boothCount} / ${BOOTHS.length}`));
        const rankedBooths = Object.values(record.booths).filter((item) => Number.isInteger(item.rank)).length;
        const qrSuccess = hasQrSuccess(record.found.length);
        const boothSuccess = hasBoothSuccess(boothCount);
        const prizeBasis = qrSuccess && boothSuccess
            ? `QR ${record.found.length}개 · 부스 ${boothCount}개 성공`
            : qrSuccess
                ? `QR ${record.found.length}개 성공`
                : boothSuccess
                    ? `부스 ${boothCount}개 성공`
                    : `기준 미달 · QR ${record.found.length}/${QR_SUCCESS_REQUIRED}, 부스 ${boothCount}/${BOOTH_SUCCESS_REQUIRED}`;
        const prizeEligible = !isAdministrator(record) && hasEventSuccess(record.found.length, boothCount);
        row.append(createCell(prizeEligible ? prizeBasis : "관리자 제외"), createCell(prizeEligible ? (record.received ? "수령 완료" : "미수령") : "대상 아님"));
        const actionCell = document.createElement("td");
        if (prizeEligible) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "receipt-button";
            button.textContent = record.received ? "수령 취소" : "수령 완료";
            button.addEventListener("click", () => setPrizeReceived(record, !record.received));
            actionCell.append(button);
        } else {
            actionCell.textContent = "-";
        }
        row.append(actionCell);
        rows.append(row);
    });
    document.getElementById("registeredCount").textContent = String(records.length);
    document.getElementById("startedCount").textContent = String(records.filter((record) => record.found.length > 0 || Object.values(record.booths).some((item) => item.participated === true)).length);
    document.getElementById("completedCount").textContent = String(records.filter((record) => {
        const boothCount = Object.values(record.booths).filter((item) => item.participated === true).length;
        return hasEventSuccess(record.found.length, boothCount);
    }).length);
    document.getElementById("receivedCount").textContent = String(records.filter((record) => record.received).length);
    status.textContent = `${filtered.length}명을 표시하고 있습니다.`;
    const selected = records.find((record) => record.id === selectedMemberId);
    if (selected) showMemberDetail(selected, false);
}

async function loadRecords() {
    status.textContent = "전체 진행률을 불러오는 중...";
    try {
        const [usersSnapshot, progressSnapshot, claimsSnapshot, boothSnapshot] = await Promise.all([
            getDocs(collection(db, "users")),
            getDocs(collectionGroup(db, "progress")),
            getDocs(collection(db, "prizeClaims")),
            getDocs(collectionGroup(db, "boothParticipation"))
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
        const boothsByUser = new Map();
        boothSnapshot.docs.forEach((item) => {
            const uid = item.ref.parent.parent?.id;
            if (!uid) return;
            const boothRecords = boothsByUser.get(uid) || {};
            boothRecords[item.id] = item.data();
            boothsByUser.set(uid, boothRecords);
        });
        records = usersSnapshot.docs
            .map((item) => ({ id: item.id, ...item.data(), found: (progressByUser.get(item.id) || []).sort(), booths: boothsByUser.get(item.id) || {}, received: claims.get(item.id)?.received === true, receivedBy: claims.get(item.id)?.receivedBy || "" }))
            .filter((record) => record.role !== "withdrawn" && !isAdministrator(record))
            .sort((a, b) => (a.studentName || a.email || "").localeCompare(b.studentName || b.email || "", "ko"));
        render();
    } catch (error) {
        console.error(error);
        status.textContent = "전체 진행률을 불러오지 못했습니다. 권한과 네트워크를 확인하세요.";
    }
}

function exportCsv() {
    const header = ["이름", "학번", "이메일", "QR 참여 여부", "QR 완료 수", "찾은 QR", ...BOOTHS.flatMap((booth) => [`${booth.name} 참여`, `${booth.name} 등수`]), "상품 수령", "수령 처리자"];
    const values = records.map((record) => [record.studentName || "", displayStudentNumber(record), record.email || "", record.found.length ? "참여" : "미참여", record.found.length, record.found.join(" "), ...BOOTHS.flatMap((booth) => { const state = record.booths[booth.id] || {}; return [state.participated === true ? "참여" : "미참여", Number.isInteger(state.rank) ? state.rank : ""]; }), record.received ? "수령 완료" : "미수령", record.receivedBy || ""]);
    const csv = [header, ...values].map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `doktori-progress-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

search.addEventListener("input", render);
document.getElementById("closeMemberDetail").addEventListener("click", () => { selectedMemberId = null; memberDetail.hidden = true; });
document.getElementById("exportButton").addEventListener("click", exportCsv);
await loadRecords();
onSnapshot(collection(db, "prizeClaims"), loadRecords, () => {});
onSnapshot(collection(db, "users"), loadRecords, () => {});
onSnapshot(collectionGroup(db, "progress"), loadRecords, () => {});
onSnapshot(collectionGroup(db, "boothParticipation"), loadRecords, () => {});
