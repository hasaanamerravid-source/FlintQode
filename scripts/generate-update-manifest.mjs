#!/usr/bin/env node
/**
 * Generate the static update manifest published on GitHub Pages.
 *
 * The manifest uses the exact tag-qualified asset URLs and GitHub's SHA-256
 * digests, so neither the website nor the in-app updater has to follow
 * `/releases/latest`. Run it after the release assets have been uploaded:
 *
 *   GITHUB_TOKEN=... node scripts/generate-update-manifest.mjs
 *
 * `npm run manifest:check` validates the committed manifest without network
 * access and is part of the normal frontend gate.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expectedAssets,
  isSha256,
  normalizeDigest,
  releaseAssetUrl,
  REPOSITORY,
  UPDATE_MANIFEST_PATH,
} from './release-assets.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(root, UPDATE_MANIFEST_PATH)

export function readVersion() {
  return readFileSync(resolve(root, 'VERSION'), 'utf8').trim().replace(/^v/, '')
}

/** Build a manifest from the GitHub release JSON, using expected names only. */
export function buildManifest(release, version) {
  if (!release || !Array.isArray(release.assets)) {
    throw new Error('the release JSON has no assets array')
  }

  const assets = expectedAssets(version).map((name) => {
    const found = release.assets.find((asset) => asset?.name === name)
    if (!found) throw new Error(`missing release asset: ${name}`)

    const sha256 = normalizeDigest(found.digest)
    if (!isSha256(sha256)) throw new Error(`${name}: missing or invalid SHA-256 digest`)

    return { name, url: releaseAssetUrl(version, name), sha256 }
  })

  return { version, tag: `v${version}`, assets }
}

/** Validate a committed manifest without calling GitHub. */
export function manifestIssues(manifest, version) {
  const issues = []
  if (!manifest || typeof manifest !== 'object') return ['manifest is not an object']
  if (manifest.version !== version) {
    issues.push(`version: expected ${version}, found ${manifest.version ?? 'nothing'}`)
  }
  if (manifest.tag !== `v${version}`) {
    issues.push(`tag: expected v${version}, found ${manifest.tag ?? 'nothing'}`)
  }

  const expected = expectedAssets(version)
  const names = Array.isArray(manifest.assets) ? manifest.assets.map((asset) => asset?.name) : []
  if (names.length !== expected.length || expected.some((name, index) => names[index] !== name)) {
    issues.push(`assets: expected ${expected.join(', ')}, found ${names.join(', ') || 'nothing'}`)
  }

  for (const asset of Array.isArray(manifest.assets) ? manifest.assets : []) {
    if (!asset || typeof asset !== 'object') continue
    const expectedUrl = expected.includes(asset.name) ? releaseAssetUrl(version, asset.name) : '(unknown asset)'
    if (asset.url !== expectedUrl) {
      issues.push(`${asset.name ?? 'unknown'}: url is ${asset.url ?? 'nothing'}, expected ${expectedUrl}`)
    }
    if (!isSha256(asset.sha256 ?? '')) {
      issues.push(`${asset.name ?? 'unknown'}: invalid SHA-256 digest`)
    }
  }

  return issues
}

async function fetchRelease(version) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'FlintQode-maintenance' }
  const token = process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/tags/v${version}`, {
    headers,
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
  return response.json()
}

async function main() {
  const version = readVersion()
  const args = new Set(process.argv.slice(2))

  if (args.has('--check')) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    } catch (error) {
      console.error(`FAIL ${UPDATE_MANIFEST_PATH}: ${error.message}`)
      process.exitCode = 1
      return
    }
    // Schema validation is version-agnostic: a release bumps VERSION before
    // its assets exist, so the manifest is regenerated after the tag build.
    // release:verify checks that the published manifest matches VERSION.
    const manifestVersion =
      typeof manifest?.version === 'string' && /^\d+\.\d+\.\d+$/.test(manifest.version) ? manifest.version : version
    const issues = manifestIssues(manifest, manifestVersion)
    if (issues.length > 0) {
      for (const issue of issues) console.error(`FAIL ${issue}`)
      process.exitCode = 1
      return
    }
    console.log(`ok   ${UPDATE_MANIFEST_PATH} is valid for v${manifestVersion}`)
    return
  }

  const manifest = buildManifest(await fetchRelease(version), version)
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${UPDATE_MANIFEST_PATH} for v${version}.`)
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) await main()
