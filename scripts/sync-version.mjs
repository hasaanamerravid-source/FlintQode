#!/usr/bin/env node
/**
 * Single source of truth for the OpenNotes version.
 *
 * Reads the plain `VERSION` file and writes the version into every place
 * that carries one:
 *   - package.json
 *   - src-tauri/Cargo.toml
 *   - src-tauri/tauri.conf.json
 *
 * Usage: node scripts/sync-version.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const version = readFileSync(new URL('../VERSION', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')

// package.json — regex replace to preserve formatting
const pkgPath = new URL('../package.json', import.meta.url)
let pkg = readFileSync(pkgPath, 'utf8')
pkg = pkg.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
writeFileSync(pkgPath, pkg)

// src-tauri/Cargo.toml
const cargoPath = new URL('../src-tauri/Cargo.toml', import.meta.url)
let cargo = readFileSync(cargoPath, 'utf8')
cargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
writeFileSync(cargoPath, cargo)

// src-tauri/tauri.conf.json — regex replace to preserve formatting
const tauriPath = new URL('../src-tauri/tauri.conf.json', import.meta.url)
let tauri = readFileSync(tauriPath, 'utf8')
tauri = tauri.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`)
writeFileSync(tauriPath, tauri)

console.log(`Synced version to ${version}`)
