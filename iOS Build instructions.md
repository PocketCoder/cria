# iOS build and install

Cria for iOS is installed by sideloading an unsigned `.ipa` with [SideStore](https://sidestore.io). No paid Apple Developer account and no computer are needed after the one-off SideStore setup.

## Install with SideStore (recommended)

1. Install and set up SideStore by following its [official guide](https://docs.sidestore.io). This needs a computer once, plus a free Apple ID. Keep the loopback VPN (LocalDevVPN/StosVPN) on so SideStore can refresh in the background.
2. In SideStore, open **Sources**, tap **+**, and add:

   ```
   https://pocketcoder.github.io/cria/sidestore.json
   ```

3. Open the source and tap **Free** on the app you want:
   - **Cria**: the stable release (`io.cria.app`).
   - **Cria (Nightly)**: every push to `dev` (`io.cria.app.nightly`). Unstable.
4. To update, pull to refresh the source and tap **Update**. It installs over the existing app and keeps your data.

Both apps install side by side. Free Apple IDs allow 3 active sideloaded apps and certificates last 7 days; SideStore auto-refreshes them while the VPN is on.

### Manual install

Download the `.ipa` from the [GitHub Releases](https://github.com/PocketCoder/cria/releases) page (`Cria-unsigned.ipa` for stable, `Cria-Nightly-unsigned.ipa` on the rolling `nightly` prerelease) in Safari, then share it to SideStore.

### Troubleshooting

- **"Decoding failed: Data corrupted"** when adding the source: the URL is wrong or has a stray space. Open it in Safari; it should show JSON.
- **"does not match the build number specified by the source"**: the `.ipa` and the source disagree on version. CI sets both from the same value, so wait for the workflow run to finish and refresh the source.
- **App vanishes after a week**: SideStore did not refresh in time. Check the VPN is on, then refresh from **My Apps**.

## How the source is built

Both workflows write into one `sidestore.json` on the `gh-pages` branch, each replacing only its own app entry:

- [`nightly.yml`](.github/workflows/nightly.yml) publishes the nightly entry on every `dev` push. The `.ipa` keeps the plain `package.json` version (iOS rejects prerelease suffixes), so the run number is set as `CFBundleVersion` and listed as `buildVersion`.
- [`release.yml`](.github/workflows/release.yml) publishes the stable entry on every `v*` tag.

SideStore refuses an install if `version` or `buildVersion` differs from the `.ipa`'s `Info.plist`, so keep the two in step if you change either workflow.

## Build locally

Needs macOS, Xcode with Command Line Tools, [CocoaPods](https://cocoapods.org), and the iOS Rust target (`rustup target add aarch64-apple-ios`). A free personal team works for on-device testing (builds expire after 7 days). Allow ~10 GB of disk.

```sh
# Run on a connected device or simulator (--host serves Vite over the LAN)
pnpm tauri ios dev --host

# Standalone build, signed for your own registered device
pnpm tauri ios build --export-method debugging

# Compile-check the iOS shell only
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-apple-ios
```

The Xcode project lives in `src-tauri/gen/apple/` (regenerate with `pnpm tauri ios init`). After `ios init`, restore the app icons, which it mis-copies:

```sh
cp src-tauri/icons/ios/*.png src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset/
```

On a physical device, trust the dev profile in Settings > General > VPN & Device Management, and allow Local Network access for `--host`.
