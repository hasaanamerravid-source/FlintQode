/**
 * The single source of truth for FlintQode release asset names.
 *
 * verify-release.mjs, the update-manifest generator and the unit tests all use
 * this module, so a rename cannot pass one check and fail another.
 */

export const REPOSITORY = 'hasaanamerravid-source/FlintQode'
export const PAGES_ROOT = 'https://hasaanamerravid-source.github.io/FlintQode'
export const UPDATE_MANIFEST_PATH = 'docs/assets/data/update-manifest.json'

const ASSET_TEMPLATES = [
  (version) => `FlintQode_${version}_amd64.deb`,
  (version) => `FlintQode_${version}_amd64.AppImage`,
  (version) => `FlintQode-${version}-1.x86_64.rpm`,
  (version) => `FlintQode_${version}_x64-setup.exe`,
  (version) => `FlintQode_${version}_x64_en-US.msi`,
  (version) => `FlintQode_${version}_aarch64.dmg`,
  () => 'FlintQode_aarch64.app.tar.gz',
]

/** The seven exact installer names published for a version. */
export function expectedAssets(version) {
  return ASSET_TEMPLATES.map((template) => template(version))
}

/** The exact, tag-qualified download URL for one asset. */
export function releaseAssetUrl(version, name) {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${name}`
}

/** GitHub sends digests as `sha256:<hex>`; accept a bare hash too. */
export function normalizeDigest(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/^sha256:/i, '')
    .toLowerCase()
}

export function isSha256(value) {
  return /^[0-9a-f]{64}$/.test(value)
}
