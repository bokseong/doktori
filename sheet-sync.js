export const SHEET_SYNC_URL = "https://script.google.com/macros/s/AKfycbzoFNZlH3gEvRaHImoIsXIzwcphOQYnPdNhC2EJqHDJ9GnggGQOkhBvKiCr4uBXhdVg3w/exec";

export async function syncProgressToSheet(user, qrId) {
    if (SHEET_SYNC_URL.startsWith("__")) {
        throw new Error("Google Sheets 동기화 URL이 설정되지 않았습니다.");
    }

    const idToken = await user.getIdToken();
    await fetch(SHEET_SYNC_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify({
            idToken,
            qrId,
            completedAt: new Date().toISOString()
        })
    });
}
