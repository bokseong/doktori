import {
    collection,
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    where,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getMemberProfile, getUserAccess, requireUser } from "./auth.js";
import { db } from "./firebase.js";

const user = await requireUser();
const [profile, access] = await Promise.all([getMemberProfile(user), getUserAccess(user)]);
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
let selectedConversationUid = access.isAdmin ? "" : user.uid;
let stopConversation = () => {};

function currentAdminName() {
    return String(profile.adminChatName || profile.studentName || user.displayName || "관리자").trim();
}

function updateChatIdentity() {
    document.getElementById("chatIdentity").textContent = access.isAdmin
        ? `관리자 · ${currentAdminName()}`
        : `${profile.studentNumber} · ${profile.studentName} · 참여자`;
}

updateChatIdentity();
document.getElementById("adminLink").hidden = !access.isAdmin;
document.getElementById("chatTitle").textContent = access.isAdmin ? "1:1 도움 채팅 관리" : "관리자와 1:1 채팅";
document.getElementById("chatLead").textContent = access.isAdmin
    ? "참여자를 선택해 문의를 확인하고 답변하세요."
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
        meta.textContent = `${authorIdentity} · ${formatTime(data.createdAt)}`;
        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        bubble.textContent = data.text || "";
        row.append(meta, bubble);
        if (access.isAdmin) {
            const actions = document.createElement("div");
            actions.className = "message-actions";
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "button--paper";
            remove.textContent = "삭제";
            remove.addEventListener("click", async () => {
                if (!confirm("이 메시지를 삭제할까요?")) return;
                try { await deleteDoc(item.ref); }
                catch (error) { console.error(error); status.textContent = "메시지를 삭제하지 못했습니다."; }
            });
            actions.append(remove);
            row.append(actions);
        }
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
            .slice(-100);
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
        .filter((item) => item.role === "participant" && item.privacyConsent === true)
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
    if (!access.isAdmin || !adminIdentityForm.reportValidity()) return;
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
            studentNumber: access.isAdmin ? "관리자" : profile.studentNumber,
            studentName: access.isAdmin ? currentAdminName() : profile.studentName,
            text,
            senderRole: access.isAdmin ? "admin" : "participant",
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

if (access.isAdmin) {
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
