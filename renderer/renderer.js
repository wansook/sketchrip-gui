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
const modelInfoDiv = document.getElementById('model-info');

let loaded = false;
let lastResult = null;

// Load Sketchfab URL
loadBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim();
  if (!url) return;

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

// Setup progress listener
window.sketchrip.onProgress((data) => {
  statusEl.textContent = data.status;
  progressBar.style.width = `${data.percent}%`;
});

// Extract model
extractBtn.addEventListener('click', async () => {
  statusEl.textContent = '🚀 Puppeteer 추출 시작...';
  progressBar.style.display = 'block';
  progressBar.style.width = '0%';
  extractBtn.disabled = true;

  // Get current URL from the mainWindow
  const currentUrl = await new Promise(resolve => {
    // We need to get the URL from Electron - use a different approach
    // For now, use the input URL
    resolve(urlInput.value.trim());
  });

  try {
    const result = await window.sketchrip.extractModel({
      url: currentUrl,
      outputDir: require('os').tmpdir() + '/sketchrip',
    });

    if (result.ok) {
      statusEl.textContent = `✅ 추출 완료! (${result.extractTime}ms)`;
      progressBar.style.width = '100%';

      if (result.stats) {
        meshCount.textContent = result.stats.meshes;
        polyCount.textContent = result.stats.triangles?.toLocaleString() ?? '-';
        vertexCount.textContent = result.stats.vertices?.toLocaleString() ?? '-';
        textureCount.textContent = result.textureFiles ?? '-';
      }

      lastResult = result;
    } else {
      statusEl.textContent = `❌ 추출 실패: ${result.error}`;
    }
  } catch (err) {
    statusEl.textContent = `❌ 오류: ${err.message}`;
  }

  extractBtn.disabled = false;
});

// Export button (added dynamically)
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
        const result = await window.sketchrip.exportGLB(lastResult.data);
        if (result.ok) {
          statusEl.textContent = `✅ GLB 저장 완료: ${result.path}`;
        } else {
          statusEl.textContent = `❌ 저장 실패: ${result.error}`;
        }
      } else if (format === 'obj') {
        const result = await window.sketchrip.exportOBJ(lastResult.data);
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

// Add export button dynamically
const actionsDiv = document.querySelector('.actions');
if (actionsDiv) {
  const exportBtnEl = document.createElement('button');
  exportBtnEl.id = 'export-btn';
  exportBtnEl.textContent = '내보내기';
  exportBtnEl.style.background = '#0f3460';
  exportBtnEl.disabled = true;
  actionsDiv.insertBefore(exportBtnEl, actionsDiv.firstChild);

  // Update reference
  exportBtnEl.addEventListener('click', () => {
    if (!lastResult) {
      statusEl.textContent = '⚠️ 먼저 모델을 추출하세요';
      return;
    }

    const format = formatSelect.value;
    exportBtnEl.textContent = '저장 중...';
    exportBtnEl.disabled = true;
    statusEl.textContent = `${format.toUpperCase()} 저장 중...`;

    if (format === 'glb') {
      window.sketchrip.exportGLB(lastResult.data).then(result => {
        if (result.ok) {
          statusEl.textContent = `✅ GLB 저장 완료`;
        } else {
          statusEl.textContent = `❌ 저장 실패: ${result.error}`;
        }
        exportBtnEl.textContent = '내보내기';
        exportBtnEl.disabled = false;
      });
    } else if (format === 'obj') {
      window.sketchrip.exportOBJ(lastResult.data).then(result => {
        if (result.ok) {
          statusEl.textContent = `✅ OBJ 저장 완료`;
        } else {
          statusEl.textContent = `❌ 저장 실패: ${result.error}`;
        }
        exportBtnEl.textContent = '내보내기';
        exportBtnEl.disabled = false;
      });
    }
  });
  actionsDiv.insertBefore(exportBtnEl, actionsDiv.firstChild);
}
