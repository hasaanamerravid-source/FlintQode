/** Regression tests for find-all decorations. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { buildHighlightDecorations, MAX_HIGHLIGHT_MATCHES } from '../src/renderer/src/core/highlightAll'

function docOf(text: string) {
  return EditorState.create({ doc: text }).doc
}

test('a term highlights every occurrence in order', () => {
  const decorations = buildHighlightDecorations('needle', docOf('a needle b NEEDLE c'))
  assert.equal(decorations.size, 2)
})

test('an empty term creates no decorations', () => {
  assert.equal(buildHighlightDecorations(null, docOf('abc')).size, 0)
  assert.equal(buildHighlightDecorations('', docOf('abc')).size, 0)
})

test('a document with too many matches is capped', () => {
  const text = Array.from({ length: MAX_HIGHLIGHT_MATCHES + 50 }, () => 'needle').join(' ')
  const decorations = buildHighlightDecorations('needle', docOf(text))
  assert.equal(decorations.size, MAX_HIGHLIGHT_MATCHES)
})
