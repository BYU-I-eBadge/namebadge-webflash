# Namebadge Web Flash

## Purpose

This project provides a single-page web application designed to flash ESP32-based systems with a bootloader. The primary use case is for the BYUI Namebadge hardware, but it may be adaptable to other ESP32-S3-based devices.

## Overview

- **Web-based Flasher:** Users can flash their ESP32 device directly from the browser, simplifying the process for classrooms and end-users.
- **Bootloader Management:** The bootloader architecture and update process are described in detail in the [NAMEBADGE_BOOTING.md](../BYUI-Namebadge4-OTA/docs/NAMEBADGE_BOOTING.md) document.
- **Manifest-driven:** The bootloader binary and its metadata are described in a manifest file, currently hosted at:
  
  [https://github.com/watsonlr/namebadge-apps/blob/main/bootloader_downloads/loader_manifest.json](https://github.com/watsonlr/namebadge-apps/blob/main/bootloader_downloads/loader_manifest.json)

## Features

- Flash the latest bootloader to ESP32-S3-based namebadges via the web
- Fetches bootloader binaries and metadata from a remote manifest
- User-friendly interface for non-technical users

## Documentation

- **Bootloader Architecture:** See [NAMEBADGE_BOOTING.md](../BYUI-Namebadge4-OTA/docs/NAMEBADGE_BOOTING.md) for a detailed description of the boot process, memory layout, and update mechanisms.
- **Hardware Details:** See [HARDWARE.md](../BYUI-Namebadge4-OTA/docs/HARDWARE.md) for pinout and hardware configuration.

## Status

This project is under active development. The manifest and bootloader binary locations may change as the project evolves.

## License

See LICENSE file for details.
