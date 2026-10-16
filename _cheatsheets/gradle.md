---
title: Gradle
description: The Gradle wrapper commands for building, testing, installing and debugging Android projects, each with a one-line reminder.
sheet: gradle
tags: [gradle, android, build]
updated: 2026-10-12
---

The `./gradlew` commands I use most on Android projects. Run them from the project's root folder, where the `gradlew` script lives. On Windows, type `gradlew.bat` (or just `gradlew`) instead of `./gradlew`. Words in CAPS like `MODULE`, `TASK` or `CLASS` are placeholders for your own values. Task names such as `assembleDebug` follow your build variants, so with a `prod` flavor the release build becomes `assembleProdRelease`.
