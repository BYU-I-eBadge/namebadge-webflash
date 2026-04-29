import { ESPLoader, Transport } from "https://unpkg.com/esptool-js/bundle.js";

if (window.__NB_WEBFLASH_LOADED__) {
  console.log('[DEBUG] webflash.js loaded more than once!');
  throw new Error('webflash.js loaded more than once!');
}
window.__NB_WEBFLASH_LOADED__ = true;


const manifestUrl = 'https://byu-i-ebadge.github.io/bootloader_downloads/loader_manifest.json';
const programManifestUrl = 'https://byu-i-ebadge.github.io/apps/manifest.json';

// Badge OS (OTA) flash layout — partitions.csv in BYUI-Namebadge4-OTA:
//   0x1000   second-stage bootloader (factory_switch hook)
//   0x8000   partition table
//   0xF000   otadata  – OTA boot selector, 2 × 4 KB sectors
//   0x20000  factory  – badge loader OS (1.25 MB)
//   0x160000 ota_0   – student app slot A
//   0x2A0000 ota_1   – student app slot B
//   0x3E0000 user_data – WiFi config / badge nickname
//
// Bare-metal single-program layout — partitions.csv in each program repo:
//   0x1000   second-stage bootloader
//   0x8000   partition table (simple, no OTA)
//   0x10000  factory app (fills remaining flash)
//
// Both layouts are fully described by the manifest's binaries[] array.
// The web flasher writes exactly what the manifest says; no hardcoded addresses.
const OTADATA_ADDR   = 0xF000;
const OTADATA_SIZE   = 0x2000;   // 8 KB (2 × 4 KB sectors)
const USER_DATA_ADDR = 0x3E0000;
const USER_DATA_SIZE = 0x20000;  // 128 KB

let bootloaderList = [];
let bootloaderEntries = null;  // [{binary: ArrayBuffer, address: number}, ...]
let programList = [];
let programEntries = null;     // [{binary: ArrayBuffer, address: number}, ...]


const keepUserDataCheckbox = document.getElementById('keepUserData');
const statusDiv       = document.getElementById('status');
const progressWrap    = document.getElementById('progressWrap');
const progressFill    = document.getElementById('progressFill');
const progressLabel   = document.getElementById('progressLabel');
const resetPrompt     = document.getElementById('resetPrompt');
const troubleshootDiv = document.getElementById('troubleshoot');
const bootloaderSelect = document.getElementById('bootloaderSelect');
const flashBtn        = document.getElementById('flashBtn');
const programSelect   = document.getElementById('programSelect');
const programFlashBtn = document.getElementById('programFlashBtn');
const mainContent     = document.getElementById('mainContent');
const unsupportedMsg  = document.getElementById('unsupportedMsg');
const browserNameMsg  = document.getElementById('browserNameMsg');

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


function getOS() {
  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Mac'))     return 'mac';
  if (ua.includes('Linux'))   return 'linux';
  return 'unknown';
}

function showConnectionTroubleshoot() {
  const os = getOS();
  const tips = {
    linux: `<b>Linux setup required</b> — run these commands in a terminal, then unplug and replug the badge:
<pre style="background:#f5f5f5;padding:0.7em;border-radius:6px;overflow-x:auto;font-size:0.9em;">sudo usermod -aG dialout $USER   # then log out and back in
sudo systemctl stop ModemManager
sudo tee /etc/udev/rules.d/99-no-brltty-cp210x.rules &lt;&lt;'EOF'
ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", ENV{ID_BRLTTY_DEVICE_IGNORE}="1"
EOF
sudo udevadm control --reload-rules
# Then unplug and replug the badge — the rules only apply to new connections</pre>`,
    windows: `<b>Windows troubleshooting:</b><ul style="margin:0.5em 0 0 0">
<li>Install the <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank">CP210x USB driver from Silicon Labs</a> if the port doesn't appear.</li>
<li>Select the correct COM port in the picker (look for "CP2102N").</li>
<li>Try a different USB cable — charge-only cables won't work.</li>
</ul>`,
    mac: `<b>Mac troubleshooting:</b><ul style="margin:0.5em 0 0 0">
<li>Try a different USB cable — charge-only cables won't work.</li>
<li>If no port appears, install the <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank">CP210x driver from Silicon Labs</a>.</li>
<li>If macOS blocks the driver, go to System Settings &rarr; Privacy &amp; Security and allow it.</li>
</ul>`,
    unknown: `<b>Troubleshooting:</b><ul style="margin:0.5em 0 0 0">
<li>Try a different USB cable — charge-only cables won't work.</li>
<li>Make sure you selected the CP2102N port in the picker.</li>
</ul>`,
  };
  const common = `<p style="margin:0.8em 0 0 0">Also try entering download mode <em>before</em> clicking Flash: hold <b>BOOT</b> &rarr; press &amp; release <b>RESET</b> &rarr; release <b>BOOT</b>.</p>`;
  troubleshootDiv.innerHTML = (tips[os] ?? tips.unknown) + common;
  troubleshootDiv.style.display = '';
}

