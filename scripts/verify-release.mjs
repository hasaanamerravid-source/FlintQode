#!/usr/bin/env node
/**
 * Verify a published FlintQode release end to end.
 *
 * The script checks that the version is consistent, that the GitHub release is
 * public and complete, that every installer answers HTTP 200, and that the
 * website and statistics data point at the same version.
 *
 * Usage: npm run release:verify
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = 'hasaanamerravid-source/FlintQode'
const pages = 'https://hasaanamerravid-source.github.io/FlintQode'

const problems = []
const notes = []

function fail(message) {
  problems.push(message)
}

function ok(message) {
  notes.push(message)
}

function read(relative) {
  return readFileSync(resolve(root, relative), 'utf8')
}

/** Read a JSON file and report a useful error instead of throwing. */
function parseJson(relative) {
  try {
    return JSON.parse(read(relative))
  } catch (error) {
    fail(`${relative}: invalid JSON (${error.message})`)
    return null
  }
}

function checkVersions(version) {
  const checks = [
    ['package.json', parseJson('package.json')?.version],
    ['package-lock.json', parseJson('package-lock.json')?.version],
    ['src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').match(/^version = "(.+)"/m)?.[1]],
    ['src-tauri/tauri.conf.json', parseJson('src-tauri/tauri.conf.json')?.version],
    ['src/renderer/src/bridge.ts', read('src/renderer/src/bridge.ts').match(/version: '([^']+)'/)?.[1]],
  ]
  const lock = read('src-tauri/Cargo.lock')
  const lockVersion = lock.match(/name = "flintqode"\nversion = "([^"]+)"/)?.[1]
  checks.push(['src-tauri/Cargo.lock', lockVersion])

  for (const [file, found] of checks) {
    if (found === version) ok(`${file} is ${version}`)
    else fail(`${file}: expected ${version}, found ${found ?? 'nothing'}`)
  }
}

function expectedAssets(version) {
  return [
    `FlintQode_${version}_amd64.deb`,
    `FlintQode_${version}_amd64.AppImage`,
    `FlintQode-${version}-1.x86_64.rpm`,
    `FlintQode_${version}_x64-setup.exe`,
    `FlintQode_${version}_x64_en-US.msi`,
    `FlintQode_${version}_aarch64.dmg`,
    'FlintQode_aarch64.app.tar.gz',
  ]
}

async function checkStatus(url) {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30000) })
    return response.status
  } catch (error) {
    return `error: ${error.message}`
  }
}

function gh(args) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', timeout: 30000 })
}

async function checkRelease(version) {
  let release
  try {
    release = JSON.parse(
      gh(['release', 'view', `v${version}`, '--repo', repo, '--json', 'isDraft,isPrerelease,assets,url']),
    )
  } catch (error) {
    fail(`release v${version}: ${error.message.split('\n')[0]}`)
    return
  }

  if (release.isDraft) fail(`release v${version} is still a draft`)
  else ok(`release v${version} is published`)

  if (release.isPrerelease) fail(`release v${version} is marked prerelease`)
  else ok('release is not a prerelease')

  const names = (release.assets ?? []).map((asset) => asset.name)
  for (const name of expectedAssets(version)) {
    if (!names.includes(name)) fail(`missing release asset: ${name}`)
  }
  if (names.length !== expectedAssets(version).length) {
    fail(`expected ${expectedAssets(version).length} assets, found ${names.length}`)
  } else {
    ok(`release has ${names.length} assets`)
  }

  await Promise.all(
    (release.assets ?? []).map(async (asset) => {
      const status = await checkStatus(asset.url)
      if (status === 200) ok(`HTTP 200 ${asset.name}`)
      else fail(`${asset.name}: HTTP ${status}`)
    }),
  )
}

async function checkPages(version) {
  const versions = await fetch(`${pages}/versions.html?verify=${Date.now()}`, {
    signal: AbortSignal.timeout(30000),
  })
    .then((response) => response.text())
    .catch((error) => {
      fail(`versions.html: ${error.message}`)
      return ''
    })
  if (versions.includes(`data-release-version>v${version}<`)) ok(`Pages shows v${version}`)
  else if (versions) fail(`Pages does not show v${version} as current`)

  const stats = await fetch(`${pages}/assets/data/stats.json?verify=${Date.now()}`, {
    signal: AbortSignal.timeout(30000),
  })
    .then((response) => response.json())
    .catch((error) => {
      fail(`stats.json: ${error.message}`)
      return null
    })
  if (!stats) return
  const latest = stats.downloads?.latest?.tag ?? stats.latest?.tag
  if (latest === `v${version}`) ok(`Stats latest release is v${version}`)
  else fail(`Stats latest release: expected v${version}, found ${latest ?? 'nothing'}`)
}

const version = read('VERSION').trim().replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`VERSION has an unexpected format: ${version}`)
else ok(`VERSION is ${version}`)

checkVersions(version)
await checkRelease(version)
await checkPages(version)

for (const note of notes) console.log(`ok   ${note}`)
for (const problem of problems) console.error(`FAIL ${problem}`)

if (problems.length > 0) {
  console.error(`\n${problems.length} release check${problems.length === 1 ? '' : 's'} failed.`)
  process.exit(1)
}

console.log(`\nRelease v${version} verified.`)
