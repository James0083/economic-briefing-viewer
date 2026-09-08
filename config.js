// 배포 전에 아래 CLIENT_ID를 채워주세요.
// Google Cloud Console > API 및 서비스 > 사용자 인증 정보 에서
// "OAuth 클라이언트 ID"(유형: 웹 애플리케이션)를 만들고,
// "승인된 자바스크립트 원본"에 이 사이트의 GitHub Pages 주소(예: https://james0083.github.io)를 등록한 뒤
// 발급된 클라이언트 ID를 아래에 넣으면 됩니다. 자세한 절차는 README.md를 참고하세요.
const CONFIG = {
  CLIENT_ID: '114985047347-eb5qo0fv94rlq3sqjahhiq6cjti53ami.apps.googleusercontent.com',
  FOLDER_ID: '1KIxaeD2vde9-KgsOUefKzqUVGhWyLfze', // "경제시황분석 - Claude" 폴더 ID
  // drive.readonly: 파일 조회용. userinfo.email: 로그인한 계정이 소유자 계정인지 판별하기 위해 이메일을 읽어옴.
  OAUTH_SCOPES: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email',
  // 이 이메일로 로그인한 경우에만 하위 폴더 탐색이 표시됩니다.
  OWNER_EMAIL: 'jaewon000830@gmail.com',
  // FOLDER_ID 트리 안에 있는지 여부와 상관없이, OWNER_EMAIL로 로그인했을 때만
  // 추가로 보여줄 폴더 ID 목록. Drive에서 폴더를 다른 위치로 옮겨도 ID는
  // 바뀌지 않으므로, 실제 위치와 무관하게 계속 동작합니다.
  // (지금은 "유재원 개인 투자전략 브리핑" 폴더 — 다른 계정에는 절대 공유하지 마세요.)
  OWNER_ONLY_FOLDER_IDS: ['1mWvYywhASMUfkY1OuKCxjE1xAjbpqVqf'],
};
