# iOS build and install

Cria for iOS is the native Swift app in [`ios-native/`](ios-native/). It is installed by sideloading an unsigned `.ipa` with [SideStore](https://sidestore.io). No paid Apple Developer account and no computer are needed after the one-off SideStore setup.

The older Tauri iOS build (`io.cria.app`, `io.cria.app.nightly`) is deprecated: it is no longer built, and the SideStore source no longer lists it. Moving over: let the old app finish syncing (nothing waiting to send), then install the native app and sign in; it downloads everything from your Vikunja server. Delete the old app afterwards.

## Install with SideStore (recommended)

1. Install and set up SideStore by following its [official guide](https://docs.sidestore.io). This needs a computer once, plus a free Apple ID. Keep the loopback VPN (LocalDevVPN/StosVPN) on so SideStore can refresh in the background.
2. In SideStore, open **Sources**, tap **+**, and add:

   ```
   https://pocketcoder.github.io/cria/sidestore.json
   ```

3. Open the source and tap **Free** on **Cria** (`io.cria.app.swift`). It is rebuilt on every push to `dev` and `main` that touches the iOS app.
4. To update, pull to refresh the source and tap **Update**. It installs over the existing app and keeps your data.

Free Apple IDs allow 3 active sideloaded apps and certificates last 7 days; SideStore auto-refreshes them while the VPN is on.

### Manual install

Download the `.ipa` from the [GitHub Releases](https://github.com/PocketCoder/cria/releases) page (`Cria-Swift-Alpha-unsigned.ipa` on the rolling `swift-alpha` prerelease, or `Cria-iOS-unsigned.ipa` attached to a tagged release) in Safari, then share it to SideStore.

### Troubleshooting

- **"Decoding failed: Data corrupted"** when adding the source: the URL is wrong or has a stray space. Open it in Safari; it should show JSON.
- **"does not match the build number specified by the source"**: the `.ipa` and the source disagree on version. CI sets both from the same value, so wait for the workflow run to finish and refresh the source.
- **App vanishes after a week**: SideStore did not refresh in time. Check the VPN is on, then refresh from **My Apps**.

## How the source is built

[`ci-swift.yml`](.github/workflows/ci-swift.yml) (`publish-ipa` job) owns `sidestore.json` on the `gh-pages` branch. On pushes to `dev` and `main` that pass its checks it uploads the `.ipa` to the rolling `swift-alpha` prerelease and rewrites the source with the one app entry, dropping the deprecated Tauri entries. The marketing version is `<major>.<minor>.<run number>`, because SideStore ignores build-number-only changes.

SideStore refuses an install if `version` or `buildVersion` differs from the `.ipa`'s `Info.plist`; the workflow checks the two match before publishing.

Tagged releases ([`release.yml`](.github/workflows/release.yml), `build-ios` job) also attach `Cria-iOS-unsigned.ipa`, built from the same code with the release version.

## Build locally

Needs macOS with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`). See [`ios-native/README.md`](ios-native/README.md):

```sh
cd ios-native/CriaApp && xcodegen generate && open CriaApp.xcodeproj
cd ios-native/CriaKit && swift test
```
