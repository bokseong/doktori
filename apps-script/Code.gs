const SPREADSHEET_ID = "1Jox-90UbsjjugykoqX39t8zKm6aAbRpzpQdvZRQO-bY";
const SHEET_NAME = "시트1";
const FIREBASE_API_KEY = "AIzaSyBUZ1IU5exTw3gELm7criA7ECT_Z4osld4";
const FIREBASE_PROJECT_ID = "bit-code-lab-2026";
const PRIVACY_CONSENT_VERSION = "2026-10-16-v1";
const HEADERS = [
  "UID", "이름", "이메일", "학번", "개인정보 동의", "동의 일시",
  "QR 1", "QR 2", "QR 3", "QR 4", "QR 5", "QR 6", "QR 7", "QR 8", "QR 9", "QR 10",
  "완료 수", "마지막 업데이트"
];
const QR_COLUMNS = Object.freeze({
  qr1: 7, qr2: 8, qr3: 9, qr4: 10, qr5: 11,
  qr6: 12, qr7: 13, qr8: 14, qr9: 15, qr10: 16
});

function doGet() {
  return jsonResponse_({ ok: true, service: "doktori-sheet-sync" });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    const action = payload.action || "progress";
    if (!payload.idToken || !payload.appCheckToken || !["profile", "progress"].includes(action)) {
      throw new Error("잘못된 요청입니다.");
    }
    if (action === "progress" && !QR_COLUMNS[payload.qrId]) {
      throw new Error("QR 정보가 잘못되었습니다.");
    }

    verifyAppCheckToken_(payload.appCheckToken);
    const user = verifyFirebaseUser_(payload.idToken, payload.appCheckToken);
    const profile = fetchFirestoreProfile_(payload.idToken, payload.appCheckToken, user.localId);
    const completedAt = action === "progress"
      ? fetchFirestoreProgressTime_(payload.idToken, payload.appCheckToken, user.localId, payload.qrId)
      : null;

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) throw new Error("동기화 요청이 많습니다. 잠시 후 다시 시도하세요.");
    try {
      if (action === "profile") {
        upsertProfile_(user, profile);
      } else {
        upsertProgress_(user, profile, payload.qrId, completedAt);
      }
    } finally {
      lock.releaseLock();
    }
    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: error.message });
  }
}

function verifyAppCheckToken_(appCheckToken) {
  const response = UrlFetchApp.fetch(
    "https://firebaseappcheck.googleapis.com/v1beta/projects/"
      + encodeURIComponent(FIREBASE_PROJECT_ID) + ":verifyAppCheckToken",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ appCheckToken }),
      muteHttpExceptions: true
    }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error("App Check 검증에 실패했습니다.");
  }

  const result = JSON.parse(response.getContentText() || "{}");
  if (result.alreadyConsumed === true) {
    throw new Error("이미 사용된 App Check 토큰입니다.");
  }
}

function fetchFirestoreProfile_(idToken, appCheckToken, uid) {
  const url = "https://firestore.googleapis.com/v1/projects/bit-code-lab-2026/databases/(default)/documents/users/"
    + encodeURIComponent(uid);
  const response = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: "Bearer " + idToken,
      "X-Firebase-AppCheck": appCheckToken
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Firestore 회원 정보를 확인할 수 없습니다.");
  }

  const fields = JSON.parse(response.getContentText()).fields || {};
  const profile = {
    studentName: fields.studentName?.stringValue || "",
    studentNumber: fields.studentNumber?.stringValue || "",
    privacyConsent: fields.privacyConsent?.booleanValue === true,
    privacyConsentVersion: fields.privacyConsentVersion?.stringValue || "",
    privacyConsentAt: parseFirestoreTimestamp_(fields.privacyConsentAt)
  };
  if (!profile.studentName || !profile.studentNumber) {
    throw new Error("학번과 이름이 등록되지 않았습니다.");
  }
  if (!profile.privacyConsent
      || profile.privacyConsentVersion !== PRIVACY_CONSENT_VERSION
      || !profile.privacyConsentAt) {
    throw new Error("최신 개인정보 수집·이용 동의를 확인할 수 없습니다.");
  }
  return profile;
}

