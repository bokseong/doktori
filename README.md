### 순천 복성고 도서부 독토리 QR 미션

사이트: https://bokseong.github.io/doktori/

운영 구성:

- 정적 사이트: GitHub Pages
- 로그인·진행도·정답 검증: Firebase Authentication, Firestore, App Check
- 진행도 시트 동기화: `apps-script/Code.gs`로 배포한 Google Apps Script 웹 앱
- 관리자 화면: `zb0bl7hn6ghtak72c.html`

배포 시 GitHub Pages 파일만 갱신해서는 Firestore 규칙이 바뀌지 않습니다. `firestore.rules`는 Firebase 프로젝트에 별도로 게시하고, Apps Script를 수정한 경우 새 웹 앱 버전을 배포해야 합니다. 정답은 저장소에 넣지 않고 Firestore의 `quizSecrets/qr1`~`quizSecrets/qr6` 문서에만 보관합니다.
