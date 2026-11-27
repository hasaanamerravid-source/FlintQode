/**
 * The editor comparison table and its two charts must describe the same set of
 * editors. This also keeps the IntelliJ IDEA figures sourced and its icon
 * monochrome.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const html = readFileSync(resolve(root, 'docs/requirements.html'), 'utf8')
const js = readFileSync(resolve(root, 'docs/assets/js/requirements.js'), 'utf8')

function chartLabels(name: string): string[] {
  const start = js.indexOf(`const ${name} = [`)
  assert.notEqual(start, -1, `${name} is missing`)
  const end = js.indexOf(']', start)
  return [...js.slice(start, end).matchAll(/label: '([^']+)'/g)].map((match) => match[1]!)
}

function tableEditors(): string[] {
  const start = html.indexOf('<th>Editor</th>')
  assert.notEqual(start, -1, 'the comparison table is missing')
  const end = html.indexOf('</table>', start)
  return [...html.slice(start, end).matchAll(/<\/svg> ([^<]+)<\/strong><\/td>/g)].map((match) =>
    match[1]!.replace(/ v\d+\.\d+\.\d+$/, ''),
  )
}

test('both comparison charts use the same editors as the table', () => {
  const expected = tableEditors()
  assert.ok(expected.length > 0)
  assert.deepEqual(chartLabels('RAM_ROWS'), expected)
  assert.deepEqual(chartLabels('SIZE_ROWS'), expected)
})

test('the IntelliJ IDEA comparison is sourced and monochrome', () => {
  assert.ok(tableEditors().includes('IntelliJ IDEA'))
  assert.ok(html.includes('welcome-screen RSS measurement'))
  assert.ok(html.includes('Windows installer size'))

  const icon = html.match(/<tr>\s*<td><strong>(<svg[\s\S]*?<\/svg>)\s*IntelliJ IDEA<\/strong>/)?.[1]
  assert.ok(icon, 'the IntelliJ IDEA icon is missing')
  assert.ok(icon.includes('stroke="currentColor"'))
  assert.equal(/#(?:[0-9a-f]{3}|[0-9a-f]{6})\b/i.test(icon), false)

  for (const id of ['ramChart', 'sizeChart']) {
    const container = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))
    assert.ok(container, `${id} is missing`)
    assert.ok(container![0].includes('IntelliJ IDEA'))
  }
})
