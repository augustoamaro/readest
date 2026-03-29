# AppImage Build Fix

## Problem

The Linux/AppImage bundling path for the fork failed in two separate places:

1. `linuxdeploy` reused a stale `AppDir`, and the GTK plugin aborted on existing symlinks such as `usr/lib/im-am-et.so`.
2. `appimagetool` then failed to download the AppImage runtime from GitHub in the restricted environment.

## Fix

- Added `apps/readest-app/scripts/build-local-appimage.sh` to clear stale AppImage bundle output before running the fork's release build with `src-tauri/tauri.local.conf.json`.
- Added the `build-linux-local-appimage` package script as a stable entrypoint for the fork build.
- Finished the final AppImage packaging after allowing the runtime download step to complete.

## Result

- Generated AppImage: `/home/leonidas/Projects/startup/readest/Readest_Local-x86_64.AppImage`
- Updated installed AppImage: `/home/leonidas/Applications/Readest Local.AppImage`
- No system packages were installed for this fix.
