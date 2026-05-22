// SketchRip - Extension Background (Service Worker)
// Manages extension lifecycle and communicates with Electron

const MANIFEST_VERSION = 3;

// Track active model extraction state
let activeModel = null;

// Listen for messages from Electron (via devtools protocol)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'START_EXTRACTION':
      return handleExtraction(message, sendResponse);
    case 'STOP_EXTRACTION':
      handleStopExtraction();
      sendResponse({ ok: true });
      break;
    case 'GET_STATUS':
      sendResponse({ model: activeModel, isExtracting: !!activeModel });
      break;
    default:
      sendResponse({ error: `Unknown message: ${message.type}` });
  }
  return true; // Keep channel open for async response
});

async function handleExtraction(message, sendResponse) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) {
      sendResponse({ ok: false, error: 'No active tab' });
      return;
    }

    const tabId = tabs[0].id;
    const url = tabs[0].url;

    // Check if we're on Sketchfab
    if (!url || !url.includes('sketchfab.com')) {
      sendResponse({ ok: false, error: 'Not a Sketchfab page' });
      return;
    }

    activeModel = {
      url: url,
      tabId: tabId,
      startTime: Date.now(),
      meshes: [],
      textures: [],
      materials: [],
    };

    // Inject extraction script into the tab
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        'utils/extractor.js',
        'utils/material.js',
        'utils/exporter.js',
      ],
    });

    // Run the extraction
    const result = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: extractFromPage,
    });

    activeModel.result = result[0].result;
    sendResponse({ ok: true, data: result[0].result });

  } catch (err) {
    activeModel = null;
    sendResponse({ ok: false, error: err.message });
  }
}

function handleStopExtraction() {
  activeModel = null;
}

// The extraction function runs in the page context
function extractFromPage() {
  // This function runs as a content script in the Sketchfab page
  // It will be defined in content.js
  return { error: 'Extraction not initialized' };
}
