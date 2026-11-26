#!/usr/bin/env node
/**
 * Repeatable baseline for the renderer hot paths.
 *
 * Run with: npm run perf:baseline -- --write
 *
 * The fixture is deterministic: 10,000 lines of realistic code, close to 1 MB.
 * It measures the pure functions behind status updates, find-all highlighting
 * and indent guides. The HTML fixture measures the work that v1.5.1 removed
 * from the per-keystroke path in large markup files.
 */

import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { EditorState } from '@codemirror/state'
import { countStats, statsAfterChange } from '../src/renderer/src/core/editors'
import { buildHighlightDecorations } from '../src/renderer/src/core/highlightAll'
import { buildGuides } from '../src/renderer/src/core/indentGuides'

const LINES = 10_000
const TARGET_BYTES = 1_000_000
const TERM = 'item'

function fixture() {
  const parts = []
  let bytes = 0
  for (let index = 1; index <= LINES && bytes < TARGET_BYTES; index++) {
    const indent = '  '.repeat(index % 4)
    const line = `${indent}const item${index} = computeValue(${index}); // keep line ${index} long enough for the fixture\n`
    parts.push(line)
    bytes += line.length
  }
  return parts.join('')
}

function round(value) {
  return Math.round(value * 100) / 100
}

function measure(name, run, iterations = 7) {
  // Warm the path once so the reported numbers exclude first-call setup.
  run()
  const samples = []
  for (let index = 0; index < iterations; index++) {
    const started = performance.now()
    const result = run()
    samples.push(performance.now() - started)
    // Keep the JIT from treating the work as dead code.
    globalThis.__perfBaselineSink = result
  }
  samples.sort((a, b) => a - b)
  return {
    name,
    iterations,
    minMs: round(samples[0]),
    medianMs: round(samples[Math.floor(samples.length / 2)]),
    p95Ms: round(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]),
  }
}

/** Run the operation many times per sample and report microseconds per call. */
function measurePerOperation(name, run, operations = 2_000, iterations = 7) {
  run()
  const samples = []
  for (let index = 0; index < iterations; index++) {
    const started = performance.now()
    for (let operation = 0; operation < operations; operation++) {
      globalThis.__perfBaselineSink = run()
    }
    samples.push(((performance.now() - started) * 1_000) / operations)
  }
  samples.sort((a, b) => a - b)
  return {
    name,
    operations,
    iterations,
    minUs: round(samples[0]),
    medianUs: round(samples[Math.floor(samples.length / 2)]),
    p95Us: round(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]),
  }
}

/** Markup with attributes and nesting, close to a real 1 MB HTML file. */
function htmlFixture() {
  const parts = ['<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n']
  let bytes = parts[0].length
  for (let index = 1; index <= LINES && bytes < TARGET_BYTES; index++) {
    const line = `<section class="item item-${index}" data-index="${index}"><h2 id="title-${index}">Item ${index}</h2><p class="copy">Measured HTML fixture line ${index} with enough text to look like a real document.</p></section>\n`
    parts.push(line)
    bytes += line.length
  }
  parts.push('</body>\n</html>\n')
  return parts.join('')
}

const text = fixture()
const state = EditorState.create({ doc: text })
const guideState = { doc: { lines: state.doc.lines, line: (number) => state.doc.line(number) } }

const htmlText = htmlFixture()
const htmlState = EditorState.create({ doc: htmlText })
const htmlStats = countStats(htmlText)
const htmlEdit = Math.floor(htmlState.doc.length / 2)

const report = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  fixture: { lines: state.doc.lines, bytes: text.length, term: TERM },
  measurements: [
    measure('countStats: full document', () => countStats(text)),
    measure('highlightAll: all occurrences', () => buildHighlightDecorations(TERM, state.doc)),
    measure('indentGuides: full document', () => buildGuides(guideState, 2)),
  ],
  html: {
    fixture: { kind: 'html', lines: htmlState.doc.lines, bytes: htmlText.length },
    measurements: [
      measure('full document copy (removed from the keystroke path)', () => htmlState.doc.toString()),
      measurePerOperation('statsAfterChange: one typed character (keystroke path)', () =>
        statsAfterChange(htmlStats, htmlState.doc, { from: htmlEdit, to: htmlEdit, insert: 'x' }),
      ),
    ],
  },
}

console.log(JSON.stringify(report, null, 2))

if (process.argv.includes('--write')) {
  const outputIndex = process.argv.indexOf('--output')
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : '../docs/maintenance/perf-baseline.json'
  writeFileSync(new URL(output, import.meta.url), `${JSON.stringify(report, null, 2)}\n`)
}
