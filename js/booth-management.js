import {
    collection,
    collectionGroup,
    doc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { adminAccess, adminUser, requireHubEntry } from "./admin-guard.js";
import { db } from "./firebase.js";

export const BOOTHS = Object.freeze([
    { id: "booth1", number: "01", name: "프랑켄슈타인 박사의 도서 대출" },
    { id: "booth2", number: "02", name: "물약을 완성하라!" },
    { id: "booth3", number: "03", name: "잭오랜턴 부적 인형 만들기" },
    { id: "booth4", number: "04", name: "카드뽑기 · 상품 수령" },
    { id: "booth5", number: "05", name: "포토존" },
    { id: "booth6", number: "06", name: "방명록" }
]);

if (!requireHubEntry({ fallbackUrl: "../", level: "booth" })) await new Promise(() => {});

const boothId = document.body.dataset.boothId;
const booth = BOOTHS.find((item) => item.id === boothId);
const rows = document.getElementById("boothRows");
const search = document.getElementById("boothSearch");
const status = document.getElementById("boothStatus");
let users = [];
let participation = new Map();
const participantQuery = query(collection(db, "users"), where("role", "in", ["member", "participant"]));

if (!adminAccess.canManageBooths || !booth) {
    location.replace(new URL("../", location.href));
    await new Promise(() => {});
}

document.getElementById("boothNumber").textContent = `BOOTH ${booth.number}`;
document.getElementById("boothTitle").textContent = booth.name;
document.title = `${booth.name} 참여 관리 · 독토리`;
if (!adminAccess.isGrade1) {
    const lead = document.querySelector(".booth-admin__head .lead");
    if (lead) lead.textContent = "2급 관리자는 회원별 참여 여부만 저장할 수 있습니다.";
}

function roleLabel(role) {
    if (["grade1", "admin"].includes(role)) return "1급 관리자";
    if (role === "grade2") return "2급 관리자";
    return "일반회원";
}

function currentRecord(userId) {
    return participation.get(userId) || { participated: false, rank: null };
}

async function saveRecord(member, participatedInput, rankInput, button) {
    const participated = participatedInput.value === "true";
    const previous = currentRecord(member.id);
    if (!adminAccess.isGrade1 && Number.isInteger(previous.rank) && participated !== previous.participated) {
        status.textContent = "등수가 기록된 참여 여부는 1급 관리자만 변경할 수 있습니다.";
        return;
    }
    const rank = !participated
        ? null
        : adminAccess.isGrade1
            ? (rankInput.value === "" ? null : Number(rankInput.value))
            : (Number.isInteger(previous.rank) ? previous.rank : null);
    if (rank !== null && (!Number.isInteger(rank) || rank < 1 || rank > 9999)) {
        status.textContent = "등수는 1~9999 사이의 정수로 입력해 주세요.";
        rankInput.focus();
        return;
    }
    button.disabled = true;
    status.textContent = `${member.studentName || member.email}의 참여 정보를 저장하는 중...`;
    try {
        const batch = writeBatch(db);
        batch.set(doc(db, "users", member.id, "boothParticipation", booth.id), {
            boothId: booth.id,
            participated,
            rank,
            updatedAt: serverTimestamp(),
            updatedBy: adminUser.uid
        });
        if (adminAccess.isGrade1) {
            batch.set(doc(collection(db, "auditLogs")), {
                actorUid: adminUser.uid,
                actorEmail: adminUser.email || "",
                action: "booth-participation-updated",
                targetUid: member.id,
                qrId: booth.id,
                details: JSON.stringify({ participated, rank }),
                createdAt: serverTimestamp()
            });
        }
        await batch.commit();
        status.textContent = "저장했습니다. 진행률·상품 수령 화면에도 즉시 반영됩니다.";
    } catch (error) {
        console.error(error);
        status.textContent = error.code === "permission-denied"
            ? "저장 권한이 없습니다. Firestore 보안 규칙 배포 상태를 확인하세요."
            : "참여 정보를 저장하지 못했습니다.";
    } finally {
        button.disabled = false;
    }
}

function render() {
    const keyword = search.value.trim().toLowerCase();
    const filtered = users.filter((member) => [member.studentName, member.studentNumber, member.email]
        .some((value) => String(value || "").toLowerCase().includes(keyword)));
    rows.replaceChildren();
    filtered.forEach((member) => {
        const record = currentRecord(member.id);
        const row = document.createElement("tr");
        const nameCell = document.createElement("td");
        const name = document.createElement("strong");
        const role = document.createElement("div");
        name.textContent = member.studentName || member.displayName || "이름 미등록";
        role.className = "booth-role";
        role.textContent = roleLabel(member.role);
        nameCell.append(name, role);
        const numberCell = document.createElement("td");
        numberCell.textContent = ["grade1", "grade2", "admin"].includes(member.role) ? "관리자" : (member.studentNumber || "-");
        const emailCell = document.createElement("td");
        emailCell.textContent = member.email || "-";
        const participatedCell = document.createElement("td");
        const participatedInput = document.createElement("select");
        participatedInput.append(new Option("미참여", "false"), new Option("참여", "true"));
        participatedInput.value = String(record.participated === true);
        participatedCell.append(participatedInput);
        const rankCell = document.createElement("td");
        const rankInput = document.createElement("input");
        rankInput.type = "number";
        rankInput.min = "1";
        rankInput.max = "9999";
        rankInput.step = "1";
        rankInput.placeholder = "선택";
        rankInput.value = Number.isInteger(record.rank) ? String(record.rank) : "";
        rankInput.disabled = !adminAccess.isGrade1 || record.participated !== true;
        participatedInput.disabled = !adminAccess.isGrade1 && Number.isInteger(record.rank);
        participatedInput.addEventListener("change", () => {
            rankInput.disabled = !adminAccess.isGrade1 || participatedInput.value !== "true";
            if (participatedInput.value !== "true") rankInput.value = "";
        });
        rankCell.append(rankInput);
        const actionCell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "booth-save";
        button.textContent = "저장";
        button.addEventListener("click", () => saveRecord(member, participatedInput, rankInput, button));
        actionCell.append(button);
        row.append(nameCell, numberCell, emailCell, participatedCell, rankCell, actionCell);
        rows.append(row);
    });
    status.textContent = `${filtered.length}명을 표시하고 있습니다.`;
}

async function loadUsers() {
    const snapshot = await getDocs(participantQuery);
    users = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((left, right) => (left.studentName || left.email || "").localeCompare(right.studentName || right.email || "", "ko"));
    render();
}

search.addEventListener("input", render);
await loadUsers();
const stopUsers = onSnapshot(participantQuery, () => loadUsers(), () => {});
const stopParticipation = onSnapshot(collectionGroup(db, "boothParticipation"), (snapshot) => {
    participation = new Map(snapshot.docs
        .filter((item) => item.id === booth.id)
        .map((item) => [item.ref.parent.parent?.id, item.data()])
        .filter(([userId]) => Boolean(userId)));
    render();
}, () => {});
window.addEventListener("pagehide", () => {
    stopUsers();
    stopParticipation();
}, { once: true });
document.body.style.visibility = "visible";
