# 경제시황분석 브리핑 뷰어

Google Drive의 "경제시황분석" 폴더에 있는 마크다운 브리핑 파일들을 목록으로 보여주고,
클릭하면 본문을 보기 좋게 렌더링해주는 정적 웹페이지입니다.
백엔드 서버 없이 GitHub Pages로만 배포됩니다.

## 동작 방식

- 방문자가 "Google로 로그인" 버튼으로 **본인 구글 계정**으로 로그인합니다(브라우저 안에서만 처리, 서버 없음).
- 로그인 후 브라우저가 Google Drive API를 직접 호출해 폴더 안의 `.md` 파일 목록을 가져옵니다.
- 목록에서 파일을 클릭하면 원문을 가져와 마크다운으로 렌더링합니다.
- 드라이브 폴더는 비공개로 유지해도 되며, 로그인한 계정에 접근 권한이 있을 때만 내용이 보입니다.

## 배포 전 필수 설정: Google OAuth 클라이언트 ID 발급

이 저장소의 코드만으로는 동작하지 않습니다. 아래 절차로 본인 소유의 OAuth 클라이언트 ID를 발급받아
`config.js`에 넣어야 합니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트를 만듭니다.
2. **API 및 서비스 > 라이브러리**에서 **Google Drive API**를 검색해 사용 설정(Enable)합니다.
3. **API 및 서비스 > OAuth 동의 화면**을 구성합니다.
   - User Type: 외부(External)
   - 앱을 게시(Publish)하지 않고 "테스트" 상태로 두어도 됩니다. 이 경우 **테스트 사용자**에 본인 구글 계정을 등록해야 로그인할 수 있습니다.
4. **API 및 서비스 > 사용자 인증 정보 > 사용자 인증 정보 만들기 > OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 자바스크립트 원본**에 GitHub Pages 주소를 추가합니다.
     - 예: `https://james0083.github.io` (경로 없이 origin만 등록하면 됩니다)
5. 발급된 클라이언트 ID(`xxxxxxxx.apps.googleusercontent.com` 형식)를 복사합니다.
6. 이 저장소의 [`config.js`](./config.js) 파일을 열어 `CLIENT_ID` 값을 교체합니다.

```js
const CONFIG = {
  CLIENT_ID: '여기에_발급받은_클라이언트_ID',
  FOLDER_ID: '1KIxaeD2vde9-KgsOUefKzqUVGhWyLfze', // 경제시황분석 폴더 ID (이미 설정됨)
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
};
```

`config.js`를 수정한 뒤 `main` 브랜치에 커밋/푸시하면 GitHub Actions 워크플로우가 자동으로
GitHub Pages에 배포합니다.

## 배포 확인

- 저장소 **Settings > Pages**에서 "Build and deployment" 항목의 Source가
  **GitHub Actions**로 설정되어 있는지 확인하세요(워크플로우가 처음 실행되면 자동으로 설정됩니다).
- 배포가 끝나면 `https://james0083.github.io/economic-briefing-viewer/` 에서 접속할 수 있습니다.

## 로컬에서 미리보기

별도 빌드 과정이 없는 순수 정적 파일이라, 아무 정적 서버로 열어보면 됩니다.

```bash
npx serve .
# 또는
python3 -m http.server 8000
```

## 파일 구성

```
index.html   페이지 레이아웃(파일 목록 + 본문 뷰어)
app.js       Google 로그인, Drive API 호출, 마크다운 렌더링 로직
config.js    CLIENT_ID / 대상 폴더 ID 설정 (배포 전 직접 채워야 함)
style.css    스타일
.github/workflows/deploy.yml   GitHub Pages 자동 배포 워크플로우
```

## 알려진 제약

- OAuth 동의 화면을 "테스트" 상태로 둔 경우, 등록된 테스트 사용자 계정으로만 로그인할 수 있고
  로그인 세션이 비교적 짧게 만료됩니다(재로그인 필요).
- 일부 브리핑 파일 본문에 이모지가 깨진 문자로 저장된 경우가 있습니다. 원본 파일의 인코딩 문제로,
  필요하면 Drive에서 원본을 다시 저장해 해결할 수 있습니다.
