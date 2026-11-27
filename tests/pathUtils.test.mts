/** Regression tests for active-file path commands. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { relativeToWorkspace } from '../src/renderer/src/core/pathUtils'

test('a file inside the workspace gets a relative path', () => {
  assert.equal(relativeToWorkspace('/work/project/src/main.ts', '/work/project'), 'src/main.ts')
})

test('Windows paths work with either slash style and mixed case drives', () => {
  assert.equal(relativeToWorkspace('C:\\Work\\App\\src\\Main.ts', 'c:/work/app'), 'src/Main.ts')
})

test('a file outside the workspace has no relative path', () => {
  assert.equal(relativeToWorkspace('/elsewhere/notes.txt', '/work/project'), null)
})

test('a missing file or workspace has no relative path', () => {
  assert.equal(relativeToWorkspace(null, '/work/project'), null)
  assert.equal(relativeToWorkspace('/work/project/src/main.ts', null), null)
})

test('the workspace folder itself is the current directory', () => {
  assert.equal(relativeToWorkspace('/work/project/', '/work/project'), '.')
})
