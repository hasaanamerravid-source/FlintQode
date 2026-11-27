/**
 * Regression tests for the native performance work.
 *
 * The Rust commands cannot be invoked from a Node unit test, so their hot
 * paths are pinned with source assertions. The renderer search store is
 * exercised for real: two overlapping queries must never show stale hits.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

/** Return the whole body of an `async fn`, so assertions cannot match a
 * neighbouring command that happens to use `spawn_blocking`. */
function commandBlock(code: string, name: string): string {
  const marker = `pub async fn ${name}(`
  const start = code.indexOf(marker)
  assert.notEqual(start, -1, `${name} must be a pub async fn`)

  let cursor = code.indexOf('{', start)
  assert.notEqual(cursor, -1, `${name} has no body`)
  let depth = 0
  for (; cursor < code.length; cursor += 1) {
    if (code[cursor] === '{') depth += 1
    if (code[cursor] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(start, cursor + 1)
    }
  }
  assert.fail(`${name} has no closing brace`)
}

const heavyCommands: Record<string, string[]> = {
  '../src-tauri/src/fs.rs': [
    'fs_exists_many',
    'fs_stat',
    'fs_exists',
    'fs_make_dir',
    'fs_remove',
    'fs_rename',
    'fs_copy_file',
    'fs_show_in_folder',
    'fs_read_text_file',
    'fs_write_text_file',
  ],
  '../src-tauri/src/store.rs': [
    'settings_load',
    'recent_list',
    'recent_add',
    'recent_clear',
    'plugins_list',
    'report_error',
  ],
}

for (const [path, names] of Object.entries(heavyCommands)) {
  test(`${path} heavy commands run on blocking workers`, () => {
    const code = source(path)
    for (const name of names) {
      const block = commandBlock(code, name)
      assert.match(block, /^pub async fn /, `${name} must be async`)
      assert.match(block, /spawn_blocking/, `${name} must not block the main thread`)
    }
  })
}

test('the native bridge exposes the batched exists command', () => {
  const fsCode = source('../src-tauri/src/fs.rs')
  assert.match(fsCode, /pub async fn fs_exists_many\(paths: Vec<String>\) -> Vec<bool>/)
  assert.ok(
    source('../src-tauri/src/lib.rs').includes('fs::fs_exists_many'),
    'fs_exists_many must be registered with Tauri',
  )
  assert.ok(
    source('../src/renderer/src/bridge.ts').includes(
      "existsMany: (paths: string[]) => call<boolean[]>('fs_exists_many', { paths })",
    ),
    'the renderer bridge must expose fs.existsMany',
  )
})

test('the text file reader keeps the 24 MB cap', () => {
  const code = source('../src-tauri/src/fs.rs')
  assert.ok(code.includes('const MAX_EDIT_BYTES: u64 = 24 * 1024 * 1024'))
  assert.match(code, /let limit = size\.min\(MAX_EDIT_BYTES\)/)
})

interface SearchMatchLike {
  path: string
  line: number
  column: number
  text: string
}

interface SearchResultLike {
  matches?: SearchMatchLike[]
  files?: number
  took?: number
  cancelled?: boolean
  error?: string
}

interface PendingSearch {
  request: { query?: string; generation?: number }
  resolve: (result: SearchResultLike) => void
}

const pending: PendingSearch[] = []
;(globalThis as unknown as { window: { api: unknown } }).window = {
  api: {
    fs: {
      search: (request: unknown) =>
        new Promise<SearchResultLike>((resolve) => {
          pending.push({ request: request as PendingSearch['request'], resolve })
        }),
      replaceInFiles: () => Promise.resolve({}),
    },
  },
}

const { useProjectSearchStore } = await import('../src/renderer/src/core/projectSearch')

test('project search sends a generation token and keeps its stale-reply guard', () => {
  const code = source('../src/renderer/src/core/projectSearch.ts')
  assert.match(code, /generation:\s*token/)
  assert.match(code, /if \(token !== sequence\) return/)
  assert.match(code, /result\?\.cancelled/)
})

test('two overlapping searches apply only the newest result', async () => {
  pending.length = 0
  const store = useProjectSearchStore
  store.getState().setQuery('old')
  const older = store.getState().search('/project')
  store.getState().setQuery('new')
  const newer = store.getState().search('/project')

  assert.equal(pending.length, 2)
  assert.equal(pending[0].request.query, 'old')
  assert.equal(pending[1].request.query, 'new')
  assert.ok((pending[1].request.generation ?? 0) > (pending[0].request.generation ?? 0))

  const newestHit = { path: '/project/new.ts', line: 1, column: 1, text: 'new hit' }
  pending[1].resolve({ matches: [newestHit], files: 1, took: 2 })
  await newer
  assert.deepEqual(store.getState().matches, [newestHit])

  const staleHit = { path: '/project/old.ts', line: 1, column: 1, text: 'old hit' }
  pending[0].resolve({ matches: [staleHit], files: 1, took: 1 })
  await older
  assert.deepEqual(store.getState().matches, [newestHit])
  assert.equal(store.getState().searching, false)
  assert.equal(store.getState().error, null)
})
