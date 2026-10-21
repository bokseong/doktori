import {
    addDoc,
    arrayUnion,
    collection,
    doc,
    getDoc,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { requireUser } from "./auth.js";
import { db } from "./firebase.js";
import { getEventConfig, getMissionAvailability } from "./event-config.js";
import { getPreviousQrId, getStoryCompletionCopy, isStoryMode, isStoryStageUnlocked, STORY_STAGES } from "./story-mode.js";

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

async function recordQuizTelemetry(user, qrId, outcome) {
    try {
        await addDoc(collection(db, "quizTelemetry"), {
            uid: user.uid,
            qrId,
            outcome,
            createdAt: serverTimestamp()
        });
    } catch (error) {
        console.warn("문제 통계 기록 실패", error);
    }
}

export async function initQuiz(qrId) {
    const quiz = QUIZZES[qrId];
    if (!quiz) throw new Error(`지원하지 않는 QR ID: ${qrId}`);

    const user = await requireUser();
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    const storyActive = isStoryMode(profileSnapshot.data());
    const story = STORY_STAGES[qrId];
    const form = document.getElementById("quizForm");
    const input = document.getElementById("answerInput");
    const message = document.getElementById("quizMessage");
    const submit = document.getElementById("answerButton");
    const progressReference = doc(db, "users", user.uid, "progress", qrId);

    function showStoryPanel() {
        if (!storyActive || !story) return;
        const panel = document.createElement("aside");
        panel.className = "story-panel";
        panel.innerHTML = `<span class="story-panel__label">R-06 / 기록 ${story.number}</span><h2>${story.title}</h2><p>${story.lead}</p><p class="story-panel__location">현장 단서: ${story.location}</p>`;
        document.querySelector(".quiz-card").before(panel);
    }

    function showStoryResolution() {
        if (!storyActive || !story) return;
        const panel = document.createElement("aside");
        panel.className = "story-resolution";
        panel.innerHTML = `<strong>기록 ${story.number} 복구 완료</strong><p>${story.record}</p><p>${qrId === "qr6" ? getStoryCompletionCopy() : story.next}</p>`;
        message.before(panel);
    }

    input.placeholder = "정답을 입력하세요";
    input.autocapitalize = "none";
    input.spellcheck = false;
    input.setAttribute("aria-describedby", "answerHelp");
    const answerHelp = document.createElement("p");
    answerHelp.id = "answerHelp";
    answerHelp.className = "answer-help";
    answerHelp.textContent = "띄어쓰기, 영문 대소문자와 일반적인 문장부호는 구분하지 않습니다.";
    input.after(answerHelp);

    const navigation = document.createElement("div");
    navigation.className = "quiz-navigation";
    navigation.hidden = true;
    const scanAnother = document.createElement("a");
    scanAnother.className = "button button--coral";
    scanAnother.href = qrId === "qr6" && storyActive ? "../mypage.html" : "../index.html#scan";
    scanAnother.textContent = qrId === "qr6" && storyActive ? "나의 기록 확인하기" : "다른 QR 스캔하기";
    const goHome = document.createElement("a");
    goHome.className = "button button--paper";
    goHome.href = "../index.html";
    goHome.textContent = "메인화면으로 돌아가기";
    navigation.append(scanAnother, goHome);
    message.after(navigation);

    document.getElementById("quizQuestion").textContent = quiz.question;
    showStoryPanel();

    if (storyActive && !(await isStoryStageUnlocked(user.uid, qrId))) {
        const previousQrId = getPreviousQrId(qrId);
        message.textContent = `아직 복구되지 않은 기록이 있습니다. QR ${String(Number(previousQrId.slice(2))).padStart(2, "0")}을(를) 먼저 완료하세요.`;
        input.disabled = true;
        submit.disabled = true;
        document.body.style.visibility = "visible";
        return;
    }
    try {
        const availability = getMissionAvailability(await getEventConfig(), qrId);
        if (!availability.available) {
            message.textContent = availability.message;
            input.disabled = true;
            submit.disabled = true;
        }
    } catch (error) {
        console.warn("행사 설정 확인 실패", error);
    }
    const existing = await getDoc(progressReference);
    if (existing.exists()) {
        message.textContent = storyActive ? `기록 ${story.number}은(는) 이미 복구되었습니다.` : "이미 찾은 QR입니다. 진행도에 기록되어 있습니다.";
        input.disabled = true;
        submit.disabled = true;
        navigation.hidden = false;
        showStoryResolution();
    }
    document.body.style.visibility = "visible";
    if (!existing.exists()) input.focus();

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const availability = getMissionAvailability(await getEventConfig(), qrId);
            if (!availability.available) {
                message.textContent = availability.message;
                input.disabled = true;
                submit.disabled = true;
                return;
            }
        } catch (error) {
            console.warn("제출 전 행사 설정 확인 실패", error);
        }
        const throttleKey = `doktori-last-attempt-${user.uid}-${qrId}`;
        const lastAttempt = Number(localStorage.getItem(throttleKey) || 0);
        const waitMilliseconds = 3000 - (Date.now() - lastAttempt);
        if (waitMilliseconds > 0) {
            message.textContent = `너무 빠르게 제출했습니다. ${Math.ceil(waitMilliseconds / 1000)}초 후 다시 시도해 주세요.`;
            return;
        }
        localStorage.setItem(throttleKey, String(Date.now()));
        submit.disabled = true;
        input.disabled = true;
        message.textContent = "1/3 · 정답을 확인하는 중...";
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
            message.textContent = "2/3 · 진행도를 저장했습니다. 완료 기록을 확인하는 중...";
            await recordQuizTelemetry(user, qrId, "correct");
            message.textContent = storyActive
                ? `기록 ${story.number}을(를) 복구했습니다. 다음 단서를 확인하세요.`
                : "3/3 · 정답입니다! 진행도 저장을 완료했습니다.";
            navigation.hidden = false;
            showStoryResolution();
        } catch (error) {
            console.error(error);
            await recordQuizTelemetry(user, qrId, error.code === "permission-denied" ? "incorrect" : "save-error");
            message.textContent = error.code === "permission-denied"
                ? "정답이 아닙니다. 다시 생각해 보세요."
                : "진행도를 저장하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.";
            submit.disabled = false;
            input.disabled = false;
            input.focus();
        }
    });
}
