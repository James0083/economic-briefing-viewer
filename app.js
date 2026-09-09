let accessToken = null;
let isOwner = false;

const signinBtn = document.getElementById('signin-btn');
const userStatus = document.getElementById('user-status');
const layout = document.getElementById('layout');
const fileListEl = document.getElementById('file-list');
const placeholder = document.getElementById('content-placeholder');
const contentView = document.getElementById('content-view');
const errorBanner = document.getElementById('error-banner');
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebar-backdrop');

// 브리핑 원문에 날짜/숫자 범위 표기로 물결표(~)가 자주 쓰이는데(예: "9/7~9/8",
// "5~8가지"), GFM 취소선 문법은 물결표 한 개만으로도 짝을 지어 취소선으로
// 인식해버려서 관련 없는 구간이 통째로 취소선 처리되는 문제가 있었다.
// (예: "5~8가지 (9/7~9/8)" → "5<del>8가지 (9/7</del>9/8)") 이 앱에서는
// 취소선 문법을 쓸 일이 없으므로 아예 비활성화한다.
marked.use({
  tokenizer: {
    del() {
      return undefined;
    },
  },
});

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.hidden = true;
}

function openSidebar() {
  sidebar.classList.add('open');
  sidebarBackdrop.classList.add('show');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarBackdrop.classList.remove('show');
}

menuToggle.addEventListener('click', () => {
  if (sidebar.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
});
sidebarBackdrop.addEventListener('click', closeSidebar);

// 본문 영역 어디에서든 가로로 스와이프하면 사이드바를 열고 닫습니다.
// 화면 가장자리에서 시작하는 스와이프는 안드로이드(특히 갤럭시)의 시스템
// "뒤로 가기" 제스처가 먼저 가로채므로, 가장자리 부근에서 시작한 터치는
// 아예 무시하고 본문 안쪽에서 시작한 것만 인식합니다.
const SYSTEM_GESTURE_ZONE = 32; // 좌우 가장자리 이 범위는 시스템 제스처 영역으로 간주
const SWIPE_THRESHOLD = 60;

let swipeStartX = null;
let swipeStartY = null;
let swipeTracking = false;

// 가로 스크롤이 가능한 요소(넓은 표, 코드 블록 등) 위에서 시작한 스와이프는
// 그 요소를 스크롤하려는 의도이므로 사이드바 제스처로 쓰지 않습니다.
function startedInsideScrollableArea(target) {
  let el = target;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) return true;
    el = el.parentElement;
  }
  return false;
}

document.addEventListener(
  'touchstart',
  (e) => {
    swipeTracking = false;
    if (window.innerWidth > 720) return; // 데스크톱 레이아웃에서는 사이드바가 항상 보임
    if (layout.hidden) return; // 로그인 전에는 열 목록이 없음
    const touch = e.touches[0];
    if (touch.clientX < SYSTEM_GESTURE_ZONE) return;
    if (touch.clientX > window.innerWidth - SYSTEM_GESTURE_ZONE) return;
    if (startedInsideScrollableArea(e.target)) return;
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeTracking = true;
  },
  { passive: true }
);

document.addEventListener(
  'touchmove',
  (e) => {
    if (!swipeTracking) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      swipeTracking = false; // 세로 스크롤 의도로 판단되면 취소
      return;
    }
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;

    if (sidebar.classList.contains('open')) {
      if (deltaX < 0) closeSidebar(); // 열린 상태에서 왼쪽으로 밀면 닫기
    } else if (deltaX > 0) {
      openSidebar(); // 닫힌 상태에서는 오른쪽으로 밀 때만 열기
    }
    swipeTracking = false;
  },
  { passive: true }
);

document.addEventListener('touchend', () => {
  swipeTracking = false;
});

// 이 앱은 drive.readonly(민감 범위)를 요청하는데, 구글 앱 검증(verification)을
// 받지 않으면 "Google에서 확인하지 않은 앱" 경고 화면이 테스트/프로덕션 상태와
// 무관하게 항상 뜬다. 이 화면은 대화형(사용자 클릭)으로만 넘어갈 수 있고
// prompt=none으로는 절대 건너뛸 수 없어서, 팝업/iframe/리다이렉트 무엇으로
// 시도하든 "완전 자동 재로그인"은 애초에 불가능하다(검증을 받아야 사라짐).
// 그래서 억지로 조용한 재인증을 시도했다가 매번 실패해서 화면만 깜빡이게
// 하지 않고, 로그인 버튼 클릭 한 번으로만 동작하도록 단순하게 유지한다.
function buildAuthUrl() {
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    response_type: 'token',
    scope: CONFIG.OAUTH_SCOPES,
    include_granted_scopes: 'true',
    state: 'ebv',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function redirectToGoogle() {
  window.location.href = buildAuthUrl();
}

// 구글에서 돌아왔을 때 URL 프래그먼트(#access_token=... 또는 #error=...)를
// 읽습니다. 리다이렉트로 돌아온 게 아니면 null.
function parseReturnedHash() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (!params.has('access_token') && !params.has('error')) return null;
  return params;
}

