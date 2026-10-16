---
title: adb
description: Android Debug Bridge commands for devices, apps, files, logs, screenshots and the shell, each with a one-line reminder.
sheet: adb
tags: [adb, android, debugging]
updated: 2026-10-12
---

The `adb` commands I use most when testing Android apps. `adb` ships with the Android SDK Platform Tools; add its `platform-tools` folder to your `PATH` so it works from any terminal. With more than one device or emulator connected, put `-s SERIAL` right after `adb` to pick one (get the serial from `adb devices`). Words in CAPS like `PACKAGE`, `FILE` or `SERIAL` are placeholders for your own values; `PACKAGE` is the app's application id, such as `com.example.app`.
