import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    serverTimestamp,
    where
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getMemberProfile, getUserAccess, isAccountBlocked, isMemberProfileComplete, waitForAuth } from "./auth.js";
import { db } from "./firebase.js";

let root = document.querySelector("[data-booth-review]:not(body)");

if (!root && document.body.dataset.boothReview) {
    root = document.createElement("section");
    root.dataset.boothReview = document.body.dataset.boothReview;
    document.querySelector("main")?.append(root);
}

if (root) {
    if (!document.querySelector('link[href$="css/booth-reviews.css"]')) {
        const stylesheet = document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = new URL("../css/booth-reviews.css", import.meta.url).href;
        document.head.append(stylesheet);
    }
    const boothId = root.dataset.boothReview;
    root.classList.add("booth-reviews", "panel");
    root.innerHTML = `
        <div class="booth-reviews__head"><div><span class="label">BOOTH REVIEW</span><h2 class="section-title">참여 후기</h2></div><strong id="boothReviewCount" class="booth-reviews__count">0</strong></div>
        <form id="boothReviewForm" class="booth-review-form">
            <label for="boothReviewContent">후기 작성<textarea id="boothReviewContent" maxlength="400" placeholder="부스 참여 후기를 남겨 주세요. 개인정보·비방·욕설은 작성하지 마세요." required></textarea></label>
            <div class="booth-review-form__options"><label class="booth-review-form__anonymous"><input id="boothReviewAnonymous" type="checkbox">익명으로 작성</label><button id="boothReviewSubmit" class="button--coral" type="submit">후기 등록</button></div>
            <p class="booth-review-form__notice">익명 후기는 다른 참가자에게 ‘익명’으로 표시되지만 운영을 위해 데이터베이스에는 이름과 UID가 저장됩니다. 작성자 본인 또는 1·2급 관리자가 삭제할 수 있습니다.</p>
        </form>
        <p id="boothReviewStatus" class="booth-review-status" role="status"></p>
        <ol id="boothReviewList" class="booth-review-list"></ol>
    `;

    const form = document.getElementById("boothReviewForm");
    const content = document.getElementById("boothReviewContent");
    const anonymous = document.getElementById("boothReviewAnonymous");
    const submit = document.getElementById("boothReviewSubmit");
    const status = document.getElementById("boothReviewStatus");
    const list = document.getElementById("boothReviewList");
    const count = document.getElementById("boothReviewCount");
    const user = await waitForAuth();
    let access = { isAdmin: false };
    let profile = null;

    function formatDate(value) {
        const date = value?.toDate?.();
        return date ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(date) : "방금 전";
    }

    function authorName() {
        return String(access.isAdmin
            ? (profile?.adminChatName || profile?.studentName || user?.displayName || "관리자")
            : (profile?.studentName || user?.displayName || "참여자")).trim();
    }

    function renderReviews(documents) {
        count.textContent = String(documents.length);
        list.replaceChildren();
        if (!documents.length) {
            const empty = document.createElement("li");
            empty.className = "booth-reviews__empty";
            empty.textContent = "첫 번째 후기를 남겨 보세요.";
            list.append(empty);
            return;
        }
        [...documents].sort((left, right) => {
            const leftTime = left.data().createdAt?.toMillis?.() || 0;
            const rightTime = right.data().createdAt?.toMillis?.() || 0;
            return rightTime - leftTime;
        }).forEach((review) => {
            const data = review.data();
            const item = document.createElement("li");
            item.className = "booth-review";
            const meta = document.createElement("div");
            meta.className = "booth-review__meta";
            const author = document.createElement("span");
            author.className = "booth-review__author";
            author.textContent = data.anonymous ? "익명" : (data.authorName || "참여자");
            const date = document.createElement("time");
            date.textContent = formatDate(data.createdAt);
            meta.append(author, date);
            const body = document.createElement("p");
            body.className = "booth-review__content";
            body.textContent = data.content || "";
            item.append(meta, body);
            if (user && (data.authorUid === user.uid || access.isAdmin)) {
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "booth-review__delete";
                remove.textContent = "후기 삭제";
                remove.addEventListener("click", async () => {
                    if (!window.confirm("이 후기를 삭제할까요?")) return;
                    remove.disabled = true;
                    try {
                        await deleteDoc(doc(db, "boothReviews", review.id));
                        status.textContent = "후기를 삭제했습니다.";
                    } catch (error) {
                        console.error(error);
                        status.textContent = "후기를 삭제하지 못했습니다. 권한을 확인해 주세요.";
                        remove.disabled = false;
                    }
                });
                item.append(remove);
            }
            list.append(item);
        });
    }

    if (!user) {
        form.hidden = true;
        status.textContent = "후기를 보거나 작성하려면 로그인해 주세요.";
    } else {
        profile = await getMemberProfile(user);
        access = await getUserAccess(user);
        if (isAccountBlocked(profile)) {
            form.hidden = true;
            status.textContent = "이 계정은 후기를 작성할 수 없습니다.";
        } else if (!isMemberProfileComplete(profile)) {
            form.hidden = true;
            status.textContent = "후기를 작성하려면 회원 등록을 먼저 완료해 주세요.";
        } else {
            form.addEventListener("submit", async (event) => {
                event.preventDefault();
                const value = content.value.trim();
                if (!value) return;
                submit.disabled = true;
                status.textContent = "후기를 등록하는 중...";
                try {
                    await addDoc(collection(db, "boothReviews"), {
                        boothId,
                        authorUid: user.uid,
                        authorName: authorName(),
                        anonymous: anonymous.checked,
                        content: value,
                        createdAt: serverTimestamp()
                    });
                    content.value = "";
                    anonymous.checked = false;
                    status.textContent = "후기를 등록했습니다.";
                } catch (error) {
                    console.error(error);
                    status.textContent = error.code === "permission-denied"
                        ? "후기 등록 권한을 확인하지 못했습니다. Firestore 보안 규칙 배포 상태를 확인해 주세요."
                        : "후기를 등록하지 못했습니다.";
                } finally {
                    submit.disabled = false;
                }
            });
        }
    }

    if (user) {
        const reviewQuery = query(collection(db, "boothReviews"), where("boothId", "==", boothId));
        const stopReviews = onSnapshot(reviewQuery, (snapshot) => renderReviews(snapshot.docs), (error) => {
            console.error(error);
            status.textContent = "후기를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";
        });
        window.addEventListener("pagehide", () => stopReviews(), { once: true });
    } else {
        count.textContent = "-";
        const loginLink = document.createElement("a");
        loginLink.className = "button button--paper";
        loginLink.href = new URL(`../account/signin.html?next=${encodeURIComponent(location.pathname + location.search)}`, import.meta.url).href;
        loginLink.textContent = "로그인하고 후기 보기";
        status.after(loginLink);
    }
}
