import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase.js";

export const STORY_MODE = "story";
export const QR_IDS = Object.freeze(["qr1", "qr2", "qr3", "qr4", "qr5", "qr6"]);

export const STORY_STAGES = Object.freeze({
    qr1: {
        number: "01",
        title: "이용 규칙의 첫 줄",
        lead: "도서부가 준비하던 탐색 카드 BS-001의 첫 항목은 도서관 이용 규칙에서 시작됩니다. 서가 가까이에서 첫 QR을 찾아 보세요.",
        record: "BS-001의 첫 항목: 책을 빌리고 다시 만나는 시간.",
        next: "두 번째 항목은 한 문장이 오래 남는 책 가까이에 있습니다.",
        location: "도서관 이용 안내 또는 대출·반납 표지 근처"
    },
    qr2: {
        number: "02",
        title: "기다림이 시작되는 문장",
        lead: "두 번째 항목은 독자가 한 문장을 기다리게 만드는 순간에 대한 기록입니다.",
        record: "두 번째 항목: 한 문장이 책을 기다리게 하는 순간.",
        next: "세 번째 항목은 이야기의 오래된 출발점에 관한 참고 카드입니다.",
        location: "문학 작품 또는 인용문 안내 근처"
    },
    qr3: {
        number: "03",
        title: "오래된 참고 카드",
        lead: "이 항목은 문화와 이야기의 오래된 출발점을 찾아보는 참고 카드입니다.",
        record: "세 번째 항목: 이름 하나가 새로운 이야기를 여는 출발점.",
        next: "네 번째 항목은 독자가 먼저 말을 건네는 장면에 있습니다.",
        location: "문화·신화·전통 관련 자료 근처"
    },
    qr4: {
        number: "04",
        title: "낯선 문 앞의 인사",
        lead: "네 번째 항목은 책 속 세계에 처음 말을 거는 방식에 관한 카드입니다.",
        record: "네 번째 항목: 처음 말을 건넬 때 이야기가 움직이기 시작한다.",
        next: "다섯 번째 항목은 거울이 아니라, 다른 관점에 관한 서가 쪽에 있습니다.",
        location: "입구 안내 또는 행사 표지 근처"
    },
    qr5: {
        number: "05",
        title: "다른 관점의 서가",
        lead: "다섯 번째 항목은 한 장면을 여러 관점으로 읽어 보는 카드입니다.",
        record: "다섯 번째 항목: 이야기는 읽는 사람의 관점마다 다르게 비친다.",
        next: "마지막 항목은 한 작품을 불러내는 제목 가까이에 있습니다.",
        location: "소설·미스터리·전설 자료 근처"
    },
    qr6: {
        number: "06",
        title: "제목을 찾는 마지막 카드",
        lead: "마지막 항목은 이야기의 제목이 독자를 어디까지 데려가는지 묻습니다.",
        record: "여섯 번째 항목: 제목은 한 권의 책으로 들어가는 문이다.",
        next: "BS-001 탐색 카드가 완성되었습니다. 나의 기록에서 완주 상태를 확인하세요.",
        location: "스릴러·미스터리·영화 원작 자료 근처"
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
    return "BS-001 완성: 다음 책으로 향하는 여섯 개의 출발점. 이용 규칙, 한 문장, 문화 참고 카드, 첫 인사, 다른 관점, 작품 제목은 모두 다음 책을 펼치게 하는 출발점입니다.";
}
