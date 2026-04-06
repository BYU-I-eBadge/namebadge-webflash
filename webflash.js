import { ESPLoader, Transport } from "https://unpkg.com/esptool-js/bundle.js";

if (window.__NB_WEBFLASH_LOADED__) {
  console.log('[DEBUG] webflash.js loaded more than once!');
  throw new Error('webflash.js loaded more than once!');
}
window.__NB_WEBFLASH_LOADED__ = true;


const manifestUrl = 'https://byu-i-ebadge.github.io/apps/loader_manifest.json';
const programManifestUrl = 'https://byu-i-ebadge.github.io/apps/manifest.json';

// Flash layout (from partitions.csv):
//   0x1000  second-stage bootloader (factory_switch hook)
//   0x8000  partition table
//   0xF000  otadata  – OTA boot selector, 2 × 4 KB sectors
//   0x20000 factory  – badge loader OS or bare-metal app (1.25 MB)
//   0x160000 ota_0   – student app slot A
//   0x2A0000 ota_1   – student app slot B
//   0x3E0000 user_data – WiFi config / badge nickname (never touched here)
const FACTORY_ADDR   = 0x20000;
const OTADATA_ADDR   = 0xF000;
const OTADATA_SIZE   = 0x2000; // 8 KB (2 × 4 KB sectors)

let bootloaderList = [];
let bootloaderBinary = null;
let programList = [];
let programBinary = null;


const statusDiv      = document.getElementById('status');
const progressWrap   = document.getElementById('progressWrap');
const progressFill   = document.getElementById('progressFill');
const progressLabel  = document.getElementById('progressLabel');
const resetPrompt    = document.getElementById('resetPrompt');
const bootloaderSelect = document.getElementById('bootloaderSelect');
const flashBtn       = document.getElementById('flashBtn');
const programSelect  = document.getElementById('programSelect');
const programFlashBtn = document.getElementById('programFlashBtn');
const mainContent    = document.getElementById('mainContent');
const unsupportedMsg = document.getElementById('unsupportedMsg');
const browserNameMsg = document.getElementById('browserNameMsg');

function setProgress(pct, label) {
  progressWrap.style.display = '';
  progressFill.style.width = pct + '%';
  progressLabel.textContent = label;
}

function hideProgress() {
  progressWrap.style.display = 'none';
  progressFill.style.width = '0%';
  progressLabel.textContent = '';
}


function isSupportedBrowser() {
  if (!('serial' in navigator)) {
    console.log('[DEBUG] Web Serial API not found in navigator.');
    return false;
  }
  const ua = navigator.userAgent;
  console.log('[DEBUG] User agent:', ua);
  if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
    console.log('[DEBUG] Detected Brave browser.');
    return false;
  }
  if (ua.includes('Firefox')) {
    console.log('[DEBUG] Detected Firefox.');
    return false;
  }
  if (ua.includes('OPR/') || ua.includes('Opera')) {
    console.log('[DEBUG] Detected Opera.');
    return false;
  }
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


async function performFlash(binary, label) {
  let flashing = false;
  const terminal = {
    clean() {},
    writeLine(data) { if (!flashing) statusDiv.textContent = data; console.log('[ESP]', data); },
    write(data)     { if (!flashing) statusDiv.textContent = data; },
  };

  let transport = null;
  let resetPromptTimer = null;
  try {
    statusDiv.textContent = 'Select the serial port for your badge...';
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, false);

    const esploader = new ESPLoader({ transport, baudrate: 460800, terminal });

    statusDiv.textContent = 'Connecting to chip...';

    // If sync takes more than 8 s, prompt the user to enter download mode
    resetPromptTimer = setTimeout(() => {
      resetPrompt.style.display = '';
      statusDiv.textContent = 'Waiting for badge to enter download mode...';
    }, 8000);

    const chipName = await esploader.main();
    clearTimeout(resetPromptTimer);
    resetPrompt.style.display = 'none';
    statusDiv.textContent = `Connected to ${chipName}. Starting flash...`;

    // Clear otadata so the device boots the newly flashed factory image immediately,
    // rather than resuming a previously installed OTA student app.
    const blankOtadata = new Uint8Array(OTADATA_SIZE).fill(0xFF);

    flashing = true;
    setProgress(0, 'Starting...');
    await esploader.writeFlash({
      fileArray: [
        { data: new Uint8Array(binary), address: FACTORY_ADDR },
        { data: blankOtadata,           address: OTADATA_ADDR },
      ],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        console.log('[PROGRESS]', fileIndex, written, total);
        if (!total || fileIndex > 0) return; // only track the main binary (index 0)
        const pct = Math.min(100, Math.round((written / total) * 100));
        const filled = Math.round(pct / 5);  // 20 chars wide
        const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
        statusDiv.textContent = `[${bar}] ${pct}%`;
        setProgress(pct, `${written.toLocaleString()} / ${total.toLocaleString()} bytes`);
      },
    });

    setProgress(100, 'Done!');
    resetPrompt.style.display = 'none';
    statusDiv.textContent = 'Flashing done. Resetting device...';
    await esploader.after('hard_reset');
    statusDiv.innerHTML = `${label} flashed successfully!<br><small>If your program didn't start automatically, press the <b>RESET</b> button.</small>`;
    setTimeout(hideProgress, 3000);
  } catch (e) {
    hideProgress();
    clearTimeout(resetPromptTimer);
    resetPrompt.style.display = 'none';
    throw e;
  } finally {
    if (transport) {
      try { await transport.disconnect(); } catch (_) {}
    }
  }
}


