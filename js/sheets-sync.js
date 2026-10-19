import {
    GoogleAuthProvider,
    reauthenticateWithPopup
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
    collection,
    collectionGroup,
    doc,
    getDoc,
    onSnapshot,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getUserAccess, requireUser } from "./auth.js";
import { auth, db } from "./firebase.js";

const QR_IDS = Array.from({ length: 6 }, (_, index) => `qr${index + 1}`);
const SYNC_INTERVAL_MS = 10_000;
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const integrationReference = doc(db, "integrations", "googleSheets");
const user = await requireUser();
const access = await getUserAccess(user);

if (!access.isAdmin) await new Promise(() => {});

const sheetUrl = document.getElementById("sheetUrl");
const sheetTabName = document.getElementById("sheetTabName");
const saveButton = document.getElementById("saveSheetConfig");
const connectButton = document.getElementById("connectSheetOAuth");
const syncButton = document.getElementById("syncSheetNow");
const stopButton = document.getElementById("stopSheetSync");
const status = document.getElementById("sheetSyncStatus");

let spreadsheetId = "";
let accessToken = "";
let syncTimer = 0;
let syncing = false;
let dirty = true;
let dataRevision = 0;
let lastPayload = "";
let users = [];
let progress = [];
let claims = [];
const readySources = new Set();
let stopUsers = () => {};
let stopProgress = () => {};
let stopClaims = () => {};

function extractSpreadsheetId(value) {
    const trimmed = String(value || "").trim();
    const linkMatch = trimmed.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
    const candidate = linkMatch?.[1] || trimmed;
    return /^[A-Za-z0-9_-]{20,100}$/.test(candidate) ? candidate : "";
}

function validatedSheetName() {
    const name = sheetTabName.value.trim();
    if (!name || name.length > 80 || /[\\/?:*\[\]]/.test(name)) {
        throw new Error("시트 탭 이름은 1~80자로 입력하고 \\ / ? : * [ ] 문자는 사용하지 마세요.");
    }
    return name;
}

function sheetRange(name) {
    return `'${name.replaceAll("'", "''")}'!A:S`;
}

function setConnectedControls(connected) {
    syncButton.disabled = !connected;
    stopButton.disabled = !connected;
    connectButton.disabled = connected;
}

function formatTimestamp(value) {
    const date = value?.toDate?.();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function buildRows() {
    const progressByUser = new Map();
    progress.forEach((item) => {
        const uid = item.ref.parent.parent?.id;
        if (!uid || item.data().found !== true || !QR_IDS.includes(item.id)) return;
        const completed = progressByUser.get(uid) || new Set();
        completed.add(item.id);
        progressByUser.set(uid, completed);
    });
    const claimsByUser = new Map(claims.map((item) => [item.id, item.data()]));
    const header = [
        "UID", "학번", "이름", "이메일", "권한", "계정 상태", "차단 사유", "개인정보 동의", "참여 여부", "완료 수",
        ...QR_IDS.map((_, index) => `QR ${String(index + 1).padStart(2, "0")}`),
        "상품 대상", "상품 수령", "마지막 활동"
    ];
    const values = users
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((record) => (record.role || "participant") !== "withdrawn")
        .sort((left, right) => (left.studentName || left.email || "").localeCompare(right.studentName || right.email || "", "ko"))
        .map((record) => {
            const completed = progressByUser.get(record.id) || new Set();
            const received = claimsByUser.get(record.id)?.received === true;
            return [
                record.id,
                record.role === "admin" ? "관리자" : (record.studentNumber || ""),
                record.role === "admin" ? (record.adminChatName || record.studentName || "관리자") : (record.studentName || ""),
                record.email || "",
                record.role === "admin" ? "관리자" : "참여자",
                record.accountStatus === "blocked" ? "차단" : "정상",
                record.blockReason || "",
                record.privacyConsent === true ? "동의" : "미동의",
                completed.size ? "참여" : "미참여",
                completed.size,
                ...QR_IDS.map((qrId) => completed.has(qrId) ? "완료" : ""),
                completed.size === QR_IDS.length ? "대상" : "미완주",
                received ? "수령 완료" : "미수령",
                formatTimestamp(record.lastActivityAt || record.lastLoginAt)
            ];
        });
    return [header, ...values];
}

async function sheetsRequest(path, options = {}) {
    const response = await fetch(`https://sheets.googleapis.com/v4/${path}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload?.error?.message || `Google Sheets API 오류 (${response.status})`);
        error.status = response.status;
        throw error;
    }
    return payload;
}

async function ensureSheet(name) {
    const metadata = await sheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`);
    const existing = metadata.sheets?.find((sheet) => sheet.properties?.title === name);
    if (existing) return existing.properties.sheetId;
    const created = await sheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title: name } } }] })
    });
    return created.replies?.[0]?.addSheet?.properties?.sheetId;
}

