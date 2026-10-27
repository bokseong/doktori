export const QR_IDS = Object.freeze(Array.from({ length: 6 }, (_, index) => `qr${index + 1}`));
export const BOOTH_IDS = Object.freeze(Array.from({ length: 6 }, (_, index) => `booth${index + 1}`));
export const QR_ROUTES = Object.freeze({
    qr1: "299az81a68c.html",
    qr2: "hq1bq8pg1c.html",
    qr3: "iq1bz5iutx.html",
    qr4: "qrxc7ij88f.html",
    qr5: "eq4bunq5v.html",
    qr6: "jk1ba63db.html"
});

export const QR_SUCCESS_REQUIRED = 3;
export const BOOTH_SUCCESS_REQUIRED = 3;

export const DATA_RETENTION_START = new Date("2026-10-27T15:00:00.000Z");
export const DATA_RETENTION_END = new Date("2026-10-30T05:00:00.000Z");

export function hasQrSuccess(completedCount) {
    return Number(completedCount) >= QR_SUCCESS_REQUIRED;
}

export function hasBoothSuccess(participatedCount) {
    return Number(participatedCount) >= BOOTH_SUCCESS_REQUIRED;
}

export function hasEventSuccess(completedQrCount, participatedBoothCount) {
    return hasQrSuccess(completedQrCount) || hasBoothSuccess(participatedBoothCount);
}
