import {
    collection,
    deleteDoc,
    doc,
    limit,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
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

document.getElementById("chatIdentity").textContent = `${profile.studentNumber} · ${profile.studentName} · ${access.isAdmin ? "관리자" : "참여자"}`;
document.getElementById("adminLink").hidden = !access.isAdmin;

function formatTime(timestamp) {
    const date = timestamp?.toDate?.();
    return date ? new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "전송 중";
}

function renderMessages(documents) {
    list.replaceChildren();
    if (!documents.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "아직 메시지가 없습니다. 첫 질문을 남겨 보세요.";
        list.append(empty);
        return;
    }
    [...documents].reverse().forEach((item) => {
        const data = item.data();
        const row = document.createElement("article");
        row.className = `message-row${data.uid === user.uid ? " mine" : ""}${data.authorRole === "admin" ? " admin" : ""}`;
        const meta = document.createElement("span");
        meta.className = "message-meta";
        const authorIdentity = data.studentNumber
            ? `${data.studentNumber} · ${data.studentName || "이름 미등록"}`
            : `학번 미기록 · ${data.studentName || "참여자"}`;
        meta.textContent = `${authorIdentity}${data.authorRole === "admin" ? " · 관리자" : ""} · ${formatTime(data.createdAt)}`;
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

form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    sendButton.disabled = true;
    status.textContent = "메시지를 보내는 중...";
    try {
        const messageReference = doc(collection(db, "chatMessages"));
        const batch = writeBatch(db);
        batch.set(messageReference, {
            uid: user.uid,
            studentNumber: profile.studentNumber,
            studentName: profile.studentName,
            text,
            authorRole: access.isAdmin ? "admin" : "participant",
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
        sendButton.disabled = false;
    }
});

onSnapshot(query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(100)), (snapshot) => renderMessages(snapshot.docs), (error) => {
    console.error(error);
    list.textContent = "채팅을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
});
document.body.style.visibility = "visible";
