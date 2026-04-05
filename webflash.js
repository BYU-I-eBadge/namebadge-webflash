import { ESPLoader, Transport } from "https://unpkg.com/esptool-js/bundle.js";

if (window.__NB_WEBFLASH_LOADED__) {
  console.log('[DEBUG] webflash.js loaded more than once!');
  throw new Error('webflash.js loaded more than once!');
}
window.__NB_WEBFLASH_LOADED__ = true;


const manifestUrl = 'https://raw.githubusercontent.com/watsonlr/namebadge-apps/main/bootloader_downloads/loader_manifest.json';
const programManifestUrl = 'https://raw.githubusercontent.com/watsonlr/namebadge-apps/main/manifest.json';

// ESP32-S3: second-stage bootloader at 0x0, factory app partition at 0x20000
const BOOTLOADER_FLASH_ADDR = 0x0;
const APP_FLASH_ADDR = 0x20000;

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


async function performFlash(binary, address, label) {
  const terminal = {
    clean() {},
    writeLine(data) { statusDiv.textContent = data; console.log('[ESP]', data); },
    write(data) { statusDiv.textContent = data; },
  };

  let transport = null;
  try {
    statusDiv.textContent = 'Select the serial port for your badge...';
    const port = await navigator.serial.requestPort();
    transport = new Transport(port, false);

    const esploader = new ESPLoader({ transport, baudrate: 460800, terminal });

    statusDiv.textContent = 'Connecting to chip...';
    const chipName = await esploader.main();
    statusDiv.textContent = `Connected to ${chipName}. Starting flash...`;

    await esploader.writeFlash({
      fileArray: [{ data: new Uint8Array(binary), address }],
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_idx, written, total) => {
        const pct = Math.round((written / total) * 100);
        statusDiv.textContent = `Flashing ${label}: ${pct}% (${written} / ${total} bytes)`;
      },
    });

    statusDiv.textContent = 'Flashing done. Resetting device...';
    await esploader.after('hard_reset');
    statusDiv.textContent = `${label} flashed successfully! Device is resetting.`;
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
    // Pre-load first program
    if (programList.length > 0 && programList[0].url) {
      await fetchProgramBinary(programList[0].url);
    } else {
      programFlashBtn.disabled = false;
    }
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
  if (!programBinary) {
    statusDiv.textContent = 'Program not loaded. Select a program above.';
    return;
  }
  const idx = parseInt(programSelect.value, 10);
  const label = programList[idx]?.name || 'Program';
  programFlashBtn.disabled = true;
  flashBtn.disabled = true;
  try {
    await performFlash(programBinary, APP_FLASH_ADDR, label);
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
    await performFlash(bootloaderBinary, BOOTLOADER_FLASH_ADDR, label);
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
