import {
    collection,
    doc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getMemberProfile, getUserAccess, requireUser } from "./auth.js?v=27";
import { db } from "./firebase.js";

const user = await requireUser({ allowBlocked: true });
const [profile, access] = await Promise.all([getMemberProfile(user), getUserAccess(user)]);
if (access.isGrade2) {
    location.replace(new URL("../admin/", import.meta.url));
    await new Promise(() => {});
}
const adminModeRequested = new URLSearchParams(location.search).get("admin") === "1";
if (adminModeRequested && !access.isGrade1) {
    location.replace(new URL("../index.html", import.meta.url));
    await new Promise(() => {});
}
if (access.isGrade1) {
    onSnapshot(doc(db, "users", user.uid), async () => {
        if (!(await getUserAccess(user)).isGrade1) location.replace(new URL("../index.html", import.meta.url));
    }, () => {});
}
const list = document.getElementById("messageList");
const form = document.getElementById("chatForm");
const input = document.getElementById("chatInput");
const sendButton = document.getElementById("sendButton");
const status = document.getElementById("chatStatus");
const conversationPicker = document.getElementById("conversationPicker");
const conversationUser = document.getElementById("conversationUser");
const conversationTitle = document.getElementById("conversationTitle");
const adminIdentityForm = document.getElementById("adminIdentityForm");
const adminChatName = document.getElementById("adminChatName");
let selectedConversationUid = access.isGrade1 ? "" : user.uid;
let stopConversation = () => {};

function currentAdminName() {
    return String(profile.adminChatName || profile.studentName || user.displayName || "관리자").trim();
}

function updateChatIdentity() {
    document.getElementById("chatIdentity").textContent = access.isGrade1
        ? `관리자 · ${currentAdminName()}`
        : `${profile.studentNumber} · ${profile.studentName} · 참여자`;
}

updateChatIdentity();
document.getElementById("adminLink").hidden = !access.isGrade1;
document.getElementById("chatTitle").textContent = access.isGrade1 ? "1:1 도움 채팅 관리" : "관리자와 1:1 채팅";
document.getElementById("chatLead").textContent = access.isGrade1
    ? "참여자를 선택해 문의를 확인하고 답변하세요."
    : access.isBlocked
        ? "계정 이용 제한에 관해 관리자에게 문의할 수 있습니다."
        : "문제가 생기면 관리자에게 바로 질문하세요.";

function formatTime(timestamp) {
    const date = timestamp?.toDate?.();
    return date ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "전송 중";
}

function renderMessages(documents) {
    list.replaceChildren();
    if (!documents.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = selectedConversationUid ? "아직 메시지가 없습니다. 첫 질문을 남겨 보세요." : "대화할 참여자를 선택하세요.";
        list.append(empty);
        return;
    }
    documents.forEach((item) => {
        const data = item.data();
        const row = document.createElement("article");
        row.className = `message-row${data.senderUid === user.uid ? " mine" : ""}${data.senderRole === "admin" ? " admin" : ""}`;
        const meta = document.createElement("span");
        meta.className = "message-meta";
        const authorIdentity = data.senderRole === "admin"
            ? `관리자 · ${data.studentName || "이름 미등록"}`
            : (data.studentNumber
                ? `${data.studentNumber} · ${data.studentName || "이름 미등록"}`
                : `학번 미기록 · ${data.studentName || "참여자"}`);
        const senderEmail = data.senderEmail || "이메일 미기록";
        meta.textContent = `${authorIdentity} · ${senderEmail} · ${formatTime(data.createdAt)}`;
        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        bubble.textContent = data.text || "";
        row.append(meta, bubble);
        list.append(row);
    });
    list.scrollTop = list.scrollHeight;
}

function watchConversation(conversationUid) {
    stopConversation();
    stopConversation = () => {};
    selectedConversationUid = conversationUid;
    sendButton.disabled = !conversationUid;
    input.disabled = !conversationUid;
    if (!conversationUid) {
        conversationTitle.textContent = "참여자를 선택하세요.";
        renderMessages([]);
        return;
    }
    list.innerHTML = '<p class="muted">메시지를 불러오는 중...</p>';
    const messages = query(collection(db, "chatMessages"), where("conversationUid", "==", conversationUid));
    stopConversation = onSnapshot(messages, (snapshot) => {
        const documents = [...snapshot.docs]
            .sort((left, right) => {
                const leftTime = left.data().createdAt;
                const rightTime = right.data().createdAt;
                return (leftTime?.seconds || 0) - (rightTime?.seconds || 0)
                    || (leftTime?.nanoseconds || 0) - (rightTime?.nanoseconds || 0)
                    || left.id.localeCompare(right.id);
            })
        renderMessages(documents);
    }, (error) => {
        console.error(error);
        list.textContent = "채팅을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
    });
}

