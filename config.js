// 배포 전에 아래 CLIENT_ID를 채워주세요.
// Google Cloud Console > API 및 서비스 > 사용자 인증 정보 에서
// "OAuth 클라이언트 ID"(유형: 웹 애플리케이션)를 만들고,
// "승인된 자바스크립트 원본"에 이 사이트의 GitHub Pages 주소(예: https://james0083.github.io)를 등록한 뒤
// 발급된 클라이언트 ID를 아래에 넣으면 됩니다. 자세한 절차는 README.md를 참고하세요.
const CONFIG = {
  CLIENT_ID: '114985047347-eb5qo0fv94rlq3sqjahhiq6cjti53ami.apps.googleusercontent.com',
  FOLDER_ID: '1KIxaeD2vde9-KgsOUefKzqUVGhWyLfze', // "경제시황분석" 폴더 ID
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
};
