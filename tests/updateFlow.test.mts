/**
 * Regression tests for the update button flow.
 *
 * The original handler called window.confirm() and awaited native commands on
 * the renderer thread, which made the app look frozen. The flow now lives in
 * a small module with injected dependencies so every step can be checked.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runUpdateFlow, updateDestination, type UpdateApi } from '../src/renderer/src/core/updateFlow'

interface Params {
  version?: string
  error?: string
}

const text = (key: string, params?: Params) => {
  const value = params?.version ?? params?.error
  return value ? `${key}:${value}` : key
}

const CHECKSUM = 'a'.repeat(64)

function setup(overrides: Partial<UpdateApi> = {}) {
  const calls: string[] = []
  const statuses: string[] = []
  const questions: string[] = []
  const busyStates: boolean[] = []
  const answers: boolean[] = []
  const checksums: string[] = []

  const api: UpdateApi = {
    info: async () =>
      ({
        version: '1.4.7',
        temp: '/tmp/opencode/',
      }) as Awaited<ReturnType<UpdateApi['info']>>,
    checkUpdate: async () => ({
      version: '1.4.8',
      url: 'https://example.test/update.deb',
      assetName: 'update.deb',
      sha256: CHECKSUM,
    }),
    downloadUpdate: async (_url, _destination, sha256) => {
      calls.push('download')
      checksums.push(sha256)
      return '/tmp/opencode/flintqode-update.deb'
    },
    installUpdate: async (_path, sha256) => {
      calls.push('install')
      checksums.push(sha256)
      return 'ok'
    },
    ...overrides,
  }

  const deps = {
    api,
    confirm: async (_title: string, message: string) => {
      questions.push(message)
      return answers.shift() ?? false
    },
    text: text as never,
    status: (value: string) => statuses.push(value),
    busy: (value: boolean) => busyStates.push(value),
  }

  return { calls, statuses, questions, busyStates, answers, checksums, deps }
}

test('the temp path is normalized before the download', () => {
  assert.equal(updateDestination('/tmp/opencode/'), '/tmp/opencode/flintqode-update.deb')
  assert.equal(updateDestination(''), '/tmp/flintqode-update.deb')
  assert.equal(updateDestination('C:\\Temp\\'), 'C:\\Temp/flintqode-update.deb')
})

test('an up-to-date app never asks or downloads', async () => {
  const { deps, calls, statuses } = setup({ checkUpdate: async () => null })
  await runUpdateFlow(deps)
  assert.deepEqual(calls, [])
  assert.equal(statuses.at(-1), 'settings.updatesUpToDate')
})

test('the checksum is passed to both native download and install', async () => {
  const { deps, calls, answers, questions, statuses, busyStates, checksums } = setup()
  answers.push(true, true)
  await runUpdateFlow(deps)
  assert.deepEqual(calls, ['download', 'install'])
  assert.deepEqual(checksums, [CHECKSUM, CHECKSUM])
  assert.equal(statuses.at(-1), 'settings.updatesInstalled')
  assert.ok(questions.includes('settings.updatesDownloadPrompt:1.4.8'))
  assert.equal(busyStates.at(-1), false)
})

test('declining the download stops before any native download', async () => {
  const { deps, calls, answers } = setup()
  answers.push(false)
  await runUpdateFlow(deps)
  assert.deepEqual(calls, [])
})

test('declining the install stops after the download', async () => {
  const { deps, calls, answers } = setup()
  answers.push(true, false)
  await runUpdateFlow(deps)
  assert.deepEqual(calls, ['download'])
})

test('a release without a checksum is never downloaded', async () => {
  const { deps, calls, statuses, answers } = setup({
    checkUpdate: async () => ({
      version: '1.4.8',
      url: 'https://example.test/update.deb',
      assetName: 'update.deb',
      sha256: '',
    }),
  })
  answers.push(true)
  await runUpdateFlow(deps)
  assert.deepEqual(calls, [])
  assert.ok(statuses.at(-1)?.includes('settings.updatesChecksumMissing'))
  assert.ok(statuses.at(-1)?.includes('settings.updatesFailed:'))
})

test('a native failure is shown with next steps and the button is released', async () => {
  const { deps, busyStates, statuses, answers } = setup({
    downloadUpdate: async () => {
      throw new Error('network down')
    },
  })
  answers.push(true)
  await runUpdateFlow(deps)
  assert.equal(statuses.at(-1), 'settings.updatesFailed:network down settings.updatesFailedHint')
  assert.equal(busyStates.at(-1), false)
})
