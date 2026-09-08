let accessToken = null;
let isOwner = false;
let signedIn = false;

const SIGNED_IN_FLAG = 'ebv-was-signed-in';
const STATE_SILENT = 'silent';
const STATE_CONSENT = 'consent';

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

function buildAuthUrl(prompt, state) {
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: CONFIG.REDIRECT_URI,
    response_type: 'token',
    scope: CONFIG.OAUTH_SCOPES,
    include_granted_scopes: 'true',
    state,
  });
  if (prompt) params.set('prompt', prompt);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// 팝업도 iframe도 아닌, 전체 페이지를 구글로 이동시켰다가 그대로 돌려받는
// 방식입니다. 팝업 차단 정책에도, iframe 삽입 차단 정책에도 걸리지 않습니다.
// prompt='none'으로 호출하면 구글은 화면을 하나도 그리지 않고(로그인
// 세션과 기존 동의가 유효하면) 토큰을 붙여서 즉시 돌려보내거나, 그게
// 불가능하면 에러를 붙여서 즉시 돌려보냅니다 — 둘 다 화면 깜빡임 정도로
// 끝나고 사용자 조작이 필요 없습니다.
function redirectToGoogle(prompt, state) {
  window.location.href = buildAuthUrl(prompt, state);
}

// 구글에서 돌아왔을 때 URL 프래그먼트(#access_token=...&state=... 또는
// #error=...&state=...)를 읽습니다. 리다이렉트로 돌아온 게 아니면 null.
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

async function initAuth() {
  if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('YOUR_GOOGLE_OAUTH_CLIENT_ID')) {
    showError('config.js에 Google OAuth CLIENT_ID를 먼저 설정해주세요. (README.md 참고)');
    signinBtn.disabled = true;
    return;
  }

  // 이 클릭은 사용자 제스처 안에서 일어나는 일반적인 페이지 이동이라
  // 아무 차단 정책에도 걸리지 않습니다. 최초 로그인이나, 완전히 세션이
  // 끊긴 뒤 재로그인할 때 이 경로를 탑니다.
  signinBtn.addEventListener('click', () => {
    redirectToGoogle('consent', STATE_CONSENT);
  });

  const returned = parseReturnedHash();
  if (returned) {
    clearHash(); // 액세스 토큰이 주소창에 남지 않도록 정리
    const token = returned.get('access_token');
    if (token) {
      accessToken = token;
      localStorage.setItem(SIGNED_IN_FLAG, '1');
      signInSuccessUI();
      return;
    }
    // 에러로 돌아온 경우
    if (returned.get('state') === STATE_SILENT) {
      // 조용한 자동 재로그인 시도가 실패한 것뿐 — 화면에는 아무 표시도
      //하지 않고 로그인 버튼만 남겨둡니다 (세션이 끊겼거나 첫 방문 등).
      localStorage.removeItem(SIGNED_IN_FLAG);
      return;
    }
    showError('로그인에 실패했습니다: ' + (returned.get('error') || '알 수 없는 오류'));
    return;
  }

  // 리다이렉트로 돌아온 게 아니라 새로 페이지를 연 경우: 이전에 로그인한
  // 적이 있다면 조용히(화면 전환 없이) 자동 재로그인을 시도합니다.
  if (localStorage.getItem(SIGNED_IN_FLAG) === '1') {
    redirectToGoogle('none', STATE_SILENT);
  }
}

function signInSuccessUI() {
  clearError();
  signinBtn.hidden = true;
  if (!signedIn) {
    signedIn = true;
    afterSignIn();
  }
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
    signedIn = false;
    if (localStorage.getItem(SIGNED_IN_FLAG) === '1') {
      // 토큰이 만료된 것뿐일 수 있으니, 화면을 다시 그리지 않고 곧바로
      // 조용한 재로그인을 시도합니다(성공하면 페이지가 새로 열리며 이어집니다).
      redirectToGoogle('none', STATE_SILENT);
    } else {
      signinBtn.hidden = false;
      userStatus.hidden = true;
      menuToggle.hidden = true;
      layout.hidden = true;
    }
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
