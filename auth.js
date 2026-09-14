import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db } from "./firebase.js";

export const ROLES = Object.freeze({
    USER: "일반",
    STAFF: "스태프",
    ADMIN: "관리자"
});

export function watchAccess({ allowedRoles = null, loginRequired = true } = {}) {
    return new Promise((resolve) => {
        let settled = false;
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                if (loginRequired) {
                    window.location.replace(new URL("./block.html?reason=login", import.meta.url));
                    return;
                }
                if (!settled) {
                    settled = true;
                    resolve({ user: null, role: null, allowed: true });
                }
                return;
            }

            let profile;
            try {
                profile = await getUserProfile(user);
            } catch (error) {
                console.error("사용자 권한을 확인하지 못했습니다.", error);
                window.location.replace(new URL("./block.html?reason=permission", import.meta.url));
                return;
            }

            const role = Object.values(ROLES).includes(profile?.role)
                ? profile.role
                : ROLES.USER;
            const allowed = !allowedRoles || allowedRoles.includes(role);

            if (!allowed) {
                window.location.replace(new URL("./block.html?reason=permission", import.meta.url));
                return;
            } else if (allowed && !settled) {
                settled = true;
                resolve({ user, role, profile });
            }
        });
    });
}

export async function getUserProfile(user) {
    const snapshot = await getDoc(doc(db, "users", user.uid));
    return snapshot.exists() ? snapshot.data() : null;
}

export async function logout() {
    await signOut(auth);
    window.location.replace("./signin.html");
}
