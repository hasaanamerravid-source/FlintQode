/**
 * Terminal panel: the interactive shells, with a tab strip for multiple tabs.
 *
 * Each tab is its own PTY on the main process; the panel only draws the
 * current one and routes input to it.
 */

import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { useTerminalStore, type TerminalSession } from '@/core/terminalState'
import { useAppStore } from '@/store/app'
import { useT } from '../../core/i18n'

export interface TerminalPanelProps {
  /** The folder the shell should run in (the folder of the active file). */
  cwd?: string
}

function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Windows/i.test(navigator.userAgent)
}

function folderName(folder: string): string {
  const parts = folder.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? folder
}

function lineColor(type: string): string {
  if (type === 'stderr') return 'var(--danger)'
  if (type === 'system') return 'var(--fg-muted)'
  if (type === 'input') return 'var(--accent)'
  return 'var(--fg-dim)'
}

export function TerminalPanel({ cwd }: TerminalPanelProps): JSX.Element {
  const sessions = useTerminalStore((s) => s.sessions)
  const activeId = useTerminalStore((s) => s.activeId)
  const session = useTerminalStore((s) => s.getActive())
  const start = useTerminalStore((s) => s.start)
  const write = useTerminalStore((s) => s.write)
  const interrupt = useTerminalStore((s) => s.interrupt)
  const stop = useTerminalStore((s) => s.stop)
  const close = useTerminalStore((s) => s.close)
  const clear = useTerminalStore((s) => s.clear)
  const switchSession = useTerminalStore((s) => s.switch)
  const newSession = useTerminalStore((s) => s.create)
  const historyPrev = useTerminalStore((s) => s.historyPrev)
  const historyNext = useTerminalStore((s) => s.historyNext)

  const [value, setValue] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const logRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const t = useT()

  const lines = session?.lines ?? []
  const running = session?.running ?? false
  const busy = session?.busy ?? false
  const folder = session?.cwd || cwd || ''

  const windows = isWindows()
  const prompt = windows ? (folder ? `PS ${folder}>` : 'PS>') : '$ '

  // Follow the output of the active tab.
  useEffect(() => {
    const element = logRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines])

  useEffect(() => {
    if (session?.running) inputRef.current?.focus()
  }, [session?.running])

  const handleSubmit = (): void => {
    const command = value
    if (!command.trim()) return
    setValue('')
    if (session) write(session.id, command)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!session) return
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSubmit()
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      const previous = historyPrev(session.id)
      if (previous !== null) setValue(previous)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = historyNext(session.id)
      setValue(next ?? '')
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setValue('')
      return
    }
    if (event.key === 'c' && event.ctrlKey && value === '' && running) {
      event.preventDefault()
      interrupt(session.id)
    }
  }

  const handleNew = (): void => {
    setValue('')
    void newSession(folder || cwd, undefined)
  }

  const handleRename = (sessionId: string): void => {
    const next = renameValue.trim()
    if (next)
      useTerminalStore.setState({
        sessions: useTerminalStore.getState().sessions.map((s) => (s.id === sessionId ? { ...s, label: next } : s)),
      })
    setRenamingId(null)
  }

  const handleCopyPath = (): void => {
    if (!folder) return
    try {
      const api = window.api as unknown as
        { clipboard?: { writeText?: (text: string) => Promise<unknown> | unknown } } | undefined
      void Promise.resolve(api?.clipboard?.writeText?.(folder)).catch(() => undefined)
      useAppStore.getState().toast(t('panel.terminalCopied'))
    } catch {
      useAppStore.getState().toast(t('panel.terminalCopyFailed'), 'error')
    }
  }

  return (
    <div className="panel terminal-panel">
      {/* --- terminal tab strip --- */}
      <div className="terminal-tabs">
        {sessions.map((entry) => {
          const isActive = activeId === entry.id
          return (
            <button
              key={entry.id}
              className={`terminal-tab${isActive ? ' terminal-tab-active' : ''}`}
              type="button"
              title={entry.shell ? `${entry.label} — ${entry.shell}` : entry.label}
              onClick={() => switchSession(entry.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                switchSession(entry.id)
                setRenamingId(entry.id)
                setRenameValue(entry.label)
              }}
            >
              {renamingId === entry.id ? (
                <input
                  className="terminal-rename"
                  type="text"
                  autoFocus
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => setRenamingId(null)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleRename(entry.id)
                    if (event.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <span className="terminal-tab-label">
                  {entry.label}
                  {entry.cwd ? ` (${folderName(entry.cwd)})` : ''}
                  {entry.running ? '' : ''}
                </span>
              )}
              <span
                className="terminal-tab-close"
                role="presentation"
                title={t('common.close')}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  close(entry.id)
                }}
              >
                ×
              </span>
            </button>
          )
        })}
        <button className="terminal-tab-new" type="button" title="New terminal tab" onClick={handleNew}>
          +
        </button>
      </div>

      <div className="panel-header">
        <span className="panel-title">{t('panel.terminal')}</span>
        <span className="panel-subtitle" title={folder || undefined}>
          {folder ? folderName(folder) : t('panel.terminalNoShell')}
          {busy ? t('panel.terminalRunning') : ''}
        </span>
        <span className="terminal-actions" style={{ display: 'flex', gap: '4px' }}>
          <button
            className="panel-button terminal-cwd"
            type="button"
            title={folder ? `${t('common.copy')} ${folder}` : t('panel.terminalUnknownFolder')}
            disabled={!folder}
            onClick={handleCopyPath}
          >
            {folder ? folderName(folder) : '—'}
          </button>
          <button
            className="panel-button"
            type="button"
            title={t('panel.terminalStop')}
            disabled={!session?.running}
            onClick={() => session?.running && interrupt(session.id)}
          >
            {t('panel.terminalInterrupt')}
          </button>
          <button
            className="panel-button"
            type="button"
            title={t('panel.terminalStopShell')}
            disabled={!session?.running}
            onClick={() => session?.running && stop(session.id)}
          >
            {t('panel.runStop')}
          </button>
          <button
            className="panel-button"
            type="button"
            disabled={lines.length === 0}
            onClick={() => session && clear(session.id)}
          >
            {t('common.clear')}
          </button>
        </span>
      </div>

      <div className="panel-body terminal-body">
        {lines.length > 0 ? (
          <div
            className="terminal-log"
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
                className={`terminal-line terminal-line-${line.type}`}
                key={`${index}-${line.type}`}
                style={{ color: lineColor(line.type) }}
              >
                {line.type === 'input' ? `${prompt}${line.text}` : line.text}
              </div>
            ))}
          </div>
        ) : null}

        {running ? (
          <div
            className={`terminal-input-row${busy ? ' terminal-busy' : ''}`}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span
              className="terminal-prompt"
              style={{
                color: 'var(--accent)',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                whiteSpace: 'pre',
                flex: '0 0 auto',
                maxWidth: '50%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={folder || undefined}
            >
              {prompt}
            </span>
            <input
              className="terminal-input"
              ref={inputRef}
              type="text"
              value={value}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              placeholder={t('panel.terminalPrompt')}
              aria-label={t('a11y.terminalInput')}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid var(--border-strong)',
                background: 'var(--bg-input)',
                color: 'var(--fg)',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
              }}
            />
          </div>
        ) : (
          <div className="empty-state panel-empty terminal-empty">
            <div>{t('panel.terminalNotRunning')}</div>
            <button className="panel-button" type="button" style={{ marginTop: '6px' }} onClick={() => void start(cwd)}>
              {t('panel.terminalStart')}
            </button>
            <div className="hint" style={{ marginTop: '6px' }}>
              {t('panel.terminalHint', { folder: folder || 'the home directory' })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
