# Publishing Apps to the Namebadge Web Flasher

This guide explains how to add a new bare-metal program to the **Single Program Flash** list on the Namebadge Web Flasher, and how to publish a new badge OS (bootloader) release.

---

## Prerequisites

- Write access to [BYU-I-eBadge/byu-i-ebadge.github.io](https://github.com/BYU-I-eBadge/byu-i-ebadge.github.io)
- [ESP-IDF](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/) installed (for building)
- The Pages repo cloned locally, adjacent to your app repo:

```
~/your-workspace/
├── byu-i-ebadge.github.io/   ← clone of the Pages repo
└── my-namebadge-app/         ← your app repo
```

The publish script auto-detects `byu-i-ebadge.github.io` as a sibling directory.  
If your layout is different, set the env var before running:

```bash
export NAMEBADGE_PAGES_REPO=/path/to/byu-i-ebadge.github.io
```

---

## Publishing a Bare-Metal App

Bare-metal apps are standalone ESP-IDF programs that run directly without the badge OS. They need three flash regions written in order: the ESP-IDF bootloader, a simple partition table, and the app itself.

### Flash layout for bare-metal apps

| Region            | Address  | Source file                              |
|-------------------|----------|------------------------------------------|
| ESP-IDF bootloader | `0x1000` | `build/bootloader/bootloader.bin`        |
| Partition table   | `0x8000` | `build/partition_table/partition-table.bin` |
| Factory app       | `0x10000`| `build/<your_app>.bin`                   |

### 1. Use the standard partition table

Your app's `partitions.csv` should use a simple single-app layout with the factory partition at `0x10000`:

```csv
# Name,     Type,  SubType,  Offset,   Size,  Flags
nvs,        data,  nvs,      0x9000,   0x6000,
phy_init,   data,  phy,      0xF000,   0x1000,
factory,    app,   factory,  0x10000,  0x3F0000,
```

### 2. Add a publish script

Copy and adapt the [pacman publish script](https://github.com/watsonlr/namebadge_pacman/blob/main/publish.sh) into your repo. Change these lines near the top:

```bash
APP_BIN="${SCRIPT_DIR}/build/your_app.bin"   # match your build output name
APP_NAME="My App"                             # display name in the flasher
APP_DEST_NAME="my_app.bin"
BL_DEST_NAME="my_app_bl.bin"
PT_DEST_NAME="my_app_pt.bin"
```

### 3. Build and publish

```bash
idf.py build
./publish.sh
```

The script will:
1. Copy `bootloader.bin`, `partition-table.bin`, and your app binary to `byu-i-ebadge.github.io/apps/`
2. Update `apps/manifest.json` with the new `binaries` entry
3. Commit and push — the app appears in the flasher within a minute

### Resulting manifest entry

```json
{
  "name": "My App",
  "binaries": [
    { "url": "https://byu-i-ebadge.github.io/apps/my_app_bl.bin",  "address": 4096 },
    { "url": "https://byu-i-ebadge.github.io/apps/my_app_pt.bin",  "address": 32768 },
    { "url": "https://byu-i-ebadge.github.io/apps/my_app.bin",     "address": 65536 }
  ]
}
```

### OTA-partition apps (factory at 0x20000)

If your app uses an OTA-capable partition table (factory partition at `0x20000` instead of `0x10000`), add `"clearOtadata": true` to the manifest entry. This tells the flasher to wipe the OTA boot selector so the factory partition starts instead of a stale OTA slot.

```json
{
  "name": "My OTA App",
  "clearOtadata": true,
  "binaries": [
    { "url": "https://byu-i-ebadge.github.io/apps/my_app_bl.bin",  "address": 4096 },
    { "url": "https://byu-i-ebadge.github.io/apps/my_app_pt.bin",  "address": 32768 },
    { "url": "https://byu-i-ebadge.github.io/apps/my_app.bin",     "address": 131072 }
  ]
}
```

---

## Publishing a Badge OS (Bootloader) Release

The badge OS is the OTA-capable loader that lives in the factory partition. It requires three flash regions as well, but with a different (OTA) partition table and the factory app at `0x20000`.

### Flash layout for the badge OS

| Region             | Address   | Source file                              |
|--------------------|-----------|------------------------------------------|
| Custom bootloader  | `0x0`     | `build/bootloader/bootloader.bin`        |
| OTA partition table| `0x8000`  | `build/partition_table/partition-table.bin` |
| Badge OS factory app | `0x20000` | `build/ebadge_app.bin`               |

The publish script lives in [BYUI-Namebadge4-OTA](https://github.com/watsonlr/BYUI-Namebadge4-OTA):

```bash
cd BYUI-Namebadge4-OTA
idf.py build
./tools/publish_bootloader.sh
```

The script prompts for a version number, builds, copies all three binaries to `byu-i-ebadge.github.io/bootloader_downloads/`, updates `loader_manifest.json`, and pushes.

---

## Manifest formats

### `apps/manifest.json` — single program list

```json
{
  "apps": [
    {
      "name": "My App",
      "binaries": [
        { "url": "https://byu-i-ebadge.github.io/apps/my_app_bl.bin",  "address": 4096 },
        { "url": "https://byu-i-ebadge.github.io/apps/my_app_pt.bin",  "address": 32768 },
        { "url": "https://byu-i-ebadge.github.io/apps/my_app.bin",     "address": 65536 }
      ]
    }
  ]
}
```

### `bootloader_downloads/loader_manifest.json` — badge OS releases

```json
[
  {
    "hw_version": 4,
    "loader_version": 2,
    "binaries": [
      { "url": "https://byu-i-ebadge.github.io/bootloader_downloads/badge_bootloader_v4.2_bl.bin",  "address": 4096 },
      { "url": "https://byu-i-ebadge.github.io/bootloader_downloads/badge_bootloader_v4.2_pt.bin",  "address": 32768 },
      { "url": "https://byu-i-ebadge.github.io/bootloader_downloads/badge_bootloader_v4.2.bin",     "address": 131072 }
    ]
  }
]
```

---

## Notes

- The flasher is backward compatible with the old single-`binary_url` manifest format, so existing entries keep working until you re-publish with the new format.
- All three binaries (bootloader, partition table, app) must match the same ESP-IDF build. Don't mix binaries from different builds.
- The `user_data` partition (`0x3E0000`) is never touched by the flasher — WiFi credentials and badge settings survive a reflash unless the user explicitly opts to erase them.
