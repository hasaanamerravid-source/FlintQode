/** Regression tests for viewport-limited indent guides. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { buildGuides } from '../src/renderer/src/core/indentGuides'

test('a full build adds guides only for indented lines', () => {
  const state = EditorState.create({ doc: 'plain\n  nested\n    deep' })
  assert.equal(buildGuides(state, 2).length, 2)
})

test('a visible-range build ignores lines outside the viewport', () => {
  const state = EditorState.create({ doc: 'plain\n  nested\n    deep' })
  const line = state.doc.line(3)
  const marks = buildGuides(state, 2, [{ from: line.from, to: line.to }])
  assert.equal(marks.length, 1)
  assert.equal(marks[0].from, line.from)
})

test('overlapping visible ranges do not duplicate a guide', () => {
  const state = EditorState.create({ doc: '  nested\n    deep' })
  const first = state.doc.line(1)
  const second = state.doc.line(2)
  const marks = buildGuides(state, 2, [
    { from: first.from, to: second.to },
    { from: second.from, to: second.to },
  ])
  assert.equal(marks.length, 2)
})
