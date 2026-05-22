const urlInput = document.getElementById('url');
const loadBtn = document.getElementById('load-btn');
const extractBtn = document.getElementById('extract-btn');
const formatSelect = document.getElementById('format');
const webview = document.getElementById('sketchfab-viewer');
const placeholder = document.getElementById('preview-placeholder');
const meshCount = document.getElementById('mesh-count');
const textureCount = document.getElementById('texture-count');
const polyCount = document.getElementById('poly-count');
const vertexCount = document.getElementById('vertex-count');
const progressBar = document.getElementById('progress-bar');
const statusEl = document.getElementById('status');

let loaded = false;

loadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  loadBtn.textContent = '로딩 중...';
  loadBtn.disabled = true;

  const result = await window.sketchrip.loadUrl(url);

  if (result.ok) {
    placeholder.style.display = 'none';
    webview.style.display = 'block';
    extractBtn.disabled = false;
    statusEl.textContent = '로딩 완료';
  } else {
    statusEl.textContent = `로딩 실패: ${result.error}`;
  }

  loadBtn.textContent = '로드';
  loadBtn.disabled = false;
});

extractBtn.addEventListener('click', async () => {
  statusEl.textContent = '추출 시작...';
  progressBar.style.display = 'block';
  progressBar.style.width = '0%';
  extractBtn.disabled = true;

  const format = formatSelect.value;
  const result = await window.sketchrip.extractModel();

  if (result.ok) {
    statusEl.textContent = '추출 완료!';
    if (result.meshes) meshCount.textContent = result.meshes;
    if (result.textures) textureCount.textContent = result.textures;
  } else {
    statusEl.textContent = `추출 실패: ${result.error}`;
  }

  extractBtn.disabled = false;
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadBtn.click();
});