async function fetchProgramManifest() {
  if (!programSelect) return;
  programSelect.innerHTML = '<option>Loading...</option>';
  programSelect.disabled = true;
  programFlashBtn.disabled = true;
  try {
    const resp = await fetch(programManifestUrl);
    if (!resp.ok) throw new Error('Failed to fetch program manifest');
    const manifest = await resp.json();
    if (Array.isArray(manifest)) {
      programList = manifest;
    } else if (manifest && Array.isArray(manifest.apps)) {
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
    opt.textContent = entry.name || entry.title || entry.url || `Program ${idx + 1}`;
    if (idx === 0) opt.selected = true;
    programSelect.appendChild(opt);
  });
}

async function fetchProgramBinary(url) {
  statusDiv.textContent = 'Downloading program binary...';
  programFlashBtn.disabled = true;
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

programSelect?.addEventListener('change', async () => {
  const idx = parseInt(programSelect.value, 10);
  const entry = programList[idx];
  if (entry && entry.url) {
    await fetchProgramBinary(entry.url);
  }
});

programFlashBtn?.addEventListener('click', async () => {
  const idx = parseInt(programSelect.value, 10);
  const entry = programList[idx];
  const label = entry?.name || 'Program';
  programFlashBtn.disabled = true;
  flashBtn.disabled = true;
  try {
    if (!programBinary && entry?.url) {
      await fetchProgramBinary(entry.url);
    }
    if (!programBinary) {
      statusDiv.textContent = 'Failed to load program binary.';
      return;
    }
    await performFlash(programBinary, label);
  } catch (e) {
    statusDiv.textContent = 'Flash error: ' + (e.message || e);
    console.error('[Flash error]', e);
  } finally {
    programFlashBtn.disabled = false;
    flashBtn.disabled = false;
  }
});


function showBrowserStatus() {
  console.log('[DEBUG] showBrowserStatus() called');
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
    manifest = manifest.slice().reverse();
    bootloaderList = manifest;
    populateBootloaderDropdown();
    bootloaderSelect.disabled = false;
    flashBtn.disabled = false;
    await fetchBootloaderBinary(bootloaderList[0].binary_url);
  } catch (e) {
    console.log('[DEBUG] Error in fetchManifest:', e);
    statusDiv.textContent = 'Error fetching manifest: ' + e;
    bootloaderSelect.disabled = true;
    flashBtn.disabled = true;
  }
}

function populateBootloaderDropdown() {
  bootloaderSelect.innerHTML = '';
  bootloaderList.forEach((entry, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${entry.loader_version}`;
    if (idx === 0) opt.selected = true;
    bootloaderSelect.appendChild(opt);
  });
}

async function fetchBootloaderBinary(url) {
  statusDiv.textContent = 'Downloading bootloader binary...';
  flashBtn.disabled = true;
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

bootloaderSelect.addEventListener('change', async () => {
  const idx = parseInt(bootloaderSelect.value, 10);
  const entry = bootloaderList[idx];
  await fetchBootloaderBinary(entry.binary_url);
});

flashBtn.addEventListener('click', async () => {
  if (!bootloaderBinary) {
    statusDiv.textContent = 'Bootloader not loaded. Select a version above.';
    return;
  }
  const idx = parseInt(bootloaderSelect.value, 10);
  const label = `Bootloader v${bootloaderList[idx]?.loader_version ?? ''}`;
  flashBtn.disabled = true;
  programFlashBtn.disabled = true;
  try {
    await performFlash(bootloaderBinary, label);
  } catch (e) {
    statusDiv.textContent = 'Flash error: ' + (e.message || e);
    console.error('[Flash error]', e);
  } finally {
    flashBtn.disabled = false;
    programFlashBtn.disabled = false;
  }
});

console.log('[DEBUG] Global: calling showBrowserStatus()');
showBrowserStatus();
