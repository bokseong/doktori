import {
    addDoc,
    collection,
    doc,
    getDoc,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { requireUser } from "./auth.js";
import { normalizeAnswer } from "./answer-normalization.js";
import { db } from "./firebase.js";
import { getEventConfig, getMissionAvailability, watchEventConfig } from "./event-config.js";
import { QR_ROUTES } from "./event-policy.js";

const QUIZZES = Object.freeze({
    qr1: { question: "우리 학교 도서관에서는 1인당 책을 최대 ( )권, ( )주간 빌릴 수 있습니다. 빈칸에 들어갈 말은 무엇일까요?" },
    qr2: { question: "'○○○○'를 만나며 서술되는 이야기이며, ‘만약 네가 오후 네 시에 온다면, 나는 세 시부터 행복해지기 시작할 거야.’라는 명대사를 남긴 책은 무엇일까요?" },
    qr3: { question: "할로윈의 기원이 된 고대 켈트족의 축제 이름은 무엇일까요? (영어로 입력)" },
    qr4: { question: "아이들이 할로윈에 분장을 하고 집집마다 다니며 외치는 전통적인 말은 무엇일까요? (영어로 입력)" },
    qr5: { question: "할로윈 날 밤에 어두운 방에서 거울을 보면 무엇이 보인다는 미신이 있습니다. 이 미신은 무엇인가요?" },
    qr6: { question: "스티븐 킹이 1986년에 집필했으며 2017년에 영화로도 나온 책의 이름은 무엇일까요?" }
});

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

export async function initQuiz(qrId, pageMode = "normal") {
    const quiz = QUIZZES[qrId];
    if (!quiz) throw new Error(`지원하지 않는 QR ID: ${qrId}`);
    if (!["normal", "story"].includes(pageMode)) throw new Error(`지원하지 않는 QR 페이지 모드: ${pageMode}`);
    if (pageMode === "story") {
        location.replace(new URL(`../qr/${QR_ROUTES[qrId]}`, import.meta.url));
        return;
    }

    let unavailableHandled = false;
    const leaveUnavailable = (availability) => {
        if (unavailableHandled) return;
        unavailableHandled = true;
        alert(`이벤트가 종료되었거나 일시 중지되었습니다.\n${availability.message}`);
        location.replace(new URL("../index.html", import.meta.url));
    };

    try {
        const initialAvailability = getMissionAvailability(await getEventConfig(), qrId);
        if (!initialAvailability.available) {
            leaveUnavailable(initialAvailability);
            await new Promise(() => {});
        }
    } catch (error) {
        console.warn("행사 설정 확인 실패", error);
        alert("행사 운영 상태를 확인할 수 없습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
        location.replace(new URL("../index.html", import.meta.url));
        await new Promise(() => {});
    }

    const user = await requireUser();
    const form = document.getElementById("quizForm");
    const inlineInputs = [...form.querySelectorAll("[data-answer-part]")];
    const answerInputs = inlineInputs.length ? inlineInputs : [document.getElementById("answerInput")];
    const input = answerInputs[0];
    const message = document.getElementById("quizMessage");
    const submit = document.getElementById("answerButton");
    const progressReference = doc(db, "users", user.uid, "progress", qrId);

    answerInputs.forEach((answerInput) => {
        if (!answerInput.placeholder) answerInput.placeholder = "정답";
        answerInput.autocapitalize = "none";
        answerInput.spellcheck = false;
        answerInput.setAttribute("aria-describedby", "answerHelp");
    });
    const answerHelp = document.createElement("p");
    answerHelp.id = "answerHelp";
    answerHelp.className = "answer-help";
    answerHelp.textContent = inlineInputs.length
        ? "두 빈칸을 모두 숫자로 입력해 주세요."
        : "띄어쓰기, 영문 대소문자와 일반적인 문장부호는 구분하지 않습니다.";
    form.append(answerHelp);

    function setAnswerInputsDisabled(disabled) {
        answerInputs.forEach((answerInput) => { answerInput.disabled = disabled; });
    }

    function submittedAnswer() {
        return answerInputs.map((answerInput) => answerInput.value.trim()).join(", ");
    }

    const navigation = document.createElement("div");
    navigation.className = "quiz-navigation";
    navigation.hidden = true;
    const scanAnother = document.createElement("a");
    scanAnother.className = "button button--coral";
    scanAnother.href = new URL("../booths/doktori/participate.html", import.meta.url).href;
    scanAnother.textContent = "다른 QR 스캔하기";
    const goHome = document.createElement("a");
    goHome.className = "button button--paper";
    goHome.href = new URL("../index.html", import.meta.url).href;
    goHome.textContent = "메인화면으로 돌아가기";
    navigation.append(scanAnother, goHome);
    message.after(navigation);

    document.getElementById("quizQuestion").textContent = qrId === "qr1" && inlineInputs.length
        ? "빈칸을 채워 도서관 이용 규칙을 완성하세요."
        : quiz.question;
    const stopAvailabilityWatch = watchEventConfig((config) => {
        const availability = getMissionAvailability(config, qrId);
        if (!availability.available) leaveUnavailable(availability);
    }, (error) => console.warn("실시간 행사 상태 확인 실패", error));
    window.addEventListener("pagehide", () => stopAvailabilityWatch(), { once: true });
    const existing = await getDoc(progressReference);
    if (existing.exists()) {
        message.textContent = "이미 찾은 QR입니다. 진행도에 기록되어 있습니다.";
        setAnswerInputsDisabled(true);
        submit.disabled = true;
        navigation.hidden = false;
    }
    document.body.style.visibility = "visible";
    if (!existing.exists()) input.focus();

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try {
            const availability = getMissionAvailability(await getEventConfig(), qrId);
            if (!availability.available) {
                message.textContent = availability.message;
                setAnswerInputsDisabled(true);
                submit.disabled = true;
                return;
            }
        } catch (error) {
            console.warn("제출 전 행사 설정 확인 실패", error);
            message.textContent = "행사 운영 상태를 확인하지 못해 제출하지 않았습니다. 네트워크를 확인해 주세요.";
            return;
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
        setAnswerInputsDisabled(true);
        message.textContent = "1/3 · 정답을 확인하는 중...";
        try {
            const latest = await getDoc(progressReference);
            if (!latest.exists()) {
                const batch = writeBatch(db);
                const attemptReference = doc(db, "answerAttempts", `${user.uid}_${qrId}`);
                batch.set(attemptReference, {
                    uid: user.uid,
                    qrId,
                    answer: normalizeAnswer(submittedAnswer()),
                    submittedAt: serverTimestamp()
                });
                batch.set(progressReference, {
                    qrId,
                    found: true,
                    completedAt: serverTimestamp()
                });
                await batch.commit();
            }
            message.textContent = "2/3 · 진행도를 저장했습니다. 완료 기록을 확인하는 중...";
            await recordQuizTelemetry(user, qrId, "correct");
            message.textContent = "3/3 · 정답입니다! 진행도 저장을 완료했습니다.";
            navigation.hidden = false;
        } catch (error) {
            console.error(error);
            await recordQuizTelemetry(user, qrId, "save-error");
            message.textContent = error.code === "permission-denied"
                ? "정답이 아니거나 보안 확인에 실패했습니다. 입력을 확인한 뒤 다시 시도해 주세요."
                : "진행도를 저장하지 못했습니다. 네트워크를 확인하고 다시 시도하세요.";
            submit.disabled = false;
            setAnswerInputsDisabled(false);
            input.focus();
        }
    });
}
