# 경제시황분석 브리핑 뷰어

Google Drive의 "경제시황분석 - Claude" 폴더에 있는 마크다운 브리핑 파일들을 목록으로 보여주고,
클릭하면 본문을 보기 좋게 렌더링해주는 정적 웹페이지입니다. 백엔드 서버 없이 GitHub Pages로만
배포됩니다.

## 주요 기능

- **Google 로그인 + Drive API 직접 호출**: 방문자가 본인 구글 계정으로 로그인하면, 브라우저가
  Google Drive API를 직접 호출해 폴더 안의 `.md` 파일 목록을 가져오고 렌더링합니다. 서버를
  거치지 않으므로 드라이브 폴더를 비공개로 유지해도 됩니다 — 로그인한 계정이 접근 권한을
  가진 파일만 보입니다.
- **모바일 반응형**: 좁은 화면에서는 파일 목록이 좌측 슬라이드 메뉴(헤더의 ☰ 버튼)로 표시됩니다.
  화면 왼쪽 가장자리에서 오른쪽으로 스와이프해도 열립니다.
- **소유자 전용 하위 폴더**: `config.js`의 `OWNER_EMAIL`로 로그인했을 때만 하위 폴더 탐색과
  `OWNER_ONLY_FOLDER_IDS`에 지정한 폴더가 추가로 표시됩니다. 다른 계정은 최상위 폴더의
  `.md` 파일만 봅니다.
- **PWA**: 홈 화면에 추가/앱 설치가 가능하고, 서비스워커가 정적 파일을 캐싱해 오프라인에서도
  앱 셸이 뜹니다.

## 사전 준비: Google OAuth 클라이언트 ID 발급

이 저장소의 코드만으로는 동작하지 않습니다. 아래 절차로 본인 소유의 OAuth 클라이언트 ID를
발급받아 `config.js`에 넣어야 합니다.