async function formatSheet(sheetId, columnCount) {
    if (!Number.isInteger(sheetId)) return;
    await sheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
            requests: [
                { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
                { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColor: { red: 0.08, green: 0.08, blue: 0.07 }, textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true } } }, fields: "userEnteredFormat(backgroundColor,textFormat)" } },
                { autoResizeDimensions: { dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: columnCount } } }
            ]
        })
    });
}

async function saveConfiguration() {
    const nextId = extractSpreadsheetId(sheetUrl.value);
    const nextSheetName = validatedSheetName();
    if (!nextId) throw new Error("올바른 Google 스프레드시트 링크 또는 ID를 입력해 주세요.");
    spreadsheetId = nextId;
    const canonicalUrl = `https://docs.google.com/spreadsheets/d/${nextId}/edit`;
    sheetUrl.value = canonicalUrl;
    await setDoc(integrationReference, {
        spreadsheetId: nextId,
        spreadsheetUrl: canonicalUrl,
        sheetName: nextSheetName,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
    });
    return nextSheetName;
}

function markDataChanged(source, documents) {
    if (source === "users") users = documents;
    if (source === "progress") progress = documents;
    if (source === "claims") claims = documents;
    readySources.add(source);
    dataRevision += 1;
    dirty = true;
}

function startDataListeners() {
    stopUsers();
    stopProgress();
    stopClaims();
    readySources.clear();
    const onError = (error) => {
        console.error(error);
        status.textContent = "Firestore 동기화 데이터를 불러오지 못했습니다.";
    };
    stopUsers = onSnapshot(collection(db, "users"), (snapshot) => markDataChanged("users", snapshot.docs), onError);
    stopProgress = onSnapshot(collectionGroup(db, "progress"), (snapshot) => markDataChanged("progress", snapshot.docs), onError);
    stopClaims = onSnapshot(collection(db, "prizeClaims"), (snapshot) => markDataChanged("claims", snapshot.docs), onError);
}

function stopSynchronization(message = "자동 동기화를 중지했습니다.") {
    if (syncTimer) window.clearInterval(syncTimer);
    syncTimer = 0;
    accessToken = "";
    stopUsers();
    stopProgress();
    stopClaims();
    stopUsers = () => {};
    stopProgress = () => {};
    stopClaims = () => {};
    setConnectedControls(false);
    status.textContent = message;
}

