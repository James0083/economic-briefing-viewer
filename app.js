let tokenClient;
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

  await waitForGis();
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.OAUTH_SCOPES,
    callback: async (response) => {
      if (response.error) {
        showError('로그인에 실패했습니다: ' + response.error);
        return;
      }
      accessToken = response.access_token;
      clearError();
      signinBtn.hidden = true;
      await afterSignIn();
    },
  });

  signinBtn.addEventListener('click', () => {
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
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

async function driveFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    accessToken = null;
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