function clearHash() {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

// 구글이 발급한 액세스 토큰은 보통 1시간 정도 유효합니다. 이걸 저장해두면
// 그 시간 안에는 새로고침하거나 앱을 다시 열어도 구글에 다녀오지 않고 바로
// 이어서 쓸 수 있습니다. (검증받지 않은 앱이라 자동 재발급은 불가능하므로,
// 이미 받아둔 토큰을 유효기간까지 최대한 활용하는 방식입니다.)
const TOKEN_STORAGE_KEY = 'ebv-token';

function saveToken(token, expiresInSeconds) {
  // 만료 직전에 요청이 실패하지 않도록 1분 정도 여유를 둡니다.
  const expiresAt = Date.now() + (Number(expiresInSeconds) || 3600) * 1000 - 60000;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({ token, expiresAt }));
  } catch (err) {
    // 저장 공간을 못 쓰는 환경(시크릿 모드 등)에서는 이번 세션에만 로그인이 유지됩니다.
  }
}

function loadSavedToken() {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || !saved.token || !saved.expiresAt) return null;
    if (Date.now() >= saved.expiresAt) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      return null;
    }
    return saved.token;
  } catch (err) {
    return null;
  }
}

function clearSavedToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch (err) {
    // 무시
  }
}

function initAuth() {
  if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('YOUR_GOOGLE_OAUTH_CLIENT_ID')) {
    showError('config.js에 Google OAuth CLIENT_ID를 먼저 설정해주세요. (README.md 참고)');
    signinBtn.disabled = true;
    return;
  }

  signinBtn.addEventListener('click', redirectToGoogle);

  const returned = parseReturnedHash();
  if (returned) {
    clearHash(); // 액세스 토큰이 주소창에 남지 않도록 정리
    const token = returned.get('access_token');
    if (token) {
      accessToken = token;
      saveToken(token, returned.get('expires_in'));
      signInSuccessUI();
      return;
    }
    showError('로그인에 실패했습니다: ' + (returned.get('error') || '알 수 없는 오류'));
    return;
  }

  // 리다이렉트로 돌아온 게 아니라면, 아직 유효한 토큰이 저장돼 있는지 확인합니다.
  const savedToken = loadSavedToken();
  if (savedToken) {
    accessToken = savedToken;
    signInSuccessUI();
  }
}

function signInSuccessUI() {
  clearError();
  signinBtn.hidden = true;
  afterSignIn();
}

async function afterSignIn() {
  const email = await fetchUserEmail();
  isOwner = email === CONFIG.OWNER_EMAIL;
  userStatus.hidden = false;
  userStatus.textContent = email || '로그인됨';
  menuToggle.hidden = false;
  layout.hidden = false;
  await loadFileTree();
}

// 네트워크가 불안정할 때 fetch가 응답 없이 무한정 멈춰있으면 화면도 그대로
// 멈춰버립니다. 일정 시간 안에 응답이 없으면 타임아웃 에러로 실패 처리해서
// 최소한 오류 메시지라도 뜨게 합니다.
async function driveFetch(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('요청 시간이 초과되었습니다. 네트워크 상태를 확인해주세요.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    accessToken = null;
    clearSavedToken();
    signinBtn.hidden = false;
    userStatus.hidden = true;
    menuToggle.hidden = true;
    layout.hidden = true;
    throw new Error('로그인이 만료되었습니다. 다시 로그인해주세요.');
  }
  if (!res.ok) {
    throw new Error(`요청 실패 (${res.status})`);
  }
  return res;
}

