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

5. Check that every version file carries the same number:

   ```sh
   grep -R "X.Y.Z" VERSION package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json src/renderer/src/bridge.ts
   ```

## Publishing

1. Commit and push to `main`.
2. Create and push an annotated tag:

   ```sh
   git tag -a vX.Y.Z -m "FlintQode vX.Y.Z"
   git push origin vX.Y.Z
   ```

3. Wait for the tagged `Build FlintQode installers` run to finish on Linux, Windows and macOS.
4. If a macOS job fails only because GitHub could not acquire a runner, rerun that job. Do not publish from a run with a missing macOS asset.
5. Publish the draft release:

   ```sh
   gh release edit vX.Y.Z --draft=false
   ```

6. Verify the whole release in one command:

   ```sh
   npm run release:verify
   ```

   It checks version files, release state, all 7 asset URLs, the Pages version text and the Stats `latest.tag`.

7. Refresh Stats if the release event did not trigger it:

   ```sh
   gh workflow run stats.yml --ref main
   ```

## If branch protection blocks a fix

Do not rewrite a pushed commit. Add a focused follow-up commit, push it normally, and move only the tag:

```sh
git tag -f -a vX.Y.Z -m "FlintQode vX.Y.Z"
git push --force origin vX.Y.Z
```

Cancel any older CI runs for the same tag before the new one finishes, so stale artifacts cannot race the corrected build.

## After publishing

- Confirm the release page shows the correct notes and 7 assets.
- Confirm the Stats tab shows the new version as latest.
- Record any deferred issues in the roadmap.
- Mark the milestone complete only after the verification command passes.
