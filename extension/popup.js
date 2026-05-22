// SketchRip - Extension Popup Script

const urlInput = document.getElementById('url');
const loadBtn = document.getElementById('loadBtn');
const extractBtn = document.getElementById('extractBtn');
const formatSelect = document.getElementById('format');
const meshCount = document.getElementById('meshCount');
const triCount = document.getElementById('triCount');
const vertCount = document.getElementById('vertCount');
const texCount = document.getElementById('texCount');
const status = document.getElementById('status');

let lastResult = null;

// Load URL
loadBtn.addEventListener('click', () => {
  const url = urlInput.value.trim();
  if (!url) return;
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.update(tabs[0].id, { url: url }, () => {
        status.textContent = 'Loading...';
      });
    }
  });
});

// Extract model
extractBtn.addEventListener('click', async () => {
  extractBtn.disabled = true;
  status.textContent = 'Extracting...';
  
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tabs[0]?.id;
  
  if (!tabId) {
    status.textContent = 'Error: No active tab';
    extractBtn.disabled = false;
    return;
  }
  
  // Execute extraction via content script
  try {
    const result = await chrome.tabs.executeScript(tabId, {
      file: 'utils/extractor.js',
    });
    
    const extractResult = await chrome.tabs.executeScript(tabId, {
      file: 'utils/material.js',
    });
    
    const exportResult = await chrome.tabs.executeScript(tabId, {
      file: 'utils/exporter.js',
    });
    
    // Run the extraction
    const data = await chrome.tabs.executeScript(tabId, {
      func: () => window.__sketchrip_result__,
    });
    
    if (data && data[0]) {
      lastResult = data[0];
      updateInfo(data[0]);
      status.textContent = 'Extraction complete!';
    } else {
      // Try running extractor
      const runResult = await chrome.tabs.executeScript(tabId, {
        code: '(function(){ return extractModel(); })()',
      });
      
      if (runResult && runResult[0]) {
        lastResult = runResult[0];
        updateInfo(runResult[0]);
        status.textContent = 'Extraction complete!';
      } else {
        status.textContent = 'Failed to extract model data';
      }
    }
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
  
  extractBtn.disabled = false;
});

function updateInfo(result) {
  if (result.stats) {
    meshCount.textContent = result.stats.meshCount ?? '-';
    triCount.textContent = result.stats.triangles ?? '-';
    vertCount.textContent = result.stats.vertices ?? '-';
  }
  if (result.materials) {
    texCount.textContent = result.materials.length;
  }
}

// Keyboard shortcut
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadBtn.click();
});
