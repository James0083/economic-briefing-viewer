let tokenClient;
let accessToken = null;
let files = [];

const signinBtn = document.getElementById('signin-btn');
const userStatus = document.getElementById('user-status');
const layout = document.getElementById('layout');
const fileListEl = document.getElementById('file-list');
const placeholder = document.getElementById('content-placeholder');
const contentView = document.getElementById('content-view');
const errorBanner = document.getElementById('error-banner');

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
}

function clearError() {
  errorBanner.hidden = true;
}

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
    scope: CONFIG.DRIVE_SCOPE,
    callback: async (response) => {
      if (response.error) {
        showError('로그인에 실패했습니다: ' + response.error);
        return;
      }
      accessToken = response.access_token;
      clearError();
      signinBtn.hidden = true;
      userStatus.hidden = false;
      layout.hidden = false;
      await loadFileList();
    },
  });

  signinBtn.addEventListener('click', () => {
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

async function driveFetch(url) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) {
    accessToken = null;
    signinBtn.hidden = false;
    userStatus.hidden = true;
    layout.hidden = true;
    throw new Error('로그인이 만료되었습니다. 다시 로그인해주세요.');
  }
  if (!res.ok) {
    throw new Error(`요청 실패 (${res.status})`);
  }
  return res;
}

async function loadFileList() {
  fileListEl.innerHTML = '<p class="muted">불러오는 중...</p>';
  try {
    const q = encodeURIComponent(`'${CONFIG.FOLDER_ID}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=name desc&pageSize=200`;
    const res = await driveFetch(url);
    const data = await res.json();
    files = (data.files || []).filter((f) => f.name.toLowerCase().endsWith('.md'));
    renderFileList();
  } catch (err) {
    showError(err.message);
    fileListEl.innerHTML = '';
  }
}

function renderFileList() {
  if (files.length === 0) {
    fileListEl.innerHTML = '<p class="muted">표시할 .md 파일이 없습니다.</p>';
    return;
  }
  fileListEl.innerHTML = '';
  files.forEach((file) => {
    const item = document.createElement('button');
    item.className = 'file-item';
    item.textContent = formatFileLabel(file.name);
    item.addEventListener('click', () => openFile(file, item));
    fileListEl.appendChild(item);
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
