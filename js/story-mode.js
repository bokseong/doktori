import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

export const STORY_MODE = "story";
export const QR_IDS = Object.freeze(["qr1", "qr2", "qr3", "qr4", "qr5", "qr6"]);

export const STORY_STAGES = Object.freeze({
    qr1: {
        number: "01",
        title: "맡아 둔 시간",
        lead: "첫 번째 조각은 숫자로 잠겨 있습니다. 이곳을 이용하는 사람이라면 누구나 지나쳤을 규칙입니다.",
        record: "책은 서가에 있을 때보다 누군가에게 맡겨졌을 때 더 멀리 여행한다. 다음 사람이 그 문장을 만날 시간을 남겨 두기 위해서다.",
        next: "다음 단서는 약속한 시간보다 더 일찍 행복해지는 사람이 남긴 책 가까이에 있습니다.",
        location: "대출과 반납의 흔적이 남은 곳"
    },
    qr2: {
        number: "02",
        title: "기다림의 문장",
        lead: "두 번째 조각에는 누군가를 기다리는 장면이 남아 있습니다. 아직 오지 않은 이야기를 위해 마음을 비우는 시간입니다.",
        record: "한 권의 책을 읽기 전부터 우리는 이미 그 책을 기다린다. 첫 문장을 만나기 전의 조용한 설렘도 독서의 일부다.",
        next: "다음 조각은 한 해의 끝과 시작이 맞닿는 경계에서 유래했습니다. 역사와 문화가 적힌 곳을 찾아가세요.",
        location: "문학 서가 또는 어린왕자 근처"
    },
    qr3: {
        number: "03",
        title: "경계의 이름",
        lead: "세 번째 조각은 오래된 축제의 이름 안에 보관되어 있습니다. 낯선 이야기가 시작되는 경계에 관한 기록입니다.",
        record: "낯선 책 앞에서는 누구나 경계에 선다. 그러나 한 장만 넘기면 그 경계는 길이 된다.",
        next: "다음 조각은 문 앞에서 시작됩니다. 누군가의 문을 두드릴 때 외치는 세 단어를 기억해 보세요.",
        location: "역사와 문화가 적힌 곳"
    },
    qr4: {
        number: "04",
        title: "선택의 문",
        lead: "네 번째 조각은 선택의 문장입니다. 문을 두드리는 사람은 예상하지 못한 이야기가 시작될 가능성을 만납니다.",
        record: "책은 독자에게 선택을 건넨다. 첫 장을 넘기는 행동은 작지만 분명한 선택이다.",
        next: "다음 조각은 자신이 아닌 다른 가능성을 비추는 곳에 있습니다. 거울 표식이 있는 곳을 찾으세요.",
        location: "입구 또는 복도 갈림길"
    },
    qr5: {
        number: "05",
        title: "비친 얼굴",
        lead: "다섯 번째 조각은 거울에 관한 오래된 믿음 속에 숨겨져 있습니다. 사람들은 거울 너머에 다른 시간을 보려 했습니다.",
        record: "책은 다른 사람의 이야기를 보여 주지만, 마지막에는 읽는 사람 자신의 얼굴을 비춘다.",
        next: "마지막 조각의 제목은 한 단어입니다. 공포와 미스터리의 책이 있는 곳으로 가세요.",
        location: "안전한 거울 또는 거울 표식 근처"
    },
    qr6: {
        number: "06",
        title: "이름 없는 제목",
        lead: "마지막 조각을 찾았습니다. 어떤 이야기는 이름을 부르는 순간 더 선명해집니다.",
        record: "이름을 붙일 수 없는 이야기도 책 속에서는 자리를 얻는다. 낯섦은 다음 장을 넘기게 하는 이유가 되기도 한다.",
        next: "R-06 복구가 완료되었습니다. 나의 기록에서 결말과 완주 상태를 확인하세요.",
        location: "공포와 미스터리 서가 또는 최종 장소"
    }
});

export function isStoryMode(profile) {
    return profile?.storyMode === STORY_MODE;
}

export function getStageIndex(qrId) {
    return QR_IDS.indexOf(qrId);
}

export function getPreviousQrId(qrId) {
    const index = getStageIndex(qrId);
    return index > 0 ? QR_IDS[index - 1] : null;
}

export async function chooseStoryMode(user) {
    await setDoc(doc(db, "users", user.uid), { storyMode: STORY_MODE }, { merge: true });
}

export async function chooseNormalMode(user) {
    await setDoc(doc(db, "users", user.uid), { storyMode: "normal" }, { merge: true });
}

export async function isStoryStageUnlocked(userId, qrId) {
    const previousQrId = getPreviousQrId(qrId);
    if (!previousQrId) return true;
    const snapshot = await getDoc(doc(db, "users", userId, "progress", previousQrId));
    return snapshot.exists() && snapshot.data().found === true;
}

export function getStoryCompletionCopy() {
    return "R-06의 제목은 ‘한 권의 책을 만나는 여섯 가지 방식’입니다. 책은 읽는 사람에게서 완성됩니다.";
}
