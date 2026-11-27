/** Regression tests for workspace recall. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastWorkspace, rememberWorkspace } from '../src/renderer/src/core/recentWorkspaces'

test('the newest workspace comes first', () => {
  assert.deepEqual(rememberWorkspace(['/a', '/b'], '/c'), ['/c', '/a', '/b'])
})

test('reopening a workspace moves it to the front once', () => {
  assert.deepEqual(rememberWorkspace(['/a', '/b', '/c'], '/b'), ['/b', '/a', '/c'])
})

test('the list is capped', () => {
  const recent = Array.from({ length: 12 }, (_, index) => `/w${index}`)
  assert.equal(rememberWorkspace(recent, '/new').length, 10)
})

test('an empty folder leaves the list alone', () => {
  assert.deepEqual(rememberWorkspace(['/a'], null), ['/a'])
})

test('the last workspace is the first entry', () => {
  assert.equal(lastWorkspace({ recentWorkspaces: ['/b', '/a'] }), '/b')
  assert.equal(lastWorkspace({}), null)
})
