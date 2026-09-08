# 경제시황분석 브리핑 뷰어

Google Drive의 "경제시황분석 - Claude" 폴더에 있는 마크다운 브리핑 파일들을 목록으로 보여주고,
클릭하면 본문을 보기 좋게 렌더링해주는 정적 웹페이지입니다.
백엔드 서버 없이 GitHub Pages로만 배포됩니다.

## 동작 방식

- 방문자가 "Google로 로그인" 버튼으로 **본인 구글 계정**으로 로그인합니다(브라우저 안에서만 처리, 서버 없음).
- 로그인 후 브라우저가 Google Drive API를 직접 호출해 폴더 안의 `.md` 파일 목록을 가져옵니다.
- 목록에서 파일을 클릭하면 원문을 가져와 마크다운으로 렌더링합니다.
- 드라이브 폴더는 비공개로 유지해도 되며, 로그인한 계정에 접근 권한이 있을 때만 내용이 보입니다.
- 모바일 화면에서는 목록이 좌측 슬라이드 메뉴(햄버거 버튼 ☰)로 표시됩니다.
- 하위 폴더 탐색은 `config.js`의 `OWNER_EMAIL`로 지정한 계정으로 로그인했을 때만 표시됩니다.
  다른 테스트 사용자 계정으로 로그인하면 최상위 폴더의 `.md` 파일만 보입니다.
- PWA(설치형 웹앱)로 동작합니다. 모바일/데스크톱 브라우저에서 "홈 화면에 추가" 또는
  "앱 설치"로 아이콘을 만들어 일반 앱처럼 실행할 수 있습니다.
- 로그인은 백엔드 없이 가능한 한 오래 유지되도록 처리했습니다: 브라우저에 구글 로그인
  세션이 남아있는 동안은 페이지를 다시 열어도 자동으로(조용히) 재로그인을 시도하고,
  액세스 토큰이 만료되기 전에 미리 갱신합니다. 다만 이건 진짜 "무기한 로그인"은 아닙니다 —
  구글이 백엔드 없는 앱에는 refresh token을 내주지 않기 때문에, 브라우저에서 구글
  계정을 완전히 로그아웃하거나 이 앱에 대한 접근 권한을 취소하면 다시 로그인 버튼을
  눌러야 합니다. (아래 "로그인 유지의 한계" 참고)

## 배포 전 필수 설정: Google OAuth 클라이언트 ID 발급

이 저장소의 코드만으로는 동작하지 않습니다. 아래 절차로 본인 소유의 OAuth 클라이언트 ID를 발급받아
`config.js`에 넣어야 합니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트를 만듭니다.
2. **API 및 서비스 > 라이브러리**에서 **Google Drive API**를 검색해 사용 설정(Enable)합니다.
3. **API 및 서비스 > OAuth 동의 화면**을 구성합니다.
   - User Type: 외부(External)
   - 앱을 게시(Publish)하지 않고 "테스트" 상태로 두어도 됩니다. 이 경우 **테스트 사용자**에 본인 구글 계정을 등록해야 로그인할 수 있습니다.
   - 범위(Scopes)에 `.../auth/drive.readonly` 외에 `.../auth/userinfo.email`도 추가해주세요
     (로그인한 계정이 소유자 계정인지 판별해 하위 폴더 표시 여부를 결정하는 데 사용됩니다).
4. **API 및 서비스 > 사용자 인증 정보 > 사용자 인증 정보 만들기 > OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 자바스크립트 원본**에 GitHub Pages 주소를 추가합니다.
     - 예: `https://james0083.github.io` (경로 없이 origin만 등록하면 됩니다)
   - **승인된 리디렉션 URI**에 `silent-renew.html`의 정확한 전체 주소를 추가합니다
     (조용한 자동 재로그인에 필요합니다 — 아래 "로그인 유지의 한계" 참고).
     - 예: `https://james0083.github.io/economic-briefing-viewer/silent-renew.html`
5. 발급된 클라이언트 ID(`xxxxxxxx.apps.googleusercontent.com` 형식)를 복사합니다.
6. 이 저장소의 [`config.js`](./config.js) 파일을 열어 `CLIENT_ID` 값을 교체합니다.

```js
const CONFIG = {
  CLIENT_ID: '여기에_발급받은_클라이언트_ID',
  FOLDER_ID: '1KIxaeD2vde9-KgsOUefKzqUVGhWyLfze', // 경제시황분석 - Claude 폴더 ID (이미 설정됨)
  OAUTH_SCOPES: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email',
  OWNER_EMAIL: 'jaewon000830@gmail.com', // 이 계정으로 로그인할 때만 하위 폴더가 표시됨
  OWNER_ONLY_FOLDER_IDS: ['1mWvYywhASMUfkY1OuKCxjE1xAjbpqVqf'], // OWNER_EMAIL에게만 추가로 보여줄 폴더
};
```

`OWNER_ONLY_FOLDER_IDS`에 넣은 폴더는 `FOLDER_ID` 트리 안에 실제로 들어있는지와 무관하게,
`OWNER_EMAIL`로 로그인했을 때만 최상위에 별도 항목으로 추가됩니다. Drive에서 폴더를 다른
위치로 옮겨도 폴더 ID 자체는 바뀌지 않으므로 계속 정상 동작합니다.

