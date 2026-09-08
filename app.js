let tokenClient;
let accessToken = null;
let isOwner = false;
let signedIn = false;
let tokenRefreshTimer = null;

const SIGNED_IN_FLAG = 'ebv-was-signed-in';

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

function waitForGis() {
  return new Promise((resolve) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    const check = setInterval(() => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        clearInterval(check);
        resolve();
      }
    }, 100);
  });
}

async function initAuth() {
  if (!CONFIG.CLIENT_ID || CONFIG.CLIENT_ID.startsWith('YOUR_GOOGLE_OAUTH_CLIENT_ID')) {
    showError('config.js에 Google OAuth CLIENT_ID를 먼저 설정해주세요. (README.md 참고)');
    signinBtn.disabled = true;
    return;
  }

  // 이 브라우저에서 이전에 로그인한 적이 있다면, 화면에 아무것도 띄우지 않고
  // 숨겨진 iframe으로 구글 세션이 아직 살아있는지 조용히 확인합니다. 팝업을
  // 띄우는 방식이 아니라서 브라우저의 팝업 차단에 걸리지 않습니다.
  if (localStorage.getItem(SIGNED_IN_FLAG) === '1') {
    trySilentRenew().then((ok) => {
      if (ok) signInSuccessUI();
    });
  }

  await waitForGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.OAUTH_SCOPES,
    callback: (response) => {
      if (response.error) {
        showError('로그인에 실패했습니다: ' + response.error);
        return;
      }
      accessToken = response.access_token;
      localStorage.setItem(SIGNED_IN_FLAG, '1');
      scheduleTokenRefresh(response.expires_in || 3600);
      signInSuccessUI();
    },
  });

  // 이 버튼 클릭은 사용자 제스처 안에서 일어나므로 팝업이 브라우저에
  // 차단되지 않습니다. 최초 로그인이나, 완전히 세션이 끊긴 뒤 재로그인할
  // 때만 이 경로를 탑니다.
  signinBtn.addEventListener('click', () => {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

function signInSuccessUI() {
  clearError();
  signinBtn.hidden = true;
  if (!signedIn) {
    signedIn = true;
    afterSignIn();
  }
}

function buildSilentAuthUrl() {
  const redirectUri = new URL('silent-renew.html', window.location.href).toString();
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: CONFIG.OAUTH_SCOPES,
    prompt: 'none',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// 팝업 없이, 숨겨진 iframe으로 액세스 토큰을 조용히 재발급받습니다.
// 브라우저에 구글 로그인 세션이 남아있고 이 앱에 대한 동의가 이미
// 되어있으면 사용자 상호작용 없이 성공합니다. 세션이 끊겼으면 그냥
// 실패로 끝나고(화면에 아무 표시도 하지 않음) 로그인 버튼이 그대로 보입니다.
function trySilentRenew(timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';

    function cleanup() {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }

    function finish(ok) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok);
    }

    function onMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.source !== 'ebv-silent-renew') return;
      const params = event.data.params || {};
      if (params.access_token) {
        accessToken = params.access_token;
        localStorage.setItem(SIGNED_IN_FLAG, '1');
        scheduleTokenRefresh(Number(params.expires_in) || 3600);
        finish(true);
      } else {
        localStorage.removeItem(SIGNED_IN_FLAG);
        finish(false);
      }
    }

    const timer = setTimeout(() => finish(false), timeoutMs);
    window.addEventListener('message', onMessage);
    iframe.src = buildSilentAuthUrl();
    document.body.appendChild(iframe);
  });
}

// Google이 발급한 액세스 토큰은 완전한 백엔드 없이는 refresh token을 받을 수
// 없어 보통 1시간 정도만 유효합니다. 만료되기 전에 조용히 새 토큰을 미리
// 받아둬서, 실제로 "로그인이 끊기는" 상황을 최대한 줄입니다.
function scheduleTokenRefresh(expiresInSeconds) {
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
  const refreshInMs = Math.max((expiresInSeconds - 300) * 1000, 30000);
  tokenRefreshTimer = setTimeout(() => {
    trySilentRenew();
  }, refreshInMs);
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

async function driveFetch(url, isRetry = false) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    if (!isRetry) {
      const refreshed = await trySilentRenew();
      if (refreshed) return driveFetch(url, true);
    }
    if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
    accessToken = null;
    signedIn = false;
    localStorage.removeItem(SIGNED_IN_FLAG);
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
