if (window.__NB_WEBFLASH_LOADED__) {
  console.log('[DEBUG] webflash.js loaded more than once!');
  throw new Error('webflash.js loaded more than once!');
}
window.__NB_WEBFLASH_LOADED__ = true;


const manifestUrl = 'https://raw.githubusercontent.com/watsonlr/namebadge-apps/main/bootloader_downloads/loader_manifest.json';
const programManifestUrl = 'https://raw.githubusercontent.com/watsonlr/namebadge-apps/main/manifest.json';
let bootloaderList = [];
let bootloaderBinary = null;
let programList = [];
let programBinary = null;


const statusDiv = document.getElementById('status');
const bootloaderSelect = document.getElementById('bootloaderSelect');
const flashBtn = document.getElementById('flashBtn');
const programSelect = document.getElementById('programSelect');
const programFlashBtn = document.getElementById('programFlashBtn');
const mainContent = document.getElementById('mainContent');
const unsupportedMsg = document.getElementById('unsupportedMsg');
const browserNameMsg = document.getElementById('browserNameMsg');


function isSupportedBrowser() {
  // Must have Web Serial API
  if (!('serial' in navigator)) {
    console.log('[DEBUG] Web Serial API not found in navigator.');
    return false;
  }
  const ua = navigator.userAgent;
  console.log('[DEBUG] User agent:', ua);
  // Detect Brave using navigator.brave if available
  if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
    console.log('[DEBUG] Detected Brave browser.');
    return false;
  }
  // Exclude Firefox
  if (ua.includes('Firefox')) {
    console.log('[DEBUG] Detected Firefox.');
    return false;
  }
  // Exclude Opera
  if (ua.includes('OPR/') || ua.includes('Opera')) {
    console.log('[DEBUG] Detected Opera.');
    return false;
  }
  // Accept Edge, Chrome, Chromium (Edge must be checked before Chrome)
  if (ua.includes('Edg/')) {
    console.log('[DEBUG] Detected Edge.');
    return true;
  }
  if (ua.includes('Chrome/')) {
    console.log('[DEBUG] Detected Chrome.');
    return true;
  }
  if (ua.includes('Chromium/')) {
    console.log('[DEBUG] Detected Chromium.');
    return true;
  }
  // Exclude Safari ONLY if not Chrome, Edge, Chromium, Opera, or Brave
  if (
    ua.includes('Safari') &&
    !ua.includes('Chrome') &&
    !ua.includes('Edg') &&
    !ua.includes('Chromium') &&
    !ua.includes('OPR') &&
    !ua.includes('Brave')
  ) {
    console.log('[DEBUG] Detected Safari (standalone).');
    return false;
  }
  console.log('[DEBUG] Browser not recognized as supported.');
  return false;
}


function getBrowserName() {
  const ua = navigator.userAgent;
  if (navigator.brave && typeof navigator.brave.isBrave === 'function') return 'Brave';
  if (ua.includes('Edg/')) return 'Microsoft Edge';
  if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
  if (ua.includes('Chrome/')) return 'Google Chrome';
  if (ua.includes('Chromium/')) return 'Chromium';
  if (ua.includes('Firefox/')) return 'Mozilla Firefox';
  if (ua.includes('Safari/')) return 'Safari';
  return 'Unknown';
}

async function fetchProgramManifest() {
  if (!programSelect) return;
  programSelect.innerHTML = '<option>Loading...</option>';
  programSelect.disabled = true;
  programFlashBtn.disabled = true;
  try {
    const resp = await fetch(programManifestUrl);
    if (!resp.ok) throw new Error('Failed to fetch program manifest');
    let manifest = await resp.json();
    if (manifest && Array.isArray(manifest.apps)) {
      programList = manifest.apps;
    } else {
      programList = [];
    }
    populateProgramDropdown();
    programSelect.disabled = false;
    programFlashBtn.disabled = false;
  } catch (e) {
    programSelect.innerHTML = '<option>Error loading programs</option>';
    programSelect.disabled = true;
    programFlashBtn.disabled = true;
    console.log('[DEBUG] Error in fetchProgramManifest:', e);
  }
}

function populateProgramDropdown() {
  programSelect.innerHTML = '';
  programList.forEach((entry, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = entry.name || entry.title || entry.binary_url || `Program ${idx+1}`;
    if (idx === 0) opt.selected = true;
    programSelect.appendChild(opt);
  });
}

async function fetchProgramBinary(url) {
  statusDiv.textContent = 'Downloading program binary...';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch program binary');
    programBinary = await resp.arrayBuffer();
    statusDiv.textContent = `Ready to flash program (${programBinary.byteLength} bytes)`;
    programFlashBtn.disabled = false;
  } catch (e) {
    statusDiv.textContent = 'Error downloading program: ' + e;
    programBinary = null;
    programFlashBtn.disabled = true;
  }
}