async function fetchUserEmail() {
  try {
    const res = await driveFetch('https://www.googleapis.com/oauth2/v3/userinfo');
    const data = await res.json();
    return data.email || null;
  } catch (err) {
    return null;
  }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function fetchFolderChildren(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&orderBy=folder,name desc&pageSize=200`;
  const res = await driveFetch(url);
  const data = await res.json();
  return data.files || [];
}

async function fetchFolderMeta(folderId) {
  const url = `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name`;
  const res = await driveFetch(url);
  return res.json();
}

// 소유자 계정으로 로그인한 경우에만 하위 폴더까지 재귀적으로 조회합니다.
async function loadFolderTree(folderId) {
  const children = await fetchFolderChildren(folderId);
  const subfolders = children.filter((f) => f.mimeType === FOLDER_MIME);
  const mdFiles = children.filter((f) => f.name.toLowerCase().endsWith('.md'));

  let folders = [];
  if (isOwner && subfolders.length > 0) {
    folders = await Promise.all(
      subfolders.map(async (folder) => ({
        id: folder.id,
        name: folder.name,
        ...(await loadFolderTree(folder.id)),
      }))
    );
  }

  return { folders, files: mdFiles };
}

// OWNER_ONLY_FOLDER_IDS에 지정된 폴더는 FOLDER_ID 트리 안에 실제로 있는지와
// 무관하게, 소유자 계정으로 로그인했을 때만 최상위에 별도로 추가됩니다.
async function loadOwnerOnlyFolders(alreadyIncludedIds) {
  const ids = Array.isArray(CONFIG.OWNER_ONLY_FOLDER_IDS) ? CONFIG.OWNER_ONLY_FOLDER_IDS : [];
  const extraFolders = [];
  for (const folderId of ids) {
    if (alreadyIncludedIds.has(folderId)) continue;
    try {
      const meta = await fetchFolderMeta(folderId);
      const subtree = await loadFolderTree(folderId);
      extraFolders.push({ id: folderId, name: meta.name, ...subtree });
    } catch (err) {
      // 아직 이동 전이라 접근 권한이 없거나 폴더를 찾을 수 없으면 조용히 건너뜁니다.
    }
  }
  return extraFolders;
}

async function loadFileTree() {
  fileListEl.innerHTML = '<p class="muted">불러오는 중...</p>';
  try {
    const tree = await loadFolderTree(CONFIG.FOLDER_ID);

    if (isOwner) {
      const alreadyIncludedIds = new Set(tree.folders.map((f) => f.id));
      tree.folders.push(...(await loadOwnerOnlyFolders(alreadyIncludedIds)));
    }

    fileListEl.innerHTML = '';
    renderTree(tree, fileListEl, 0);
    if (fileListEl.children.length === 0) {
      fileListEl.innerHTML = '<p class="muted">표시할 .md 파일이 없습니다.</p>';
    }
  } catch (err) {
    showError(err.message);
    fileListEl.innerHTML = '';
  }
}

function renderTree(node, container, depth) {
  node.folders.forEach((folder) => {
    const details = document.createElement('details');
    details.className = 'folder-item';
    details.open = depth === 0;

    const summary = document.createElement('summary');
    summary.textContent = `📁 ${folder.name}`;
    details.appendChild(summary);

    const childContainer = document.createElement('div');
    childContainer.className = 'folder-children';
    details.appendChild(childContainer);

    renderTree(folder, childContainer, depth + 1);
    container.appendChild(details);
  });

  node.files.forEach((file) => {
    const item = document.createElement('button');
    item.className = 'file-item';
    item.textContent = formatFileLabel(file.name);
    item.addEventListener('click', () => {
      openFile(file, item);
      closeSidebar();
    });
    container.appendChild(item);
  });
}

function formatFileLabel(name) {
  const dateMatch = name.match(/(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : name.replace(/\.md$/i, '');
}

function parseFrontmatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  match[1].split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) meta[key] = value;
  });
  return { meta, body: text.slice(match[0].length) };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function openFile(file, buttonEl) {
  document.querySelectorAll('.file-item').forEach((el) => el.classList.remove('active'));
  buttonEl.classList.add('active');
  placeholder.hidden = true;
  contentView.hidden = false;
  contentView.innerHTML = '<p class="muted">불러오는 중...</p>';
  try {
    const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
    const res = await driveFetch(url);
    const text = await res.text();
    const { meta, body } = parseFrontmatter(text);
    const html = DOMPurify.sanitize(marked.parse(body, { gfm: true, breaks: false }));
    contentView.innerHTML = `
      <header class="doc-header">
        <h2>${meta.title ? escapeHtml(meta.title) : escapeHtml(file.name)}</h2>
        ${meta.date ? `<time>${escapeHtml(meta.date)}</time>` : ''}
      </header>
      <div class="doc-body">${html}</div>
    `;
    clearError();
  } catch (err) {
    contentView.innerHTML = '';
    showError(err.message);
  }
}

initAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // 서비스워커 등록 실패는 앱 동작에 영향 없으므로 조용히 무시합니다.
    });
  });
}
