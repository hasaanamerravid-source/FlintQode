/** Regression tests for the selection commands. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandToLine, expandToWord, findAllMatches, wordRangeAt } from '../src/renderer/src/core/selectionTools'

test('the word at a caret is selected', () => {
  assert.deepEqual(wordRangeAt('hello world', 2), { from: 0, to: 5 })
  assert.deepEqual(wordRangeAt('hello world', 5), { from: 0, to: 5 })
})

test('a partial word selection grows to the whole word', () => {
  assert.deepEqual(expandToWord('hello world', 1, 3), { from: 0, to: 5 })
})

test('a selection across words covers both words', () => {
  assert.deepEqual(expandToWord('hello world', 2, 8), { from: 0, to: 11 })
})

test('a caret on punctuation has no word', () => {
  assert.equal(wordRangeAt('a + b', 2), null)
})

test('a selection grows to whole lines', () => {
  assert.deepEqual(expandToLine('one\ntwo\nthree', 4, 5), { from: 4, to: 7 })
  assert.deepEqual(expandToLine('one\ntwo', 0, 3), { from: 0, to: 3 })
})

test('CRLF line endings are not selected', () => {
  assert.deepEqual(expandToLine('one\r\ntwo', 0, 1), { from: 0, to: 3 })
})

test('every literal match is found in order', () => {
  assert.deepEqual(findAllMatches('a.b a.b', 'a.b'), [
    { from: 0, to: 3 },
    { from: 4, to: 7 },
  ])
  assert.deepEqual(findAllMatches('abc', ''), [])
})
