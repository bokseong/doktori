### 순천 복성고 도서부 독토리 QR 미션

사이트: https://bokseong.github.io/doktori/

운영 구성:

- 정적 사이트: GitHub Pages
- 로그인·진행도·정답 검증: Firebase Authentication, Firestore, App Check
- 진행도·상품 수령 관리: 관리자 전용 Firestore 대시보드
- 회원 탈퇴: Google 재인증 후 Firestore 개인정보 익명화 및 활동 기록 삭제, Firebase Authentication 계정 삭제

디렉터리 구성:

- `account/`: 로그인, 회원 등록, 내 정보, 차단 안내, 완주 인증서
- `admin/`: 관리자 메뉴, 전체 진행률, QR 생성기
- `support/`: 사이트 안내·이용약관, 관리자와의 1:1 채팅
- `booths/doktori/`: 독토리 부스 상세 안내와 참여 방식 선택
- `qr/`: 인쇄된 QR과 연결되는 일반·스토리 문제 페이지
- `game/`: 행사 보조 게임
- `css/`, `js/`: 공통 스타일과 동작 코드 (`js/vendor/`는 외부 라이브러리)
- `assets/`: 이미지 등 정적 자산
- `apps-script/`: Firebase 회원 탈퇴 보조 Apps Script

인쇄된 QR 주소의 호환성을 위해 `qr/` 아래 문제 페이지 경로는 변경하지 않습니다.

배포 시 GitHub Pages 파일만 갱신해서는 Firestore 규칙이 바뀌지 않습니다. `firestore.rules`는 Firebase 프로젝트에 별도로 게시하고, Apps Script를 수정한 경우 새 웹 앱 버전을 배포해야 합니다. 특히 회원 탈퇴 기능은 두 배포가 모두 완료되어야 정상 작동합니다.


도박(카드게임)<br>
마녀물약<br>
스퀴시<br>
부적 인형 만들기<br>
사진찍기<br>
방명록 시스템<br>
도서대출(?)
