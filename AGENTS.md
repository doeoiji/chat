# VibeRoom Workspace Rules

## Release Channels (Beta -> Stable)
- **`beta` branch**: Beta testing pipeline.
  - Beta server (`d:\chat_beta`, `https://betachat.bitdev.fun`) runs from the `beta` branch.
  - Pushing `android/` or `.github/workflows/android-apk.yml` changes to `beta` builds `VibeRoom Beta` (`fun.bitdev.telechat.beta`, `https://betachat.bitdev.fun`) and publishes a GitHub **Pre-Release** tagged `beta-v<versionName>` (never `--latest`). Use `-beta.N` suffixes on `beta` (e.g. `1.0.14-beta.1`).
- **`main` branch**: Live public production (`d:\chat_and_games_fun`, `https://chat.bitdev.fun`).
  - Stable users ONLY receive updates merged and pushed to `main`.
  - When promoting `beta` -> `main` with Android changes, remove any `-beta.N` suffix from `versionName` (e.g. `1.0.14-beta.1` -> `1.0.14`) and ensure `versionCode` is incremented so the `--latest` GitHub release `v<versionName>` builds cleanly.

## Android APK Updates & Releases
Whenever you make changes to `android/` (Java, `AndroidManifest.xml`, resources, Gradle) or `.github/workflows/android-apk.yml` that require a new Android APK release:
1. Bump `versionCode` (increment by 1) and `versionName` (increment semver, e.g. `1.0.5` -> `1.0.6` on `main`, or `1.0.14-beta.1` -> `1.0.14-beta.2` on `beta`) in `android/app/build.gradle`, because `.github/workflows/android-apk.yml` uses `v<versionName>` (or `beta-v<versionName>`) as the GitHub release tag.
2. Explicitly tell the user that an Android APK update/build is required and give the exact `git add`, `git commit`, and `git push` commands to trigger the GitHub Actions release build.

For changes strictly in `public/` (UI/CSS/JS) or backend files (`src/`, `server.js`), no new Android APK build is needed — only a page refresh / server restart (`npm.cmd start`).

## Local Tooling (Windows)
- Use `npm.cmd test` instead of `npm test` in PowerShell.
