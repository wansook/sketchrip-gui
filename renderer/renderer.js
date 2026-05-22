const urlInput = document.getElementById('url');
const loadBtn = document.getElementById('load-btn');
const extractBtn = document.getElementById('extract-btn');
const formatSelect = document.getElementById('format');
const meshCount = document.getElementById('mesh-count');
const textureCount = document.getElementById('texture-count');
const polyCount = document.getElementById('poly-count');
const vertexCount = document.getElementById('vertex-count');
const progressBar = document.getElementById('progress-bar');
const progress = document.getElementById('progress');
const statusEl = document.getElementById('status');

let loaded = false;
let lastResult = null;

// Load Sketchfab URL
loadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

  // Validate URL
  if (!url.includes('sketchfab.com')) {
    statusEl.textContent = '⚠️ Sketchfab URL이 아닙니다';
    return;
  }

  loadBtn.textContent = '로딩 중...';
  loadBtn.disabled = true;
  progress.style.display = 'none';
  statusEl.textContent = '모델 로드 중...';

  try {
    const result = await window.sketchrip.loadUrl(url);

    if (result.ok) {
      loaded = true;
      extractBtn.disabled = false;
      statusEl.textContent = '✅ 로딩 완료';
    } else {
      statusEl.textContent = `❌ 로딩 실패: ${result.error}`;
    }
  } catch (err) {
    statusEl.textContent = `❌ 오류: ${err.message}`;
  }

  loadBtn.textContent = '로드';
  loadBtn.disabled = false;
});

// Extract model
extractBtn.addEventListener('click', async () => {
  statusEl.textContent = '🔍 추출 중...';
  progressBar.style.width = '30%';
  extractBtn.disabled = true;

  try {
    const result = await window.sketchrip.extractModel();
    progressBar.style.width = '80%';

    if (result.ok) {
      statusEl.textContent = '✅ 추출 완료!';
      progressBar.style.width = '100%';

      // Update info display
      if (result.stats) {
        meshCount.textContent = result.stats.meshCount ?? '-';
        polyCount.textContent = result.stats.triangles?.toLocaleString() ?? '-';
        vertexCount.textContent = result.stats.vertices?.toLocaleString() ?? '-';
      }
      if (result.textures) {
        textureCount.textContent = result.textures.length;
      }

      // Store result for export
      lastResult = result;
    } else {
      statusEl.textContent = `❌ 추출 실패: ${result.error}`;
    }
  } catch (err) {
    statusEl.textContent = `❌ 오류: ${err.message}`;
  }

  extractBtn.disabled = false;
});

// Export
const exportBtn = document.getElementById('export-btn');
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    if (!lastResult) {
      statusEl.textContent = '⚠️ 먼저 모델을 추출하세요';
      return;
    }

    const format = formatSelect.value;
    exportBtn.textContent = '저장 중...';
    exportBtn.disabled = true;
    statusEl.textContent = `${format.toUpperCase()} 저장 중...`;

    try {
      if (format === 'glb') {
        const result = await window.sketchrip.exportGLB(lastResult);
        if (result.ok) {
          statusEl.textContent = `✅ GLB 저장 완료: ${result.path}`;
        } else {
          statusEl.textContent = `❌ 저장 실패: ${result.error}`;
        }
      } else if (format === 'obj') {
        const result = await window.sketchrip.exportOBJ(lastResult);
        if (result.ok) {
          statusEl.textContent = `✅ OBJ 저장 완료: ${result.path}`;
        } else {
          statusEl.textContent = `❌ 저장 실패: ${result.error}`;
        }
      }
    } catch (err) {
      statusEl.textContent = `❌ 오류: ${err.message}`;
    }

    exportBtn.textContent = '내보내기';
    exportBtn.disabled = false;
  });
}

// Keyboard shortcut
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadBtn.click();
});

// Add export button dynamically (since it wasn't in the HTML)
const actionsDiv = document.querySelector('.actions');
if (actionsDiv) {
  const exportBtnEl = document.createElement('button');
  exportBtnEl.id = 'export-btn';
  exportBtnEl.textContent = '내보내기';
  exportBtnEl.style.background = '#0f3460';
  actionsDiv.insertBefore(exportBtnEl, actionsDiv.firstChild);
}
