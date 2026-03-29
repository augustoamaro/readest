# Fork Updater Isolation

The local fork disables updater behavior on desktop builds identified as `com.leonidas.readestlocal`.

- `tauri.local.conf.json` removes the updater plugin config.
- Rust skips `tauri-plugin-updater` initialization for the local fork.
- The frontend avoids update and release-notes checks on the desktop fork.

Result:

- `Readest Local` does not use the official Readest updater feed.
- Opening the AppImage does not trigger update checks against `download.readest.com` on the desktop fork.
- Linux/AppImage packaging remains enabled; only updater behavior is disabled.
