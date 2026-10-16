import {
    arrayUnion,
    doc,
    getDoc,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { requireUser } from "../auth.js";
import { db } from "../firebase.js";
import { syncProgressToSheet } from "../sheet-sync.js";

const QUIZZES = Object.freeze({
    qr1: { question: "도서관에서 책을 빌린 사람이 지켜야 할 가장 기본적인 약속은 무엇일까요?" },
    qr2: { question: "할로윈을 대표하는 두 가지 색은 무엇일까요?" },
    qr3: { question: "도서관에서 책등에 붙어 책의 위치를 알려 주는 번호를 무엇이라고 할까요?" },
    qr4: { question: "도서관에서 책을 빌릴 때 본인 확인에 사용하는 것은 무엇일까요?" },
    qr5: { question: "책의 장이나 항목이 시작되는 쪽을 차례대로 알려 주는 목록은 무엇일까요?" },
    qr6: { question: "국제 표준 도서 번호를 뜻하는 영문 약자는 무엇일까요?" },
    qr7: { question: "책의 가장 바깥에서 내용을 보호하는 부분을 무엇이라고 할까요?" },
    qr8: { question: "책을 쓴 사람을 뜻하는 두 글자 낱말은 무엇일까요?" },
    qr9: { question: "책을 만들어 세상에 내놓는 회사를 무엇이라고 할까요?" },
    qr10: { question: "도서관에서 다른 사람을 위해 조용히 하는 마음을 두 글자로 표현하면 무엇일까요?" }
});

function normalize(value) {
    return value.normalize("NFKC").toLowerCase().replace(/[\s.,!?·/()_-]/g, "");
}

export async function initQuiz(qrId) {
    const quiz = QUIZZES[qrId];
    if (!quiz) throw new Error(`지원하지 않는 QR ID: ${qrId}`);

    const user = await requireUser();
    const form = document.getElementById("quizForm");
    const input = document.getElementById("answerInput");
    const message = document.getElementById("quizMessage");
    const submit = document.getElementById("answerButton");
    const progressReference = doc(db, "users", user.uid, "progress", qrId);

    document.getElementById("quizQuestion").textContent = quiz.question;
    const existing = await getDoc(progressReference);
    if (existing.exists()) {
        message.textContent = "이미 찾은 QR입니다. 진행도에 기록되어 있습니다.";
        input.disabled = true;
        submit.disabled = true;
    }
    document.body.style.visibility = "visible";

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        input.disabled = true;
        message.textContent = "정답을 확인하는 중...";
        try {
            const latest = await getDoc(progressReference);
            if (!latest.exists()) {
                const batch = writeBatch(db);
                const attemptReference = doc(db, "answerAttempts", `${user.uid}_${qrId}`);
                batch.set(attemptReference, {
                    uid: user.uid,
                    qrId,
                    answer: normalize(input.value),
                    submittedAt: serverTimestamp()
                });
                batch.set(progressReference, {
                    qrId,
                    found: true,
                    completedAt: serverTimestamp()
                });
                batch.set(doc(db, "users", user.uid), {
                    uid: user.uid,
                    completedQrIds: arrayUnion(qrId),
                    lastActivityAt: serverTimestamp()
                }, { merge: true });
                await batch.commit();
            }
            await syncProgressToSheet(user, qrId);
            message.textContent = "정답입니다! 이 QR을 찾은 것으로 기록했습니다.";
        } catch (error) {
            console.error(error);
            message.textContent = error.code === "permission-denied"
                ? "정답이 아닙니다. 다시 생각해 보세요."
                : "진행도를 저장하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.";
            submit.disabled = false;
            input.disabled = false;
            input.focus();
        }
    });
}
