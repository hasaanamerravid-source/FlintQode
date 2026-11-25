# Release checklist

Use this checklist for every FlintQode release after v1.4.7.

## Before tagging

1. Confirm the working tree is clean and on the latest `main`.
2. Set `VERSION` to `vX.Y.Z` and run `node scripts/sync-version.mjs --no-build`.
3. Update `CHANGELOG.md`, `.github/workflows/build.yml` release body and the website:
   - `docs/index.html`
   - `docs/downloads.html`
   - `docs/versions.html`
   - `docs/whats-new.html`
4. Run the full local gate:

   ```sh
   npm run check
   cd src-tauri && cargo fmt --all -- --check && cargo test
   ```

   `npm run check` includes format, types, translations, manifest schema, unit
   tests and the Vite build. The manifest still describes the previous release
   at this point; its version is checked against `VERSION` only after publish.

5. Check that every version file carries the same number:

   ```sh
   grep -R "X.Y.Z" VERSION package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src/renderer/src/bridge.ts
   ```

6. Review [platform-signing.md](platform-signing.md). If the release is meant to
   be signed, confirm the Actions secrets and the Windows thumbprint or
   `signCommand` are in place before the tag is pushed.

## Publishing

1. Commit and push to `main`.
2. Create and push an annotated tag:

   ```sh
   git tag -a vX.Y.Z -m "FlintQode vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. Wait for the tagged `Build FlintQode installers` run to finish on Linux, Windows and macOS.
   Pushes to `main` run the checks only; installers are built exclusively from tags.
4. If a macOS job fails only because GitHub could not acquire a runner, rerun that job. Do not publish from a run with a missing macOS asset.
5. Publish the draft release:

   ```sh
   gh release edit vX.Y.Z --draft=false
   ```

6. Generate the static update manifest from the exact tag and its asset digests,
   then commit it to `main` so Pages publishes it:

   ```sh
   GITHUB_TOKEN="$(gh auth token)" npm run manifest:generate
   git add docs/assets/data/update-manifest.json
   git commit -m "chore: publish update manifest for vX.Y.Z"
   git push origin main
   ```

   The manifest is a Pages file, not an eighth release asset. The website and
   the in-app updater read it before falling back to GitHub's release API.

7. Wait for the Pages deployment to finish, then verify the whole release in
   one command:

   ```sh
   npm run release:verify
   ```

   It checks version files, the local and published manifests, release state,
   all 7 asset URLs, the Pages version text and the Stats `latest.tag`.

8. Refresh Stats if the release event did not trigger it:

   ```sh
   gh workflow run stats.yml --ref main
   ```

9. Run the clean-VM checks in [platform-signing.md](platform-signing.md) for
   each platform. Record the OS, installer and result. Run Lighthouse
   accessibility against `downloads.html` and fix any failure. A keyboard-only
   native accessibility smoke test is required until an in-repo UI harness exists.

## If branch protection blocks a fix

Do not rewrite a pushed commit. Add a focused follow-up commit, push it normally, and move only the tag:

```sh
git tag -f -a vX.Y.Z -m "FlintQode vX.Y.Z"
git push --force origin vX.Y.Z
```

Cancel any older CI runs for the same tag before the new one finishes, so stale artifacts cannot race the corrected build. Regenerate the manifest after the corrected assets are uploaded.

## After publishing

- Confirm the release page shows the correct notes and 7 assets.
- Confirm the Stats tab shows the new version as latest.
- Confirm the published update manifest shows the same version and seven exact download URLs.
- Record any deferred issues in the roadmap.
- Mark the milestone complete only after the verification command passes.
