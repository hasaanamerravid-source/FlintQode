#!/usr/bin/env node
/**
 * Refresh the data behind the website's Stats tab.
 *
 * GitHub's traffic API (views and clones) needs an authenticated token with
 * Administration:read. Release download counts are public. When traffic data
 * cannot be fetched, the previous snapshot is kept so the page never loses its
 * graphs; downloads are always refreshed.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = 'hasaanamerravid-source/FlintQode'
const output = resolve(root, 'docs/assets/data/stats.json')
const token = process.env.STATS_TOKEN || process.env.GITHUB_TOKEN || ''

async function github(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json()
}

function previousData() {
  try {
    return JSON.parse(readFileSync(output, 'utf8'))
  } catch {
    return {}
  }
}

function emptyTraffic() {
  return {
    views: { count: 0, uniques: 0, days: [] },
    clones: { count: 0, uniques: 0, days: [] },
  }
}

function toTraffic(views, clones) {
  const series = (entries) =>
    entries.map((entry) => ({
      date: String(entry.timestamp).slice(0, 10),
      count: entry.count,
      uniques: entry.uniques,
    }))
  return {
    views: { count: views.count, uniques: views.uniques, days: series(views.views) },
    clones: { count: clones.count, uniques: clones.uniques, days: series(clones.clones) },
  }
}

function toReleases(releases) {
  return releases
    .filter((release) => !release.draft)
    .map((release) => ({
      tag: release.tag_name,
      date: release.published_at || release.created_at,
      total: release.assets.reduce((sum, asset) => sum + asset.download_count, 0),
      assets: release.assets
        .map((asset) => ({ name: asset.name, downloads: asset.download_count }))
        .sort((a, b) => b.downloads - a.downloads),
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
}

const previous = previousData()
const releases = await github('/releases?per_page=100')
let traffic = previous.traffic ?? emptyTraffic()
let trafficUpdated = false
let trafficError = null

if (!token) {
  trafficError = 'no token configured'
} else {
  try {
    traffic = toTraffic(await github('/traffic/views'), await github('/traffic/clones'))
    trafficUpdated = true
  } catch (error) {
    trafficError = error instanceof Error ? error.message : String(error)
  }
}

const allReleases = toReleases(releases)
const data = {
  updatedAt: new Date().toISOString(),
  repository,
  trafficUpdated,
  trafficError,
  traffic,
  downloads: {
    total: allReleases.reduce((sum, release) => sum + release.total, 0),
    releases: allReleases,
    latest: allReleases[0] ?? null,
  },
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`)
console.log(
  `Stats refreshed: ${data.downloads.total} downloads, ` +
    `${traffic.views.count} views, ${traffic.clones.count} clones` +
    (trafficError ? ` (traffic kept from previous snapshot: ${trafficError})` : ''),
)