function fetchFirestoreProgressTime_(idToken, appCheckToken, uid, qrId) {
  const url = "https://firestore.googleapis.com/v1/projects/bit-code-lab-2026/databases/(default)/documents/users/"
    + encodeURIComponent(uid) + "/progress/" + encodeURIComponent(qrId);
  const response = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: "Bearer " + idToken,
      "X-Firebase-AppCheck": appCheckToken
    },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Firestore 완료 기록을 확인할 수 없습니다.");
  }

  const fields = JSON.parse(response.getContentText()).fields || {};
  const completedAt = parseFirestoreTimestamp_(fields.completedAt);
  if (fields.found?.booleanValue !== true || !completedAt) {
    throw new Error("완료되지 않은 QR입니다.");
  }
  return completedAt;
}

function parseFirestoreTimestamp_(field) {
  const value = field?.timestampValue;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function verifyFirebaseUser_(idToken, appCheckToken) {
  const response = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY,
    {
      method: "post",
      contentType: "application/json",
      headers: { "X-Firebase-AppCheck": appCheckToken },
      payload: JSON.stringify({ idToken }),
      muteHttpExceptions: true
    }
  );
  if (response.getResponseCode() !== 200) throw new Error("Firebase 사용자 인증에 실패했습니다.");
  const users = JSON.parse(response.getContentText()).users || [];
  if (users.length !== 1 || !users[0].localId) throw new Error("사용자 정보를 확인할 수 없습니다.");
  return users[0];
}

function upsertProfile_(user, profile) {
  const sheet = getSheet_();
  const row = findUserRow_(sheet, user.localId);
  const updatedAt = new Date();
  if (row) {
    writeIdentityIfChanged_(sheet, row, user, profile);
    sheet.getRange(row, 18).setValue(updatedAt);
    return;
  }

  sheet.getRange(Math.max(sheet.getLastRow() + 1, 2), 1, 1, HEADERS.length).setValues([[
    safeText_(user.localId), safeText_(profile.studentName), safeText_(user.email || ""), safeText_(profile.studentNumber),
    "동의", profile.privacyConsentAt,
    "", "", "", "", "", "", "", "", "", "",
    0, updatedAt
  ]]);
}

function upsertProgress_(user, profile, qrId, completedAt) {
  const sheet = getSheet_();
  let row = findUserRow_(sheet, user.localId);
  if (!row) {
    upsertProfile_(user, profile);
    row = findUserRow_(sheet, user.localId);
  } else {
    writeIdentityIfChanged_(sheet, row, user, profile);
  }

  const qrCell = sheet.getRange(row, QR_COLUMNS[qrId]);
  if (qrCell.getValue()) return;

  qrCell.setValue(completedAt);
  const completedCount = sheet.getRange(row, 7, 1, 10).getValues()[0].filter(Boolean).length;
  sheet.getRange(row, 17, 1, 2).setValues([[completedCount, completedAt]]);
}

function getSheet_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("시트 '" + SHEET_NAME + "'을 찾을 수 없습니다.");
  ensureHeaders_(sheet);
  return sheet;
}

function findUserRow_(sheet, uid) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const uidValues = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
  const index = uidValues.findIndex((value) => value === String(uid));
  return index >= 0 ? index + 2 : null;
}

function writeIdentityIfChanged_(sheet, row, user, profile) {
  const expected = [
    safeText_(user.localId), safeText_(profile.studentName), safeText_(user.email || ""), safeText_(profile.studentNumber),
    "동의", profile.privacyConsentAt
  ];
  const current = sheet.getRange(row, 1, 1, 6).getValues()[0];
  if (!rowsEqual_(current, expected)) {
    sheet.getRange(row, 1, 1, 6).setValues([expected]);
  }
}

function rowsEqual_(left, right) {
  return left.every((value, index) => {
    const other = right[index];
    if (value instanceof Date && other instanceof Date) return value.getTime() === other.getTime();
    return String(value) === String(other);
  });
}

function safeText_(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return /^\s*[=+\-@]/.test(text) ? "'" + text : text;
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (HEADERS.some((value, index) => current[index] !== value)) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  sheet.setFrozenRows(1);
}

function jsonResponse_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
