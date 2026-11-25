/**
 * Tests for the editor status counters.
 *
 * The old implementation called `trim()` and `match(/\S+/g)` on the whole
 * document for every keystroke. The replacement is a single pass plus a local
 * delta update, so these tests compare it against the original semantics.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countStats, statsAfterChange, type DocSlice } from '../src/renderer/src/core/editors'

function reference(text: string): { words: number; chars: number } {
  return { words: text.trim() ? (text.trim().match(/\S+/g) ?? []).length : 0, chars: text.length }
}

function docOf(text: string): DocSlice {
  return {
    length: text.length,
    sliceString: (from, to) => text.slice(from, to),
  }
}

const samples = ['', '   ', 'one', 'one two three', '  alpha\tbeta\n gamma delta  ', 'punctuation, symbols! and 42']

test('countStats has the same meaning as the old regex counter', () => {
  for (const text of samples) {
    assert.deepEqual(countStats(text), reference(text), JSON.stringify(text))
  }
})

test('a large document is counted without building a word array', () => {
  const text = Array.from({ length: 20_000 }, (_, index) => `line${index} value${index}`).join('\n')
  assert.deepEqual(countStats(text), reference(text))
})

const changes: Array<{ name: string; text: string; from: number; to: number; insert: string }> = [
  { name: 'type inside a word', text: 'alpha beta', from: 2, to: 2, insert: 'X' },
  { name: 'type a new word', text: 'alpha beta', from: 5, to: 5, insert: ' gamma' },
  { name: 'delete a letter', text: 'alpha beta', from: 3, to: 4, insert: '' },
  { name: 'delete a space and join words', text: 'alpha beta', from: 5, to: 6, insert: '' },
  { name: 'replace a word with whitespace', text: 'alpha beta', from: 6, to: 10, insert: '    ' },
  { name: 'insert at the start', text: 'alpha beta', from: 0, to: 0, insert: 'pre ' },
  { name: 'insert at the end', text: 'alpha beta', from: 10, to: 10, insert: ' tail' },
  { name: 'insert only whitespace', text: 'alpha beta', from: 0, to: 0, insert: '\n\t' },
  { name: 'replace the whole document', text: 'alpha beta', from: 0, to: 10, insert: 'one two three' },
]

test('incremental stats match a full recount after each change', () => {
  for (const change of changes) {
    const before = countStats(change.text)
    const after = statsAfterChange(before, docOf(change.text), {
      from: change.from,
      to: change.to,
      insert: change.insert,
    })
    const expectedText = change.text.slice(0, change.from) + change.insert + change.text.slice(change.to)
    assert.deepEqual(after, reference(expectedText), change.name)
  }
})

test('two sequential edits keep the count correct', () => {
  let text = 'alpha beta'
  let stats = countStats(text)
  const edits = [
    { from: 5, to: 5, insert: ' gamma' },
    { from: 0, to: 5, insert: 'delta ' },
  ]
  for (const edit of edits) {
    stats = statsAfterChange(stats, docOf(text), edit)
    text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
  }
  assert.deepEqual(stats, reference(text))
})