programSelect?.addEventListener('change', async (e) => {
  const idx = parseInt(programSelect.value, 10);
  const entry = programList[idx];
  programFlashBtn.disabled = true;
  if (entry && entry.binary_url) {
    await fetchProgramBinary(entry.binary_url);
  }
});

programFlashBtn?.addEventListener('click', async () => {
  if (!programBinary) {
    statusDiv.textContent = 'Program not loaded. Select a program above.';
    return;
  }
  if (!('serial' in navigator)) {
    statusDiv.textContent = 'Web Serial API not supported in this browser.';
    return;
  }
  try {
    statusDiv.textContent = 'Requesting serial port...';
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    statusDiv.textContent = 'Serial port opened. (Flashing not implemented yet)';
    // For now, just print to console
    console.log('Program binary ready to flash:', programBinary);
    await port.close();
    statusDiv.textContent = 'Serial port closed.';
  } catch (e) {
    statusDiv.textContent = 'Serial error: ' + e;
  }
});

function showBrowserStatus() {
  console.log('[DEBUG] showBrowserStatus() called');
  console.trace('[DEBUG] showBrowserStatus stack trace');
  const browserName = getBrowserName();
  if (isSupportedBrowser()) {
    console.log('[DEBUG] showBrowserStatus: supported browser, showing mainContent');
    mainContent.style.display = '';
    unsupportedMsg.style.display = 'none';
    statusDiv.textContent = `Good -- Your Browser (${browserName}) can be used to flash your board.`;
    bootloaderSelect.disabled = false;
    flashBtn.disabled = false;
    fetchManifest();
    fetchProgramManifest();
  } else {
    console.log('[DEBUG] showBrowserStatus: unsupported browser, showing unsupportedMsg');
    mainContent.style.display = 'none';
    unsupportedMsg.style.display = '';
    if (browserNameMsg) {
      browserNameMsg.innerHTML = `This browser (<b>${browserName}</b>) is not supported for flashing your Namebadge.`;
    }
  }
}

async function fetchManifest() {
  statusDiv.textContent = 'Fetching manifest...';
  try {
    const resp = await fetch(manifestUrl);
    if (!resp.ok) throw new Error('Failed to fetch manifest');
    let manifest = await resp.json();
    // Reverse order: latest first
    manifest = manifest.slice().reverse();
    bootloaderList = manifest;
    populateBootloaderDropdown();
    bootloaderSelect.disabled = false;
    flashBtn.disabled = false;
    // Preload the latest
    await fetchBootloaderBinary(bootloaderList[0].binary_url);
  } catch (e) {
    console.log('[DEBUG] Error in fetchManifest:', e);
    statusDiv.textContent = 'Error fetching manifest: ' + e;
    bootloaderSelect.disabled = true;
    flashBtn.disabled = true;
    // Do NOT hide mainContent or show unsupportedMsg here!
  }
}

function populateBootloaderDropdown() {
  bootloaderSelect.innerHTML = '';
  bootloaderList.forEach((entry, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${entry.loader_version}`;
    if (idx === 0) opt.selected = true; // highlight most recent
    bootloaderSelect.appendChild(opt);
  });
}

async function fetchBootloaderBinary(url) {
  statusDiv.textContent = 'Downloading bootloader binary...';
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch bootloader binary');
    bootloaderBinary = await resp.arrayBuffer();
    statusDiv.textContent = `Ready to flash bootloader (${bootloaderBinary.byteLength} bytes)`;
    flashBtn.disabled = false;
  } catch (e) {
    statusDiv.textContent = 'Error downloading bootloader: ' + e;
    bootloaderBinary = null;
    flashBtn.disabled = true;
  }
}

bootloaderSelect.addEventListener('change', async (e) => {
  const idx = parseInt(bootloaderSelect.value, 10);
  const entry = bootloaderList[idx];
  flashBtn.disabled = true;
  await fetchBootloaderBinary(entry.binary_url);
});

flashBtn.addEventListener('click', async () => {
  if (!bootloaderBinary) {
    statusDiv.textContent = 'Bootloader not loaded. Select a version above.';
    return;
  }
  if (!('serial' in navigator)) {
    statusDiv.textContent = 'Web Serial API not supported in this browser.';
    return;
  }
  try {
    statusDiv.textContent = 'Requesting serial port...';
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    statusDiv.textContent = 'Serial port opened. (Flashing not implemented yet)';
    // For now, just print to console
    console.log('Bootloader binary ready to flash:', bootloaderBinary);
    await port.close();
    statusDiv.textContent = 'Serial port closed.';
  } catch (e) {
    statusDiv.textContent = 'Serial error: ' + e;
  }
});

console.log('[DEBUG] Global: calling showBrowserStatus()');
showBrowserStatus();
