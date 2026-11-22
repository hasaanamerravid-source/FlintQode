/**
 * Run panel: shows the output of the process that was started for a file.
 */

import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { useRunStore } from '@/core/runState'
import { useT } from '../../core/i18n'
import { getEditor } from '../../core/editors'
import { useAppStore } from '../../store/app'

export interface RunPanelProps {
  /** Start a run (the active file is used when this is not given). */
  onRun?: () => void
  /** Stop the running process. */
  onStop?: () => void
}

/** The last part of a path (the file name). */
function fileName(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] || filePath
}

export function RunPanel({ onRun, onStop }: RunPanelProps): JSX.Element {
  const running = useRunStore((s) => s.running)
  const filePath = useRunStore((s) => s.filePath)
  const lines = useRunStore((s) => s.lines)
  const exitCode = useRunStore((s) => s.exitCode)
  const stop = useRunStore((s) => s.stop)
  const clear = useRunStore((s) => s.clear)
  const logRef = useRef<HTMLDivElement | null>(null)
  const t = useT()

  // Follow the output: the newest line stays in sight.
  useEffect(() => {
    const element = logRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines])

  const handleRun = (): void => {
    if (onRun) {
      onRun()
      return
    }
    // Save first (a prompt appears for an untitled buffer), then start.
    void import('@/core/runState').then(({ runActiveFile }) => runActiveFile())
  }

  const handleStop = (): void => {
    if (onStop) {
      onStop()
      return
    }
    stop()
  }

  const status = !running && exitCode !== null ? t('panel.runExited', { code: exitCode }) : ''

  /** Jump to `file:line:col` / `file(line, col)` patterns, the way VS Code does. */
  const jumpToMatch = (text: string): void => {
    const state = useAppStore.getState()
    const tab = state.tabs.find((t) => t.id === state.activeTabId)
    const activeName = tab?.name ?? ''
    // Match "file.ts:12:7", "file.py:12", "file.js(12, 7)", "path/file.java:3".
    const match = text.match(/([^\s:]+\.[A-Za-z0-9_+-]+)(?::(\d+)(?::(\d+))?|\(\s*(\d+)\s*,\s*(\d+)\s*\))?/)
    if (!match) return
    const fileName = match[1].split(/[\\/]/).pop() ?? match[1]
    const line = Number(match[2] ?? match[4] ?? 1) || 1
    const col = Number(match[3] ?? match[5] ?? 1) || 1
    const editor = getEditor(tab?.id ?? '')
    if (!editor) return
    // If the error is about the active file, jump directly.
    if (fileName === activeName) {
      editor.goToLine(line)
      return
    }
    // Otherwise open the referenced file if it exists and jump to the line.
    void window.api.fs
      .exists(match[1])
      .then(async (exists) => {
        if (exists) await state.openPath(match[1])
      })
      .then(() => {
        const newTab = useAppStore.getState().tabs.find((t) => t.name === fileName && t.id !== tab?.id)
        if (newTab) getEditor(newTab.id)?.goToLine(line)
      })
      .catch(() => {
        // Fall back to the active file at the parsed line.
        editor.goToLine(line)
      })
  }

  return (
    <div className="panel run-panel">
      <div className="panel-header">
        <span className="panel-title">{t('panel.run')}</span>
        <span className="panel-subtitle" title={filePath ?? undefined}>
          {filePath ? fileName(filePath) : t('panel.runNoProcess')}
        </span>
        <span className="run-actions" style={{ display: 'flex', gap: '4px' }}>
          <button className="panel-button" type="button" onClick={handleRun} disabled={running}>
            {t('panel.runRerun')}
          </button>
          <button className="panel-button" type="button" onClick={handleStop} disabled={!running}>
            {t('panel.runStop')}
          </button>
          <button className="panel-button" type="button" onClick={clear} disabled={lines.length === 0}>
            {t('common.clear')}
          </button>
        </span>
      </div>
      <div className="panel-body">
        {lines.length === 0 ? (
          <div className="empty-state panel-empty">{t('panel.runEmpty')}</div>
        ) : (
          <div
            className="run-log"
            ref={logRef}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              lineHeight: 1.45,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              overflow: 'auto',
              minHeight: 0,
              flex: 1,
            }}
          >
            {lines.map((line, index) => (
              <div
                className={`run-line run-line-${line.type}`}
                key={`${index}-${line.type}`}
                title={t('panel.runClickJump')}
                style={{
                  color:
                    line.type === 'stderr'
                      ? 'var(--danger)'
                      : line.type === 'system'
                        ? 'var(--fg-muted)'
                        : 'var(--fg-dim)',
                  cursor: 'pointer',
                }}
                onClick={() => jumpToMatch(line.text)}
              >
                {line.text}
              </div>
            ))}
          </div>
        )}
        {status ? (
          <div
            className="run-status panel-subtitle"
            style={{ color: exitCode === 0 ? 'var(--fg-muted)' : 'var(--danger)' }}
          >
            {status}
          </div>
        ) : null}
      </div>
    </div>
  )
}
