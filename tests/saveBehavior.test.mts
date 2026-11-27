/** Regression tests for the opt-in save settings. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveTargetOnBlur, shouldSaveAllBeforeRun } from '../src/renderer/src/core/saveBehavior'

const tabs = [
  { id: 'a', path: '/work/a.txt', dirty: true },
  { id: 'b', path: '/work/b.txt', dirty: false },
  { id: 'c', path: null, dirty: true },
]

test('save-before-run is strictly opt-in', () => {
  assert.equal(shouldSaveAllBeforeRun({}), false)
  assert.equal(shouldSaveAllBeforeRun({ saveAllBeforeRun: false }), false)
  assert.equal(shouldSaveAllBeforeRun({ saveAllBeforeRun: true }), true)
})

test('blur only saves a dirty active file that has a path', () => {
  assert.equal(saveTargetOnBlur({ saveOnBlur: true }, tabs, 'a'), 'a')
  assert.equal(saveTargetOnBlur({ saveOnBlur: true }, tabs, 'b'), null)
  assert.equal(saveTargetOnBlur({ saveOnBlur: true }, tabs, 'c'), null)
})

test('blur does nothing when the setting is off or there is no active tab', () => {
  assert.equal(saveTargetOnBlur({}, tabs, 'a'), null)
  assert.equal(saveTargetOnBlur({ saveOnBlur: false }, tabs, 'a'), null)
  assert.equal(saveTargetOnBlur({ saveOnBlur: true }, tabs, null), null)
})