function hideTroubleshoot() {
  troubleshootDiv.style.display = 'none';
  troubleshootDiv.innerHTML = '';
}


// Fetch all binaries described by a manifest entry.
//
// New format:  entry.binaries = [{url, address}, ...]  — one fetch per region
// Legacy format: entry.binary_url + optional entry.address  — single binary
//
// Returns [{binary: ArrayBuffer, address: number}, ...]
async function fetchEntriesBinaries(manifestEntry, label) {
  // binaries[]  — new multi-region format
  // binary_url  — legacy bootloader manifest (single binary, goes at 0x20000)
  // url         — legacy program manifest    (single binary, goes at 0x10000)
  const sources = manifestEntry.binaries
    ?? (manifestEntry.binary_url
        ? [{ url: manifestEntry.binary_url, address: manifestEntry.address ?? 0x20000 }]
        : [{ url: manifestEntry.url,        address: manifestEntry.address ?? 0x10000 }]);

  statusDiv.textContent = `Downloading ${label}...`;
  const entries = [];
  for (const src of sources) {
    const resp = await fetch(src.url);
    if (!resp.ok) throw new Error(`Failed to fetch ${src.url}`);
    entries.push({ binary: await resp.arrayBuffer(), address: src.address });
  }
  return entries;
}


// fileEntries:  [{binary: ArrayBuffer, address: number}, ...]
// clearOtadata: true for badge OS flash — clears OTA selector so factory boots
//               false for bare-metal programs — they have their own partition table
async function performFlash(fileEntries, label, { eraseUserData = false, clearOtadata = false, successMessage = null } = {}) {
  hideTroubleshoot();
  let flashing = false;
  const terminal = {
    clean() {},
    writeLine(data) { console.log('[ESP]', data); },
    write(data)     { if (data && data.trim()) console.log('[TRACE]', JSON.stringify(data)); },
  };

  let transport = null;
  try {
    statusDiv.textContent = 'Select the serial port for your badge...';
    const port = await navigator.serial.requestPort();
    const info = port.getInfo?.() ?? {};
    console.log('[DEBUG] Port selected:', JSON.stringify(info));

    console.log('[DEBUG] Creating transport (tracing enabled)...');
    transport = new Transport(port, true);

    console.log('[DEBUG] Creating ESPLoader (baudrate=460800)...');
    const esploader = new ESPLoader({ transport, baudrate: 460800, terminal });

    // Show download mode prompt immediately — esptool times out before any delayed prompt fires
    resetPrompt.style.display = '';
    statusDiv.textContent = 'Enter download mode, then connecting to chip...';
    console.log('[DEBUG] Calling esploader.main() — waiting for chip sync...');

    const chipName = await esploader.main();
    resetPrompt.style.display = 'none';
    statusDiv.textContent = `Connected to ${chipName}. Starting flash...`;

    const fileArray = fileEntries.map(e => ({ data: new Uint8Array(e.binary), address: e.address }));
    if (clearOtadata) {
      fileArray.push({ data: new Uint8Array(OTADATA_SIZE).fill(0xFF), address: OTADATA_ADDR });
    }
    if (eraseUserData) {
      fileArray.push({ data: new Uint8Array(USER_DATA_SIZE).fill(0xFF), address: USER_DATA_ADDR });
    }

    const fileSizes = fileEntries.map(e => e.binary.byteLength);
    const totalFlashBytes = fileSizes.reduce((a, b) => a + b, 0);
    // completedBytes[i] tracks scaled progress for file i: we scale compressed
    // written/total back to the original file size so the bar shows 0-100%.
    const completedBytes = new Array(fileEntries.length).fill(0);

    flashing = true;
    setProgress(0, 'Starting...');
    await esploader.writeFlash({
      fileArray,
      flashMode: 'keep',
      flashFreq: 'keep',
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        console.log('[PROGRESS]', fileIndex, written, total);
        if (fileIndex < completedBytes.length && total > 0) {
          completedBytes[fileIndex] = fileSizes[fileIndex] * (written / total);
        }
        const totalWritten = completedBytes.reduce((a, b) => a + b, 0);
        const pct = Math.min(100, Math.round(totalWritten / totalFlashBytes * 100));
        const filled = Math.round(pct / 5);
        statusDiv.textContent = `[${'█'.repeat(filled)}${'░'.repeat(20 - filled)}] ${pct}%`;
        setProgress(pct, `${Math.round(totalWritten).toLocaleString()} / ${totalFlashBytes.toLocaleString()} bytes`);
      },
    });

    setProgress(100, 'Done!');
    resetPrompt.style.display = 'none';
    statusDiv.textContent = 'Flashing done. Resetting device...';
    await esploader.after('hard_reset');
    statusDiv.innerHTML = successMessage
      ?? `${label} flashed successfully!<br><small>If your program didn't start automatically,<br>press the <b>RESET</b> button.</small>`;
    setTimeout(hideProgress, 3000);
  } catch (e) {
    hideProgress();
    resetPrompt.style.display = 'none';
    console.log('[DEBUG] performFlash caught error:', e);
    console.log('[DEBUG] error.name:', e?.name, 'error.message:', e?.message, 'error.cause:', e?.cause);
    throw e;
  } finally {
    if (transport) {
      try { await transport.disconnect(); } catch (_) {}
    }
  }
}


