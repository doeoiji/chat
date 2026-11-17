# VibeRoom Workspace Rules

## Android APK Updates & Releases
Whenever you make changes to `android/` (Java, `AndroidManifest.xml`, resources, Gradle) or `.github/workflows/android-apk.yml` that require a new Android APK release:
1. Bump `versionCode` (increment by 1) and `versionName` (increment semver, e.g. `1.0.5` -> `1.0.6`) in `android/app/build.gradle`, because `.github/workflows/android-apk.yml` will skip publishing if the `v<versionName>` GitHub release tag already exists.
2. Explicitly tell the user that an Android APK update/build is required and give the exact `git add`, `git commit`, and `git push` commands to trigger the GitHub Actions release build.

For changes strictly in `public/` (UI/CSS/JS) or backend files (`src/`, `server.js`), no new Android APK build is needed — only a page refresh / server restart (`npm.cmd start`).

## Local Tooling (Windows)
- Use `npm.cmd test` instead of `npm test` in PowerShell.
