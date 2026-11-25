# Platform signing and release checks

This page records the distribution work that cannot be proven from a Linux
checkout alone. The CI workflow wires every supported secret, but a build is
only signed when the corresponding secret and configuration exist. The v1.4.7
assets remain unsigned; do not describe them as signed or notarized.

## Current state

- `.github/workflows/build.yml` runs the full frontend gate on every push and
  creates release installers only for `v*` tags.
- Optional secrets are exported to the build only when their values are
  non-empty. GitHub represents an unset secret as an empty string, and Tauri
  treats a present-but-empty `APPLE_CERTIFICATE` as a certificate to import,
  which fails the macOS bundle. The workflow filters empty values before
  exporting them.
- When Apple secrets are present, Tauri signs and notarizes the macOS bundle.
- The Windows certificate import step runs only on a tagged Windows job and
  exits early when `WINDOWS_CERTIFICATE` is not configured.
- No crash-report endpoint, telemetry SDK or consent UI exists. Renderer
  errors go to a local log file in the application-data folder.
- The in-app updater installs Linux `.deb` packages with `dpkg`. Windows and
  macOS users download installers manually.

## Secrets

Set these as GitHub Actions secrets before a tagged release that is meant to
be signed:

| Platform | Secrets | Notes |
| --- | --- | --- |
| macOS | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID` | Developer ID Application certificate and its identity. |
| macOS notarization | `APPLE_ID`, `APPLE_PASSWORD` **or** `APPLE_API_KEY`, `APPLE_API_ISSUER` | App-specific password or App Store Connect API key. |
| Windows | `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Base64-encoded `.pfx` and its export password. The workflow imports the certificate into the runner's user store. |
| Tauri updater signing | `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Optional; the current custom updater uses release digests instead of `.sig` files. |

Windows still needs a non-secret configuration in
`src-tauri/tauri.conf.json`: either `bundle.windows.certificateThumbprint`
plus `digestAlgorithm` and `timestampUrl`, or a `signCommand` for an EV/Azure
signing tool. The workflow cannot guess the thumbprint from the certificate;
add it before the tag is pushed. If it is absent, the build stays unsigned and
the “no unknown publisher” acceptance criterion is not met.

## Release checks that need a clean machine

For every signed release, run this on a fresh OS image rather than a developer
machine:

1. Install from each published installer.
2. Launch FlintQode and confirm the publisher shown by the OS.
3. Open a workspace, create an integrated terminal and close that one terminal.
4. Check for updates from Settings; confirm the UI stays responsive.
5. Uninstall and confirm no leftover background process.
6. On macOS, confirm the updater is not the installation path and record the
   notarization result from `spctl -a -vvv`.

Record the OS version, installer name and result in the release notes or the
roadmap. A failure blocks the milestone; rerun the affected platform job if
GitHub reports only a runner-acquisition error.

## Deferred work

- Remote crash reporting: needs an endpoint, retention policy and an explicit
  consent setting. It stays off until that product decision is made.
- Automated native accessibility audit: there is no in-repo UI harness. Until
  one exists, run a keyboard-only smoke test against the built app and record
  the result manually.
- Cross-platform in-app updates: requires installer-specific install commands
  for Windows and macOS; the current code path is Linux `.deb` only.