async function synchronize(force = false) {
    if (syncing || !accessToken) return;
    if (readySources.size < 3) {
        status.textContent = "Firestore 데이터를 불러오는 중입니다...";
        return;
    }
    if (!dirty && !force) return;
    syncing = true;
    const revision = dataRevision;
    try {
        const name = validatedSheetName();
        const rows = buildRows();
        const serialized = JSON.stringify(rows);
        if (!force && serialized === lastPayload) {
            dirty = false;
            return;
        }
        status.textContent = "Google 스프레드시트와 동기화하는 중...";
        const sheetId = await ensureSheet(name);
        const range = sheetRange(name);
        await sheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
            method: "POST",
            body: JSON.stringify({ ranges: [range] })
        });
        await sheetsRequest(`spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
            method: "PUT",
            body: JSON.stringify({ majorDimension: "ROWS", values: rows })
        });
        await formatSheet(sheetId, rows[0].length);
        lastPayload = serialized;
        dirty = dataRevision !== revision;
        status.textContent = `마지막 동기화: ${new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium" }).format(new Date())} · ${rows.length - 1}명`;
    } catch (error) {
        console.error(error);
        if (error.status === 401) {
            stopSynchronization("Google 권한이 만료되었습니다. 다시 권한을 연결해 주세요.");
        } else if (error.status === 403) {
            status.textContent = "시트 쓰기 권한이 없거나 Google Sheets API가 활성화되지 않았습니다.";
        } else if (error.status === 404) {
            status.textContent = "스프레드시트를 찾지 못했습니다. 링크와 계정 권한을 확인해 주세요.";
        } else {
            status.textContent = error.message || "스프레드시트 동기화에 실패했습니다.";
        }
    } finally {
        syncing = false;
    }
}

saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    status.textContent = "연동 설정을 저장하는 중...";
    try {
        await saveConfiguration();
        dirty = true;
        status.textContent = "연동 설정을 저장했습니다. Google 권한을 연결하면 자동 동기화가 시작됩니다.";
    } catch (error) {
        console.error(error);
        status.textContent = error.message || "연동 설정을 저장하지 못했습니다.";
    } finally {
        saveButton.disabled = false;
    }
});

connectButton.addEventListener("click", async () => {
    connectButton.disabled = true;
    status.textContent = "Google Sheets 권한을 요청하는 중...";
    try {
        await saveConfiguration();
        const provider = new GoogleAuthProvider();
        provider.addScope(SHEETS_SCOPE);
        provider.setCustomParameters({ prompt: "consent", login_hint: user.email || "" });
        const result = await reauthenticateWithPopup(auth.currentUser, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (!credential?.accessToken) throw new Error("Google Sheets OAuth 토큰을 받지 못했습니다.");
        accessToken = credential.accessToken;
        lastPayload = "";
        dirty = true;
        setConnectedControls(true);
        startDataListeners();
        syncTimer = window.setInterval(() => synchronize(false), SYNC_INTERVAL_MS);
        status.textContent = "Google 권한을 연결했습니다. 데이터를 불러온 뒤 10초마다 자동 동기화합니다.";
    } catch (error) {
        console.error(error);
        setConnectedControls(false);
        status.textContent = error.code === "auth/popup-closed-by-user"
            ? "Google 권한 연결을 취소했습니다."
            : (error.message || "Google 권한을 연결하지 못했습니다.");
    } finally {
        if (!accessToken) connectButton.disabled = false;
    }
});

syncButton.addEventListener("click", () => synchronize(true));
stopButton.addEventListener("click", () => stopSynchronization());
window.addEventListener("pagehide", () => {
    if (syncTimer) window.clearInterval(syncTimer);
    stopUsers();
    stopProgress();
    stopClaims();
});

try {
    const snapshot = await getDoc(integrationReference);
    if (snapshot.exists()) {
        const config = snapshot.data();
        spreadsheetId = config.spreadsheetId || "";
        sheetUrl.value = config.spreadsheetUrl || spreadsheetId;
        sheetTabName.value = config.sheetName || "독토리_진행현황";
        status.textContent = "저장된 시트 설정이 있습니다. Google 권한을 연결하면 자동 동기화가 시작됩니다.";
    } else {
        status.textContent = "연동할 Google 스프레드시트 링크를 입력해 주세요.";
    }
} catch (error) {
    console.error(error);
    status.textContent = "스프레드시트 연동 설정을 불러오지 못했습니다.";
}
