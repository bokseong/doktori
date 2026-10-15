import {
    arrayUnion,
    doc,
    getDoc,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { requireUser } from "../auth.js";
import { db } from "../firebase.js";
import { syncProgressToSheet } from "../sheet-sync.js";

const QUIZZES = Object.freeze({
    qr1: {
        question: "도서관에서 책을 빌린 사람이 지켜야 할 가장 기본적인 약속은 무엇일까요?"
    },
    qr2: {
        question: "할로윈을 대표하는 두 가지 색은 무엇일까요?"
    },
    qr3: {
        question: "도서관에서 책등에 붙어 책의 위치를 알려 주는 번호를 무엇이라고 할까요?"
    }
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
                await setDoc(progressReference, {
                    qrId,
                    found: true,
                    answer: normalize(input.value),
                    completedAt: serverTimestamp()
                });
            }
            await setDoc(doc(db, "users", user.uid), {
                uid: user.uid,
                completedQrIds: arrayUnion(qrId),
                lastActivityAt: serverTimestamp()
            }, { merge: true });
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