// === Single Program Flash ===

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
    if (programList.length > 0) {
      await fetchProgramEntries(programList[0]);
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
    opt.textContent = entry.name || entry.title || `Program ${idx + 1}`;
    if (idx === 0) opt.selected = true;
    programSelect.appendChild(opt);
  });
}

async function fetchProgramEntries(entry) {
  programFlashBtn.disabled = true;
  programEntries = null;
  try {
    programEntries = await fetchEntriesBinaries(entry, entry.name || 'program');
    const totalBytes = programEntries.reduce((sum, e) => sum + e.binary.byteLength, 0);
    statusDiv.textContent = `Ready to flash ${entry.name || 'program'} (${totalBytes.toLocaleString()} bytes)`;
    programFlashBtn.disabled = false;
  } catch (e) {
    statusDiv.textContent = 'Error downloading program: ' + e;
    programEntries = null;
    programFlashBtn.disabled = true;
  }
}

programSelect?.addEventListener('change', async () => {
  const idx = parseInt(programSelect.value, 10);
  await fetchProgramEntries(programList[idx]);
});

programFlashBtn?.addEventListener('click', async () => {
  const idx = parseInt(programSelect.value, 10);
  const entry = programList[idx];
  const label = entry?.name || 'Program';
  programFlashBtn.disabled = true;
  flashBtn.disabled = true;
  try {
    if (!programEntries) await fetchProgramEntries(entry);
    if (!programEntries) {
      statusDiv.textContent = 'Failed to load program binary.';
      return;
    }
    // clearOtadata from manifest: OTA-partition programs (e.g. MicroPython) set this
    // true so the factory partition boots instead of a stale OTA slot.
    await performFlash(programEntries, label, {
      clearOtadata: !!entry.clearOtadata,
      successMessage: entry.successMessage ?? null,
    });
  } catch (e) {
    const msg = e.message || String(e);
    statusDiv.textContent = 'Flash error: ' + msg;
    console.error('[Flash error]', e);
    if (/connect|device|lost|serial/i.test(msg)) showConnectionTroubleshoot();
  } finally {
    programFlashBtn.disabled = false;
    flashBtn.disabled = false;
  }
});


// === Bootloader Flash ===

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
    await fetchBootloaderEntries(bootloaderList[0]);
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

async function fetchBootloaderEntries(entry) {
  flashBtn.disabled = true;
  bootloaderEntries = null;
  try {
    bootloaderEntries = await fetchEntriesBinaries(entry, `bootloader v${entry.loader_version}`);
    const totalBytes = bootloaderEntries.reduce((sum, e) => sum + e.binary.byteLength, 0);
    statusDiv.textContent = `Ready to flash bootloader v${entry.loader_version} (${totalBytes.toLocaleString()} bytes)`;
    flashBtn.disabled = false;
  } catch (e) {
    statusDiv.textContent = 'Error downloading bootloader: ' + e;
    bootloaderEntries = null;
    flashBtn.disabled = true;
  }
}

bootloaderSelect.addEventListener('change', async () => {
  const idx = parseInt(bootloaderSelect.value, 10);
  await fetchBootloaderEntries(bootloaderList[idx]);
});

flashBtn.addEventListener('click', async () => {
  if (!bootloaderEntries) {
    statusDiv.textContent = 'Bootloader not loaded. Select a version above.';
    return;
  }
  const idx = parseInt(bootloaderSelect.value, 10);
  const label = `Bootloader v${bootloaderList[idx]?.loader_version ?? ''}`;
  flashBtn.disabled = true;
  programFlashBtn.disabled = true;
  try {
    // Badge OS: clear otadata to force factory boot instead of resuming an OTA slot
    await performFlash(bootloaderEntries, label, {
      clearOtadata: true,
      eraseUserData: !keepUserDataCheckbox.checked,
    });
  } catch (e) {
    const msg = e.message || String(e);
    statusDiv.textContent = 'Flash error: ' + msg;
    console.error('[Flash error]', e);
    if (/connect|device|lost|serial/i.test(msg)) showConnectionTroubleshoot();
  } finally {
    flashBtn.disabled = false;
    programFlashBtn.disabled = false;
  }
});

console.log('[DEBUG] Global: calling showBrowserStatus()');
showBrowserStatus();
