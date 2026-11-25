/**
 * Release names are shared by the verifier, the manifest generator and the
 * website. These tests stop one of those consumers from drifting away.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expectedAssets, isSha256, releaseAssetUrl, UPDATE_MANIFEST_PATH } from '../scripts/release-assets.mjs'
import { manifestIssues, readVersion } from '../scripts/generate-update-manifest.mjs'

const root = resolve(import.meta.dirname, '..')
const version = readVersion()
const expected = expectedAssets(version)

test('every expected installer has a stable name', () => {
  assert.equal(expected.length, 7)
  assert.equal(new Set(expected).size, 7)
  assert.equal(releaseAssetUrl(version, expected[0]!).includes(`/v${version}/`), true)
})

test('the downloads page uses exact tag-qualified links', () => {
  const html = readFileSync(resolve(root, 'docs/downloads.html'), 'utf8')
  for (const name of expected.filter((asset) => !asset.endsWith('.app.tar.gz'))) {
    assert.ok(html.includes(releaseAssetUrl(version, name)), `downloads.html is missing ${name}`)
  }
})

test('every documented asset pattern matches an expected asset', () => {
  const html = readFileSync(resolve(root, 'docs/downloads.html'), 'utf8')
  const patterns = [...html.matchAll(/data-asset="([^"]+)"/g)].map((match) => match[1]!)
  assert.ok(patterns.length > 0)

  const matched = new Set<string>()
  for (const pattern of patterns) {
    const expression = new RegExp(pattern, 'i')
    const hits = expected.filter((name) => expression.test(name))
    assert.equal(hits.length, 1, `${pattern} matched ${hits.length} assets`)
    matched.add(hits[0]!)
  }
  for (const name of expected.filter((asset) => !asset.endsWith('.app.tar.gz'))) {
    assert.ok(matched.has(name), `${name} has no download card`)
  }
})

test('the committed update manifest matches the expected release', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, UPDATE_MANIFEST_PATH), 'utf8'))
  assert.deepEqual(manifestIssues(manifest, version), [])
  assert.equal(manifest.version, version)
  assert.equal(manifest.tag, `v${version}`)
  for (const asset of manifest.assets) {
    assert.equal(asset.url, releaseAssetUrl(version, asset.name))
    assert.ok(isSha256(asset.sha256))
  }
})

test('the manifest check rejects stale and corrupted entries', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, UPDATE_MANIFEST_PATH), 'utf8'))
  assert.ok(manifestIssues({ ...manifest, version: '0.0.0' }, version).length > 0)

  const corrupted = {
    ...manifest,
    assets: manifest.assets.map((asset: { name: string; sha256: string }, index: number) =>
      index === 0 ? { ...asset, sha256: 'not-a-checksum' } : asset,
    ),
  }
  assert.ok(manifestIssues(corrupted, version).some((issue) => issue.includes('SHA-256')))
})
