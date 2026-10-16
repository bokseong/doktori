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
    qr1: { question: "우리 학교 도서관에서는 1인당 책을 최대 ( )권, ( )주간 빌릴 수 있습니다. 빈칸에 들어갈 말은 무엇일까요?" },
    qr2: { question: "'○○○○'를 만나며 서술되는 이야기이며, ‘만약 네가 오후 네 시에 온다면, 나는 세 시부터 행복해지기 시작할 거야.’라는 명대사를 남긴 책은 무엇일까요?" },
    qr3: { question: "할로윈의 기원이 된 고대 켈트족의 축제 이름은 무엇일까요? (영어로 입력)" },
    qr4: { question: "아이들이 할로윈에 분장을 하고 집집마다 다니며 외치는 전통적인 말은 무엇일까요? (영어로 입력)" },
    qr5: { question: "할로윈 날 밤에 어두운 방에서 거울을 보면 무엇이 보인다는 미신이 있나요?" },
    qr6: { question: "스티븐 킹이 1986년에 집필했으며 2017년에 영화로도 나온 책의 이름은 무엇일까요?" }
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