1. [Google Cloud Console](https://console.cloud.google.com/)에서 새 프로젝트를 만듭니다.
2. **API 및 서비스 > 라이브러리**에서 **Google Drive API**를 검색해 사용 설정(Enable)합니다.
3. **API 및 서비스 > OAuth 동의 화면**을 구성합니다.
   - User Type: 외부(External)
   - "테스트" 상태로 두면 **테스트 사용자**로 등록한 계정만 로그인할 수 있습니다(등록 방법은
     아래 "새 사용자 추가하기" 참고). 100명 제한이 없고 동의가 7일마다 만료되지 않게
     하려면 "프로덕션으로 게시"하세요(심사 신청까지는 필요 없습니다).
   - 범위(Scopes)에 `.../auth/drive.readonly`와 `.../auth/userinfo.email`을 추가합니다
     (후자는 로그인한 계정이 소유자 계정인지 판별하는 데 사용됩니다).
4. **API 및 서비스 > 사용자 인증 정보 > 사용자 인증 정보 만들기 > OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - **승인된 자바스크립트 원본**에 GitHub Pages 주소를 추가: `https://james0083.github.io`
     (경로 없이 origin만)
   - **승인된 리디렉션 URI**에 이 앱 페이지의 정확한 주소를 추가:
     `https://james0083.github.io/economic-briefing-viewer/` (끝 슬래시까지 정확히 일치해야
     합니다 — 다르면 로그인 시 "400: redirect_uri_mismatch"라는 구글 자체 오류 페이지가 뜹니다)
5. 발급된 클라이언트 ID(`xxxxxxxx.apps.googleusercontent.com` 형식)를 복사해
   [`config.js`](./config.js)에 붙여넣습니다.

```js
const CONFIG = {
  CLIENT_ID: '여기에_발급받은_클라이언트_ID',
  REDIRECT_URI: 'https://james0083.github.io/economic-briefing-viewer/', // 위 4번과 정확히 일치해야 함
  FOLDER_ID: '1KIxaeD2vde9-KgsOUefKzqUVGhWyLfze', // "경제시황분석 - Claude" 폴더 ID (이미 설정됨)
  OAUTH_SCOPES: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email',
  OWNER_EMAIL: 'jaewon000830@gmail.com', // 이 계정으로 로그인할 때만 하위 폴더가 표시됨
  OWNER_ONLY_FOLDER_IDS: ['1mWvYywhASMUfkY1OuKCxjE1xAjbpqVqf'], // OWNER_EMAIL에게만 추가로 보여줄 폴더
};
```

`OWNER_ONLY_FOLDER_IDS`에 넣은 폴더는 `FOLDER_ID` 트리 안에 실제로 들어있는지와 무관하게
표시됩니다. Drive에서 폴더를 다른 위치로 옮겨도 폴더 ID는 바뀌지 않으므로 계속 동작합니다.

⚠️ **이 폴더는 다른 계정과 절대 공유하지 마세요.** 화면 표시 제한은 앱 코드가 하는 일일
뿐이고, 실제 접근 차단은 Google Drive의 공유 권한이 담당합니다 — Drive에서 공유하지 않은
폴더는 다른 계정이 로그인해도 Drive API가 애초에 데이터를 반환하지 않습니다.

`config.js`를 수정한 뒤 `main` 브랜치에 커밋/푸시하면 GitHub Actions 워크플로우가 자동으로
GitHub Pages에 배포합니다.

## 배포 확인

- 저장소 **Settings > Pages**에서 Source가 **GitHub Actions**로 설정되어 있는지 확인하세요
  (워크플로우가 처음 실행되면 자동으로 설정됩니다).
- 배포가 끝나면 `https://james0083.github.io/economic-briefing-viewer/`에서 접속할 수 있습니다.

## 로컬에서 미리보기

별도 빌드 과정이 없는 순수 정적 파일이라, 아무 정적 서버로 열어보면 됩니다.

```bash
npx serve .
# 또는
python3 -m http.server 8000
```

단, Google 로그인은 `REDIRECT_URI`로 등록된 실제 배포 주소로만 정상 동작하므로, 로그인
플로우 자체는 로컬에서 끝까지 테스트할 수 없습니다.

## 파일 구성

```
index.html    페이지 레이아웃(파일 목록 + 본문 뷰어)
app.js        Google 로그인, Drive API 호출, 마크다운 렌더링, 서비스워커 등록
config.js     CLIENT_ID / REDIRECT_URI / 대상 폴더 ID 설정 (배포 전 직접 채워야 함)
style.css     스타일
manifest.json PWA 매니페스트(앱 이름, 아이콘, 테마 색상 등)
sw.js         서비스워커 — 정적 파일(앱 셸)을 캐싱해 오프라인/설치 지원
privacy.html  개인정보처리방침 (OAuth 동의 화면 등록용)
icon-192.png / icon-512.png / apple-touch-icon.png   PWA 아이콘
.github/workflows/deploy.yml   GitHub Pages 자동 배포 워크플로우
```

## PWA(설치형 앱)

모바일 브라우저에서는 "홈 화면에 추가", 데스크톱 크롬/엣지에서는 주소창의 설치 아이콘으로
설치할 수 있습니다. `sw.js`는 정적 파일(HTML/CSS/JS/아이콘)만 네트워크 우선으로 캐싱하고,
Drive API·Google 로그인·CDN 요청은 그대로 네트워크로 보냅니다 — 배포 후 새로고침하면 항상
최신 버전을 받아옵니다. 아이콘을 바꾸려면 `icon-192.png`, `icon-512.png`,
`apple-touch-icon.png`을 같은 이름의 정사각형 PNG로 교체하면 됩니다.

**안드로이드(특히 삼성 인터넷)에서 설치 시 "이 앱은 이전 버전 Android를 대상으로 개발되어
최신 개인정보 보호 기능이 없습니다" 같은 Play Protect 경고가 뜰 수 있습니다.** 이건 매니페스트
문제가 아니라, 삼성 인터넷이 PWA를 WebAPK로 패키징할 때 쓰는 자체 빌드 서버가 오래된
Android SDK를 타겟팅하고 있어서 생기는 [삼성 인터넷 자체의 알려진 버그](https://github.com/SamsungInternet/support/issues/123)입니다. 웹사이트
코드로는 고칠 수 없으며, **Chrome 브라우저로 설치하면 뜨지 않습니다.**

## 로그인 동작 방식과 한계

- **로그인은 버튼 클릭으로만 이루어집니다.** 완전히 백엔드가 없는 정적 사이트는 Google로부터
  refresh token을 발급받을 수 없어서, 새로고침 시 화면 전환 없이 자동으로 로그인을 이어가는
  것은 이 앱 구조상 불가능합니다. (`drive.readonly`처럼 민감한 범위를 요청하는, 구글 검증을
  받지 않은 앱은 로그인 시 "Google에서 확인하지 않은 앱" 경고가 항상 뜨는데, 이 화면은
  사용자가 직접 클릭해야만 넘어갈 수 있어서 화면 없이 조용히 처리하는 방식으로는 절대 우회할
  수 없습니다.) 대신 이미 구글 계정에 로그인·동의한 상태라면, 버튼을 눌렀을 때 비밀번호
  재입력 없이 경고 화면 클릭 한 번 정도로 빠르게 들어갈 수 있습니다.
- 액세스 토큰은 보통 1시간 후 만료되며, 만료되면 다시 로그인 버튼을 눌러야 합니다.
- OAuth 동의 화면이 "테스트" 상태면 동의 자체가 7일 후 강제 만료됩니다 — 이걸 없애려면
  위 3번 단계에서 "프로덕션으로 게시"하세요.
- 완전 자동 재로그인이 꼭 필요하다면 Google 앱 검증(verification)을 받아야 합니다.
  `drive.readonly`는 "민감한 범위"라 CASA 보안 평가 없이 검증 신청이 가능하지만
  (`privacy.html`이 개인정보처리방침 요건을 충족), 심사에 며칠~몇 주가 걸릴 수 있어
  개인용 소규모 앱에는 지금의 "클릭 한 번" 방식이 현실적입니다.

## 새 사용자(뷰어) 추가하기

**두 곳**에 각각 등록해야 동작합니다 — OAuth 쪽은 "로그인 가능 여부", Drive 쪽은 "실제 파일
열람 가능 여부"를 독립적으로 결정합니다.

1. **Google Cloud Console (로그인 허용)** — OAuth 동의 화면이 "테스트" 상태라면:
   API 및 서비스 > OAuth 동의 화면 > 테스트 사용자 > **+ ADD USERS** > 이메일 입력.
   ("프로덕션"으로 게시했다면 이 단계는 필요 없습니다.)
2. **Google Drive (파일 접근 권한)** — "경제시황분석 - Claude" 폴더 우클릭 > 공유 > 이메일
   입력, 권한은 **뷰어(읽기 전용)**.

⚠️ **"유재원 개인 투자전략 브리핑" 폴더는 절대 공유하지 마세요.** `OWNER_ONLY_FOLDER_IDS`에
등록되어 있어 `OWNER_EMAIL` 계정으로 로그인했을 때만 화면에 표시되지만, 이건 앱 코드의
화면 제한일 뿐입니다. 실제 차단은 Drive 공유 설정이 하므로, 이 폴더를 공유하면 그 계정은
Drive에서 직접 열어볼 수 있게 됩니다.

## GitHub 저장소를 비공개로 바꾸면?

**Free 플랜에서는 비공개 저장소로 GitHub Pages를 쓸 수 없습니다** — GitHub Pro(개인, 유료)
또는 조직의 Team/Enterprise 플랜이 필요합니다. 참고로 Pro로 비공개 저장소에서 Pages를
켜더라도, **배포된 사이트 자체는 여전히 같은 `github.io` 주소로 누구나 접속할 수 있습니다**
— 비공개가 되는 건 소스 코드뿐이고, 빌드된 정적 페이지는 원래부터 공개되는 것이 GitHub
Pages의 기본 동작입니다(조직 단위 GitHub Enterprise Cloud에는 Pages 접근을 조직
구성원으로 제한하는 기능이 있지만 개인 Pro 플랜에는 없습니다).

`CLIENT_ID`나 Drive 폴더 ID가 코드에 그대로 노출돼 있어도 안전합니다 — `CLIENT_ID`는
애초에 공개되어도 되는 값이고(승인된 오리진으로만 제한됨), 폴더 ID를 안다고 해서 Drive
접근 권한이 없는 사람이 내용을 볼 수 있는 건 아닙니다. 실질적인 데이터 보호는 이미 Google
로그인 + Drive 공유 권한이 담당하므로, 저장소를 공개로 유지해도 보안 위험은 낮습니다.
그냥 소스를 아무나 못 보게 하고 싶다는 이유라면 GitHub Pro + 비공개 전환으로 충분합니다.

## 알려진 제약

- OAuth 동의 화면을 "테스트" 상태로 둔 경우, 등록된 테스트 사용자만 로그인할 수 있고
  동의가 7일 후 만료됩니다.
- 일부 브리핑 파일 본문에 이모지가 깨진 문자로 저장된 경우가 있습니다. 원본 파일의 인코딩
  문제로, 필요하면 Drive에서 원본을 다시 저장해 해결할 수 있습니다.
