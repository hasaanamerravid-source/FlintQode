/**
 * Regression tests for the built-in problem rules.
 *
 * FlintQode used to warn about every line longer than 120 characters. The
 * warning could not be turned off and came back after every keystroke, so it
 * is no longer part of the built-in diagnostics.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Text } from '@codemirror/state'
import { collectLineProblems } from '../src/renderer/src/core/diagnostics'

function problemsOf(line: string, language = 'plaintext') {
  const doc = Text.of([`${line}\n`, ''])
  return collectLineProblems(doc, doc.toString(), language)
}

test('a long line is not a problem', () => {
  const problems = problemsOf('x'.repeat(200))
  assert.equal(
    problems.some((problem) => problem.source === 'line-length'),
    false,
  )
  assert.equal(problems.length, 0)
})

test('the other line rules still report problems', () => {
  const problems = problemsOf('value   \nmore')
  assert.ok(problems.some((problem) => problem.source === 'whitespace'))
})
