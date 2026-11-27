/**
 * Regression tests for the search and explorer performance fixes.
 *
 * The native project search can return up to 2000 hits; rendering all of them
 * as buttons made the results view slow. Explorer filtering, on the other
 * hand, re-cased the filter and every file name on each keystroke. These tests
 * pin the paging and lowercasing helpers used by both views.
 */
import { register } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { DirEntry } from '../src/shared/types'
import type { ProjectMatch } from '../src/renderer/src/core/projectSearch'

// The helpers live beside their views. Under the test loader the TSX is
// compiled with an automatic JSX runtime; the component bodies are never run,
// so an inert runtime is enough to import the modules without a DOM.
const jsxShim = `export const jsx = () => null
export const jsxs = () => null
export const Fragment = Symbol('Fragment')`
const jsxShimUrl = `data:text/javascript,${encodeURIComponent(jsxShim)}`
const jsxHook = `export function resolve(specifier, context, nextResolve) {
  if (specifier === 'react/jsx-runtime') return { url: ${JSON.stringify(jsxShimUrl)}, shortCircuit: true }
  return nextResolve(specifier, context)
}`
register(`data:text/javascript,${encodeURIComponent(jsxHook)}`, import.meta.url)

const { SEARCH_RESULT_PAGE_SIZE, groupMatches, limitGroups } =
  await import('../src/renderer/src/workbench/views/SearchView')
const { createLowercaseNameLookup, matchesFilter, filterRootEntries } =
  await import('../src/renderer/src/workbench/views/ExplorerView')

function hitsIn(files: [path: string, count: number][]): ProjectMatch[] {
  const hits: ProjectMatch[] = []
  for (const [path, count] of files) {
    for (let line = 1; line <= count; line += 1) {
      hits.push({ path, line, column: 1, text: `line ${line}` })
    }
  }
  return hits
}

function entry(name: string, isDir = false): DirEntry {
  return { name, path: `/${name}`, isDir, size: 0, mtime: 0 }
}

test('search results start at a 200 hit cap and showing more keeps every group', () => {
  const all = hitsIn([
    ['a.ts', 120],
    ['b.ts', 90],
    ['c.ts', 40],
  ])
  const groups = groupMatches(all)

  assert.equal(SEARCH_RESULT_PAGE_SIZE, 200)
  assert.deepEqual(
    groups.map(([path]) => path),
    ['a.ts', 'b.ts', 'c.ts'],
  )

  const initial = limitGroups(groups, SEARCH_RESULT_PAGE_SIZE)
  assert.equal(
    initial.reduce((count, [, hits]) => count + hits.length, 0),
    200,
  )
  assert.deepEqual(
    initial.map(([path]) => path),
    ['a.ts', 'b.ts'],
  )
  // Hits are the original objects, in their original order.
  assert.ok(initial.flatMap(([, hits]) => hits).every((hit, index) => hit === all[index]))
  assert.deepEqual(initial[1][1], all.slice(120, 200))

  const expanded = limitGroups(groups, SEARCH_RESULT_PAGE_SIZE * 2)
  assert.equal(
    expanded.reduce((count, [, hits]) => count + hits.length, 0),
    all.length,
  )
  assert.deepEqual(
    expanded.map(([path]) => path),
    ['a.ts', 'b.ts', 'c.ts'],
  )
  assert.deepEqual(
    expanded.flatMap(([, hits]) => hits),
    all,
  )
  // Raising the cap does not drop previously rendered hits.
  assert.deepEqual(expanded[1][1].slice(0, 80), initial[1][1])

  // A single large file is capped inside its own group as well.
  const single = limitGroups(groupMatches(hitsIn([['one.ts', 300]])), SEARCH_RESULT_PAGE_SIZE)
  assert.equal(single.length, 1)
  assert.equal(single[0][1].length, 200)
})

test('explorer lowercases a name once per entry across repeated queries', () => {
  let reads = 0
  const counted: DirEntry = {
    get name() {
      reads += 1
      return 'README.MD'
    },
    path: '/README.MD',
    isDir: false,
    size: 0,
    mtime: 0,
  }
  const lowercase = createLowercaseNameLookup()

  for (const query of ['read', 'MD', 'missing', '']) {
    const needle = query.toLowerCase()
    filterRootEntries([counted], needle, lowercase)
    matchesFilter(counted, needle, lowercase)
  }
  assert.equal(reads, 1)

  assert.equal(lowercase(counted), 'readme.md')
  assert.equal(lowercase(entry('SRC')), 'src')
  assert.equal(lowercase(counted), 'readme.md')
  assert.equal(reads, 1)
})

test('explorer filtering stays case-insensitive and keeps directories', () => {
  const entries = [entry('Src', true), entry('README.MD'), entry('index.ts'), entry('notes.md')]
  const lowercase = createLowercaseNameLookup()
  const namesFor = (query: string) =>
    filterRootEntries(entries, query.toLowerCase(), lowercase).map((item) => item.name)

  assert.deepEqual(namesFor(''), ['Src', 'README.MD', 'index.ts', 'notes.md'])
  assert.deepEqual(namesFor('MD'), ['Src', 'README.MD', 'notes.md'])
  assert.deepEqual(namesFor('ts'), ['Src', 'index.ts'])
  assert.deepEqual(namesFor('read'), ['Src', 'README.MD'])
  assert.deepEqual(namesFor('missing'), ['Src'])

  // Child nodes use the same needle and lookup as the root list.
  assert.equal(matchesFilter(entry('CHILD.MD'), 'md', lowercase), true)
  assert.equal(matchesFilter(entry('CHILD.MD'), 'ts', lowercase), false)
  assert.equal(matchesFilter(entry('Empty', true), '', lowercase), true)
})
