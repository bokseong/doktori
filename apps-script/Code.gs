const SPREADSHEET_ID = "1Jox-90UbsjjugykoqX39t8zKm6aAbRpzpQdvZRQO-bY";
const SHEET_NAME = "시트1";
const FIREBASE_API_KEY = "AIzaSyBUZ1IU5exTw3gELm7criA7ECT_Z4osld4";
const HEADERS = ["UID", "이름", "이메일", "QR 1", "QR 2", "QR 3", "완료 수", "마지막 업데이트"];
const QR_COLUMNS = Object.freeze({ qr1: 4, qr2: 5, qr3: 6 });

function doGet() {
  return jsonResponse_({ ok: true, service: "doktori-sheet-sync" });
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    if (!QR_COLUMNS[payload.qrId] || !payload.idToken) {
      throw new Error("잘못된 요청입니다.");
    }

    const user = verifyFirebaseUser_(payload.idToken);
    verifyFirestoreProgress_(payload.idToken, user.localId, payload.qrId);
    const completedAt = new Date(payload.completedAt || Date.now());
    if (Number.isNaN(completedAt.getTime())) throw new Error("완료 시간이 잘못되었습니다.");

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      upsertProgress_(user, payload.qrId, completedAt);
    } finally {
      lock.releaseLock();
    }
    return jsonResponse_({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonResponse_({ ok: false, error: error.message });
  }
}

function verifyFirestoreProgress_(idToken, uid, qrId) {
  const url = "https://firestore.googleapis.com/v1/projects/bit-code-lab-2026/databases/(default)/documents/users/"
    + encodeURIComponent(uid) + "/progress/" + encodeURIComponent(qrId);
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: "Bearer " + idToken },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error("Firestore 완료 기록을 확인할 수 없습니다.");
  }
  const document = JSON.parse(response.getContentText());
  if (document.fields?.found?.booleanValue !== true) {
    throw new Error("완료되지 않은 QR입니다.");
  }
}

function verifyFirebaseUser_(idToken) {
  const response = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FIREBASE_API_KEY,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ idToken }),
      muteHttpExceptions: true
    }
  );
  if (response.getResponseCode() !== 200) throw new Error("Firebase 사용자 인증에 실패했습니다.");
  const users = JSON.parse(response.getContentText()).users || [];
  if (users.length !== 1 || !users[0].localId) throw new Error("사용자 정보를 확인할 수 없습니다.");
  return users[0];
}

function upsertProgress_(user, qrId, completedAt) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("시트 '" + SHEET_NAME + "'을 찾을 수 없습니다.");
  ensureHeaders_(sheet);

  const lastRow = sheet.getLastRow();
  const uidValues = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat() : [];
  const index = uidValues.findIndex((value) => String(value) === user.localId);
  const row = index >= 0 ? index + 2 : Math.max(lastRow + 1, 2);

  if (index < 0) {
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
      user.localId,
      user.displayName || "",
      user.email || "",
      "", "", "", 0, completedAt
    ]]);
  } else {
    sheet.getRange(row, 2, 1, 2).setValues([[user.displayName || "", user.email || ""]]);
  }

  sheet.getRange(row, QR_COLUMNS[qrId]).setValue(completedAt);
  const completedCount = sheet.getRange(row, 4, 1, 3).getValues()[0].filter(Boolean).length;
  sheet.getRange(row, 7, 1, 2).setValues([[completedCount, completedAt]]);
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
