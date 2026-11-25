/**
 * Regression tests for the built-in problem rules.
 *
 * FlintQode used to warn about every line longer than 120 characters. The
 * warning could not be turned off and came back after every keystroke, so it
 * is now an optional rule that is off by default.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Text } from '@codemirror/state'
import type { DiagnosticSettings } from '../src/shared/types'
import { collectLineProblems, resolveDiagnostics } from '../src/renderer/src/core/diagnostics'
import { DEFAULT_DIAGNOSTICS, mergeDiagnostics } from '../src/renderer/src/core/defaults'

function problemsOf(line: string, language = 'plaintext') {
  const doc = Text.of([`${line}\n`, ''])
  return collectLineProblems(doc, doc.toString(), language)
}

function config(partial: Partial<DiagnosticSettings> = {}): DiagnosticSettings {
  return mergeDiagnostics(partial as DiagnosticSettings)
}

test('a long line is not a problem by default', () => {
  const problems = problemsOf('x'.repeat(200))
  assert.equal(
    problems.some((problem) => problem.source === 'lineLength'),
    false,
  )
  assert.equal(problems.length, 0)
})

test('the other line rules still report problems', () => {
  const problems = problemsOf('value   \nmore')
  assert.ok(problems.some((problem) => problem.source === 'whitespace'))
})

test('enabling the line-length rule reports only lines above the limit', () => {
  const doc = Text.of(['short', 'x'.repeat(120), 'y'.repeat(121), ''])
  const problems = collectLineProblems(doc, doc.toString(), 'plaintext', { lineLength: true, limit: 120 })
  const longLines = problems.filter((problem) => problem.source === 'lineLength')
  assert.equal(longLines.length, 1)
  assert.equal(longLines[0].line, 3)
  assert.equal(longLines[0].severity, 'warning')
  assert.match(longLines[0].message, /121 characters; limit is 120/)
})

test('the line-length limit is configurable', () => {
  const doc = Text.of([`${'x'.repeat(80)}`, ''])
  const strict = collectLineProblems(doc, doc.toString(), 'plaintext', { lineLength: true, limit: 40 })
  const relaxed = collectLineProblems(doc, doc.toString(), 'plaintext', { lineLength: true, limit: 100 })
  assert.equal(strict.filter((problem) => problem.source === 'lineLength').length, 1)
  assert.equal(relaxed.filter((problem) => problem.source === 'lineLength').length, 0)
})

test('disabling a line rule removes its problems immediately', () => {
  const doc = Text.of(['value   \nmore'])
  const text = doc.toString()
  assert.ok(collectLineProblems(doc, text, 'plaintext').some((problem) => problem.source === 'whitespace'))
  assert.equal(
    collectLineProblems(doc, text, 'plaintext', { whitespace: false }).some(
      (problem) => problem.source === 'whitespace',
    ),
    false,
  )
  assert.ok(collectLineProblems(doc, text, 'plaintext', { eof: false }).every((problem) => problem.source !== 'eof'))
})

test('settings default to the v1.4.7 behaviour', () => {
  const resolved = resolveDiagnostics(undefined, 'plaintext')
  assert.equal(resolved.enabled.lineLength, false)
  assert.equal(resolved.lineLengthLimit, 120)
  for (const rule of Object.keys(DEFAULT_DIAGNOSTICS.rules) as (keyof typeof DEFAULT_DIAGNOSTICS.rules)[]) {
    if (rule !== 'lineLength') assert.equal(resolved.enabled[rule], true)
  }
})

test('a language override replaces only the rules it names', () => {
  const settings = config({
    rules: { ...DEFAULT_DIAGNOSTICS.rules, todo: { enabled: false } },
    languages: { python: { lineLength: { enabled: true, limit: 79 }, whitespace: { enabled: false } } },
  })
  const python = resolveDiagnostics(settings, 'python')
  const json = resolveDiagnostics(settings, 'json')
  assert.equal(python.enabled.lineLength, true)
  assert.equal(python.lineLengthLimit, 79)
  assert.equal(python.enabled.whitespace, false)
  assert.equal(python.enabled.todo, false)
  assert.equal(json.enabled.lineLength, false)
  assert.equal(json.enabled.whitespace, true)
  assert.equal(json.enabled.todo, false)
})

test('partial stored settings are merged without losing enabled flags', () => {
  const settings = mergeDiagnostics({
    rules: { lineLength: { limit: 100 } } as never,
    languages: { java: { lineLength: { limit: 90 } } } as never,
  })
  const java = resolveDiagnostics(settings, 'java')
  assert.equal(java.lineLengthLimit, 90)
  assert.equal(resolveDiagnostics(settings, 'plaintext').lineLengthLimit, 100)
  assert.equal(settings.rules.syntax.enabled, true)
})
