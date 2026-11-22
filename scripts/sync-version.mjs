#!/usr/bin/env node
/**
 * Single source of truth for the FlintQode version and build number.
 *
 * Reads the plain `VERSION` file and writes the version into every place that
 * carries one:
 *   - package.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/tauri.conf.json
 *
 * It also records a monotonic build number (the commit count) and the short
 * commit hash in `BUILD` and `BUILD_SHA`. The Rust build script and the website
 * read those files, so the About dialog and the download page can show exactly
 * which build a user is running.
 *
 * Usage: node scripts/sync-version.mjs [--no-build]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim().replace(/^v/, '')

// package.json — regex replace to preserve formatting
const pkgPath = resolve(root, 'package.json')
let pkg = readFileSync(pkgPath, 'utf8')
pkg = pkg.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
writeFileSync(pkgPath, pkg)

// src-tauri/Cargo.toml
const cargoPath = resolve(root, 'src-tauri/Cargo.toml')
let cargo = readFileSync(cargoPath, 'utf8')
cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
writeFileSync(cargoPath, cargo)

// src-tauri/tauri.conf.json — regex replace to preserve formatting
const tauriPath = resolve(root, 'src-tauri/tauri.conf.json')
let tauri = readFileSync(tauriPath, 'utf8')
tauri = tauri.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
writeFileSync(tauriPath, tauri)

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

if (!process.argv.includes('--no-build')) {
  const buildPath = resolve(root, 'BUILD')
  const shaPath = resolve(root, 'BUILD_SHA')
  // `git rev-list --count HEAD` is monotonic and identical on every machine
  // that checks out the same commit. When git is unavailable (a source zip),
  // the existing file is kept.
  const count = git(['rev-list', '--count', 'HEAD'])
  const sha = git(['rev-parse', '--short=7', 'HEAD'])
  if (count) writeFileSync(buildPath, `${count}\n`)
  else if (!existsSync(buildPath)) writeFileSync(buildPath, '0\n')
  if (sha) writeFileSync(shaPath, `${sha}\n`)
  else if (!existsSync(shaPath)) writeFileSync(shaPath, 'unknown\n')
  console.log(
    `Synced version ${version} · build ${readFileSync(buildPath, 'utf8').trim()} (${readFileSync(shaPath, 'utf8').trim()})`,
  )
} else {
  console.log(`Synced version to ${version}`)
}