async function initializeAdminPicker() {
    adminIdentityForm.hidden = false;
    adminChatName.value = currentAdminName();
    conversationPicker.hidden = false;
    const snapshot = await getDocs(collection(db, "users"));
    const participants = snapshot.docs
        .map((item) => ({ uid: item.id, ...item.data() }))
        .filter((item) => ["participant", "member"].includes(item.role || "member") && item.privacyConsent === true)
        .sort((left, right) => `${left.studentNumber || ""}${left.studentName || ""}`.localeCompare(`${right.studentNumber || ""}${right.studentName || ""}`, "ko"));
    participants.forEach((participant) => {
        const option = document.createElement("option");
        option.value = participant.uid;
        option.textContent = `${participant.studentNumber || "학번 미등록"} · ${participant.studentName || "이름 미등록"}`;
        conversationUser.append(option);
    });
    const requestedUid = new URLSearchParams(location.search).get("user") || "";
    const initialUid = participants.some((item) => item.uid === requestedUid) ? requestedUid : "";
    conversationUser.value = initialUid;
    conversationUser.addEventListener("change", () => {
        const option = conversationUser.selectedOptions[0];
        conversationTitle.textContent = option?.value ? `${option.textContent}님과의 대화` : "참여자를 선택하세요.";
        watchConversation(conversationUser.value);
    });
    if (initialUid) {
        conversationTitle.textContent = `${conversationUser.selectedOptions[0].textContent}님과의 대화`;
    }
    watchConversation(initialUid);
}

adminIdentityForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!access.isGrade1 || !adminIdentityForm.reportValidity()) return;
    const nextName = adminChatName.value.trim();
    const saveButton = adminIdentityForm.querySelector("button");
    saveButton.disabled = true;
    status.textContent = "관리자 표시 이름을 저장하는 중...";
    try {
        await setDoc(doc(db, "users", user.uid), { adminChatName: nextName }, { merge: true });
        profile.adminChatName = nextName;
        updateChatIdentity();
        status.textContent = `채팅에 관리자 · ${nextName}(으)로 표시됩니다.`;
    } catch (error) {
        console.error(error);
        status.textContent = "관리자 표시 이름을 저장하지 못했습니다.";
    } finally {
        saveButton.disabled = false;
    }
});

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !selectedConversationUid) return;
    sendButton.disabled = true;
    status.textContent = "메시지를 보내는 중...";
    try {
        const messageReference = doc(collection(db, "chatMessages"));
        const batch = writeBatch(db);
        batch.set(messageReference, {
            conversationUid: selectedConversationUid,
            senderUid: user.uid,
            studentNumber: access.isGrade1 ? "관리자" : profile.studentNumber,
            studentName: access.isGrade1 ? currentAdminName() : profile.studentName,
            senderEmail: user.email || profile.email || "",
            text,
            senderRole: access.isGrade1 ? "admin" : "participant",
            createdAt: serverTimestamp()
        });
        batch.set(doc(db, "chatRateLimits", user.uid), {
            uid: user.uid,
            lastMessageId: messageReference.id,
            lastSentAt: serverTimestamp()
        });
        await batch.commit();
        input.value = "";
        status.textContent = "메시지를 보냈습니다.";
        input.focus();
    } catch (error) {
        console.error(error);
        status.textContent = error.code === "permission-denied" ? "메시지는 3초에 한 번만 보낼 수 있습니다." : "메시지를 보내지 못했습니다. 네트워크를 확인해 주세요.";
    } finally {
        sendButton.disabled = !selectedConversationUid;
    }
});

if (access.isGrade1) {
    try { await initializeAdminPicker(); }
    catch (error) {
        console.error(error);
        status.textContent = "참여자 목록을 불러오지 못했습니다.";
        watchConversation("");
    }
} else {
    conversationTitle.textContent = `${profile.studentNumber} · ${profile.studentName}님의 관리자 대화`;
    watchConversation(user.uid);
}
document.body.style.visibility = "visible";