⚠️ **중요**: 이 폴더는 다른 계정과 절대 공유하지 마세요. 앱의 이 로직은 화면에만 안 보이게
하는 것일 뿐, 실제 접근 차단은 Google Drive의 공유 권한이 담당합니다 — Drive에서 공유하지
않은 폴더는 다른 계정이 로그인해도 Drive API가 애초에 데이터를 반환하지 않습니다.

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
app.js       Google 로그인, Drive API 호출, 마크다운 렌더링 로직, 서비스워커 등록
config.js    CLIENT_ID / 대상 폴더 ID 설정 (배포 전 직접 채워야 함)
style.css    스타일
manifest.json   PWA 매니페스트(앱 이름, 아이콘, 테마 색상 등)
sw.js        서비스워커 — 정적 파일(앱 셸)을 캐싱해 오프라인/설치 지원
silent-renew.html   조용한 자동 재로그인용 리디렉션 페이지(구글 OAuth가 여기로 토큰을 전달)
icon-192.png / icon-512.png / apple-touch-icon.png   PWA 아이콘
.github/workflows/deploy.yml   GitHub Pages 자동 배포 워크플로우
```

## PWA(설치형 앱)

- 모바일 브라우저에서는 "홈 화면에 추가", 데스크톱 크롬/엣지에서는 주소창의 설치 아이콘으로
  설치할 수 있습니다. 설치하면 브라우저 UI 없이 일반 앱처럼 실행됩니다.
- `sw.js`는 정적 파일(HTML/CSS/JS/아이콘)만 캐싱하고, Drive API·Google 로그인·CDN 요청은
  그대로 네트워크로 보냅니다. 매번 네트워크를 먼저 시도하고 실패할 때만(오프라인 등) 캐시된
  버전을 보여주므로, 배포 후 새로고침하면 항상 최신 버전을 받아옵니다.
- 아이콘을 바꾸고 싶으면 `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`을 같은
  이름의 정사각형 PNG로 교체하면 됩니다.

## 로그인 유지의 한계

브라우저(특히 Safari의 서드파티 쿠키 차단 정책)와 Google의 보안 정책상, **완전히 백엔드가
없는 웹앱은 refresh token을 발급받을 수 없습니다.** refresh token은 만료되지 않고 서버에
안전하게 보관되어야 하는데, 정적 사이트에는 그런 안전한 저장소가 없기 때문입니다. 그래서:

- 매번 로그인 없이 "완전히 끊김 없는" 로그인은 구조적으로 불가능합니다.
- 대신 이 앱은 `silent-renew.html`을 통해 **숨겨진 iframe으로 조용히 액세스 토큰을
  재발급**받습니다 — 페이지를 다시 열 때, 토큰이 만료되기 5분 전, 그리고 API 요청이
  401로 실패했을 때. 구글 로그인 세션이 브라우저에 남아있고 이 앱에 대한 동의가 이미
  되어있으면 팝업이나 사용자 상호작용 없이 성공합니다. 구글 계정에 로그인된 상태가
  유지되는 한, 체감상 "로그인이 유지되는" 것처럼 동작합니다.
  - (참고: 처음에 `google.accounts.oauth2` 토큰 클라이언트로 페이지 로드시 자동 재인증을
    시도했었는데, 이 방식은 사용자 클릭 없이 호출하면 브라우저 팝업 차단에 걸려 실패했습니다.
    그래서 팝업이 아니라 iframe + `prompt=none` 방식으로 다시 구현했습니다.)
- 이 기능이 동작하려면 위 4번 단계에서 **승인된 리디렉션 URI**에 `silent-renew.html`
  주소를 정확히 등록해야 합니다. 등록하지 않으면 조용한 재인증 시도가 매번 실패하고
  (화면에는 아무 오류도 안 뜨고, 그냥 5초 후 포기함) 로그인 버튼을 눌러야 하는 이전
  상태로 돌아갑니다.
- 다음의 경우에는 다시 "Google로 로그인" 버튼을 눌러야 합니다: 브라우저에서 구글 계정을
  로그아웃한 경우, 이 앱에 대한 접근 권한을 [Google 계정 설정](https://myaccount.google.com/permissions)에서
  직접 취소한 경우, 브라우저 데이터(쿠키)를 지운 경우, 시크릿/프라이빗 모드로 열었거나
  브라우저가 서드파티 iframe에 대해 쿠키/스토리지를 차단하는 경우(예: Safari의 강화된
  추적 방지), 또는 OAuth 동의 화면이 "테스트" 상태라서 애초에 세션이 오래 유지되지
  않는 경우. 이런 경우엔 조용히 실패할 뿐 오류 메시지는 뜨지 않고, 그냥 로그인 버튼이
  보이는 상태로 남습니다.

## 알려진 제약

- OAuth 동의 화면을 "테스트" 상태로 둔 경우, 등록된 테스트 사용자 계정으로만 로그인할 수 있고
  로그인 세션이 비교적 짧게 만료됩니다(재로그인 필요).
- 일부 브리핑 파일 본문에 이모지가 깨진 문자로 저장된 경우가 있습니다. 원본 파일의 인코딩 문제로,
  필요하면 Drive에서 원본을 다시 저장해 해결할 수 있습니다.
