/**
 * The bridge between the React application and the Tauri shell.
 *
 * The renderer was written for an Electron preload that exposed `window.api`.
 * Tauri exposes commands and events instead, so this module implements the
 * same promise-based surface on top of `invoke()` and `listen()`. The React
 * components stay untouched and the app can still be opened in a plain
 * browser for UI work (the file system calls then explain what is missing).
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { open as openNativeDialog, save as saveNativeDialog } from '@tauri-apps/plugin-dialog'
import {
  readText as readNativeClipboard,
  writeText as writeNativeClipboard,
} from '@tauri-apps/plugin-clipboard-manager'
import type {
  AppInfo,
  DialogResult,
  DirEntry,
  Eol,
  FilePayload,
  OpenDialogOptions,
  PluginManifest,
  SaveDialogOptions,
  SessionState,
  Settings,
} from '@shared/types'
import type {
  LspDiagnosticsEvent,
  LspStatusEvent,
  FlintQodeApi,
  ReplaceResult,
  RunEvent,
  SearchRequest,
  SearchResult,
  TerminalEvent,
  TerminalListItem,
  TerminalStartResult,
} from '@shared/api'

/** Is the page running inside the native Tauri webview? */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** A readable error for the browser-only mode. */
function nativeOnly(what: string): Error {
  return new Error(`${what} is only available in the desktop app. Start it with "npm run dev:app".`)
}

/** Call a command and keep the generic result typed. */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw nativeOnly('The native bridge')
  return invoke<T>(command, args)
}

/* ------------------------------------------------------------------ *
 * Browser fallback for the settings (so `vite` can still show the UI)
 * ------------------------------------------------------------------ */

const LOCAL_SETTINGS = 'flintqode.browser.settings'
const LOCAL_SESSION = 'flintqode.browser.session'
const LOCAL_RECENT = 'flintqode.browser.recent'

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode */
  }
}

/* ------------------------------------------------------------------ *
 * Event helpers
 * ------------------------------------------------------------------ */

/**
 * Subscribe to a Tauri event. `listen()` is async, but every caller expects a
 * synchronous unsubscribe function, so the promise is resolved in the
 * background and a late unlisten is called immediately.
 */
function subscribe<T>(name: string, cb: (payload: T) => void): () => void {
  if (!isTauri()) return () => undefined
  let disposed = false
  let unlisten: UnlistenFn | undefined
  void listen<T>(name, (event) => cb(event.payload))
    .then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    })
    .catch((error: unknown) => {
      console.warn(`[flintqode] cannot listen to ${name}`, error)
    })
  return () => {
    disposed = true
    unlisten?.()
    unlisten = undefined
  }
}

/* ------------------------------------------------------------------ *
 * Window helpers
 * ------------------------------------------------------------------ */

let zoomFactor = 1

function applyZoom(factor: number): number {
  zoomFactor = Math.min(3, Math.max(0.4, Number.isFinite(factor) ? factor : 1))
  try {
    document.documentElement.style.setProperty('zoom', String(zoomFactor))
  } catch {
    /* the engine does not support CSS zoom */
  }
  return zoomFactor
}

function currentWindow(): ReturnType<typeof getCurrentWindow> | null {
  if (!isTauri()) return null
  const win = getCurrentWindow()
  if (!win) {
    console.warn('[flintqode] Tauri window handle unavailable')
  }
  return win
}

/* ------------------------------------------------------------------ *
 * Dialogs
 * ------------------------------------------------------------------ */

function dialogFilters(opts: {
  filters?: { name: string; extensions: string[] }[]
}): { name: string; extensions: string[] }[] {
  return (opts.filters ?? [])
    .map((filter) => ({
      name: filter.name,
      extensions: filter.extensions
        .filter((extension) => extension !== '*')
        .map((extension) => extension.replace(/^\./, '')),
    }))
    .filter((filter) => filter.extensions.length > 0)
}

async function openDialog(opts: OpenDialogOptions): Promise<DialogResult> {
  if (!isTauri()) throw nativeOnly('The file dialog')
  const selection = await openNativeDialog({
    title: opts.title,
    defaultPath: opts.defaultPath,
    multiple: opts.multiSelections,
    directory: opts.directory,
    filters: dialogFilters(opts),
  })
  const filePaths = Array.isArray(selection) ? selection : selection ? [selection] : []
  return { canceled: filePaths.length === 0, filePaths, filePath: filePaths[0] ?? null }
}

async function saveDialog(opts: SaveDialogOptions): Promise<DialogResult> {
  if (!isTauri()) throw nativeOnly('The save dialog')
  const selection = await saveNativeDialog({
    title: opts.title,
    defaultPath: opts.defaultPath,
    filters: dialogFilters(opts),
  })
  const filePaths = selection ? [selection] : []
  return { canceled: !selection, filePaths, filePath: selection ?? null }
}

/* ------------------------------------------------------------------ *
 * The API
 * ------------------------------------------------------------------ */

/** Build the object that is installed as `window.api`. */
export function createApi(): FlintQodeApi {
  return {
    info: (): Promise<AppInfo> => {
      if (!isTauri()) {
        return Promise.resolve({
          version: '1.4.7',
          build: 'dev',
          commit: 'browser',
          tauri: 'browser preview',
          webview: navigator.userAgent,
          runtime: 'browser',
          platform: navigator.platform || 'unknown',
          home: '',
          temp: '',
          userData: '',
        })
      }
      return call<AppInfo>('app_info')
    },

    fs: {
      openDialog,
      saveDialog,
      readFile: (path: string) => call<FilePayload>('fs_read_file', { path }),
      writeFile: (path: string, content: string, encoding: string, eol: Eol) =>
        call<void>('fs_write_file', { path, content, encoding, eol }),
      readDir: (path: string) => call<DirEntry[]>('fs_read_dir', { path }),
      listRecursive: (path: string, maxDepth?: number) =>
        call<DirEntry[]>('fs_list_recursive', { path, maxDepth: maxDepth ?? 12 }),
      stat: (path: string) => call<DirEntry | null>('fs_stat', { path }),
      exists: (path: string) => call<boolean>('fs_exists', { path }),
      makeDir: (path: string) => call<void>('fs_make_dir', { path }),
      remove: (path: string) => call<void>('fs_remove', { path }),
      rename: (from: string, to: string) => call<void>('fs_rename', { from, to }),
      copyFile: (from: string, to: string) => call<void>('fs_copy_file', { from, to }),
      showInFolder: (path: string) => call<void>('fs_show_in_folder', { path }),
      readTextFile: (path: string) => call<string>('fs_read_text_file', { path }),
      writeTextFile: (path: string, text: string) => call<void>('fs_write_text_file', { path, text }),
      search: (request: SearchRequest) => call<SearchResult>('fs_search', { request }),
      replaceInFiles: (request: SearchRequest) => call<ReplaceResult>('fs_replace_in_files', { request }),
      watch: async (path: string, cb: (changed: boolean) => void): Promise<() => void> => {
        if (!isTauri()) return () => undefined
        const stop = subscribe<string>('fs:changed', (changedPath) => {
          if (changedPath === path) cb(true)
        })
        await call<void>('fs_watch', { path })
        return () => {
          stop()
          void call<void>('fs_unwatch', { path }).catch(() => undefined)
        }
      },
    },

    git: {
      status: (path: string) =>
        call<{
          repoRoot: string
          status: {
            branch: string
            dirty: boolean
            files: { path: string; status: string; additions: number; deletions: number }[]
          } | null
        }>('git_status', { path }),
      diff: (path: string) => call<string>('git_diff', { path }),
      log: (path: string, limit?: number) => call<string[]>('git_log', { path, limit: limit ?? 30 }),
      blame: (path: string) => call<string[]>('git_blame', { path }),
      commit: (cwd: string, message: string) => call<string>('git_commit', { cwd, message }),
      stage: (cwd: string) => call<string>('git_stage', { cwd }),
      renameBranch: (cwd: string, name: string) => call<string>('git_branch_rename', { cwd, name }),
    },

    recent: {
      list: () => (isTauri() ? call<string[]>('recent_list') : Promise.resolve(readLocal<string[]>(LOCAL_RECENT, []))),
      add: (path: string) => {
        if (isTauri()) return call<string[]>('recent_add', { path })
        const list = readLocal<string[]>(LOCAL_RECENT, [])
        const next = [path, ...list.filter((entry) => entry.toLowerCase() !== path.toLowerCase())].slice(0, 30)
        writeLocal(LOCAL_RECENT, next)
        return Promise.resolve(next)
      },
      clear: async () => {
        if (isTauri()) await call<void>('recent_clear')
        else writeLocal(LOCAL_RECENT, [])
      },
    },

    session: {
      load: () =>
        isTauri()
          ? call<SessionState | null>('session_load')
          : Promise.resolve(readLocal<SessionState | null>(LOCAL_SESSION, null)),
      save: async (state: SessionState) => {
        if (isTauri()) await call<void>('session_save', { state })
        else writeLocal(LOCAL_SESSION, state)
      },
    },

    settings: {
      load: () =>
        isTauri()
          ? call<Partial<Settings> | null>('settings_load')
          : Promise.resolve(readLocal<Partial<Settings> | null>(LOCAL_SETTINGS, null)),
      save: async (settings: Settings) => {
        if (isTauri()) await call<void>('settings_save', { settings })
        else writeLocal(LOCAL_SETTINGS, settings)
      },
    },

    plugins: {
      list: () => (isTauri() ? call<PluginManifest[]>('plugins_list') : Promise.resolve([])),
    },

    clipboard: {
      readText: async () => {
        if (isTauri()) return readNativeClipboard()
        try {
          return await navigator.clipboard.readText()
        } catch {
          return ''
        }
      },
      writeText: async (text: string) => {
        if (isTauri()) {
          await writeNativeClipboard(text)
          return true
        }
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch {
          return false
        }
      },
    },

    shell: {
      openTerminal: (cwd?: string) => call<boolean>('shell_open_terminal', { cwd: cwd ?? null }),
      run: (filePath: string) => call<string | null>('shell_run', { filePath }),
    },

    menu: {
      // The native menu bar is gone. The in-app menu and the command palette
      // own these actions now, so the calls stay successful no-ops.
      setRecent: async () => true,
      setProfile: async () => true,
      setLocale: async () => true,
      setKeybindings: async () => true,
      accelerators: async () => [],
    },

    run: {
      start: (filePath: string, language: string, toolchain?: Record<string, string>) =>
        call<boolean>('run_start', { request: { filePath, language, toolchain: toolchain ?? {} } }),
      stop: () => call<boolean>('run_stop'),
      onOutput: (cb: (event: RunEvent) => void) => subscribe<RunEvent>('run:output', cb),
    },

    terminal: {
      start: (cwd?: string) => call<TerminalStartResult>('terminal_start', { cwd: cwd ?? null }),
      create: (cwd?: string, label?: string) =>
        call<TerminalStartResult>('terminal_new', { cwd: cwd ?? null, label: label ?? null }),
      write: (sessionId: string, text: string) => call<boolean>('terminal_write', { request: { sessionId, text } }),
      interrupt: (sessionId: string) => call<boolean>('terminal_interrupt', { sessionId }),
      stop: (sessionId: string) => call<boolean>('terminal_stop', { sessionId }),
      close: (sessionId: string) => call<boolean>('terminal_close', { sessionId }),
      list: () => call<TerminalListItem[]>('terminal_list'),
      active: (sessionId?: string) => call<string>('terminal_active', { sessionId: sessionId ?? null }),
      resize: (sessionId: string, cols: number, rows: number) =>
        call<boolean>('terminal_resize', { sessionId, cols, rows }),
      onOutput: (cb: (event: TerminalEvent) => void) => subscribe<TerminalEvent>('terminal:output', cb),
    },

    lsp: {
      start: (languages: string[]) => call<string[]>('lsp_start', { languages }),
      didOpen: (params) => call<boolean>('lsp_did_open', { params }),
      didChange: (params) => call<boolean>('lsp_did_change', { params }),
      didClose: (params) => call<boolean>('lsp_did_close', { params }),
      request: <T>(params: { language: string; method: string; params?: unknown }) =>
        call<T | null>('lsp_request', { params }),
      stop: (language?: string | null) => call<boolean>('lsp_stop', { language: language ?? null }),
      configure: (config) => call<boolean>('lsp_configure', { config }),
      onDiagnostics: (cb: (event: LspDiagnosticsEvent) => void) =>
        subscribe<LspDiagnosticsEvent>('lsp:diagnostics', cb),
      onStatus: (cb: (event: LspStatusEvent) => void) => subscribe<LspStatusEvent>('lsp:status', cb),
    },

    reportError: (message: string) => {
      console.error('[flintqode]', message)
      if (isTauri()) void call<void>('report_error', { message }).catch(() => undefined)
    },

    win: {
      newWindow: () => call<boolean>('win_new_window'),
      setMenuBar: async () => true,
      minimize: () => {
        void call<void>('win_minimize').catch((error) => console.warn('[flintqode] minimize failed', error))
      },
      toggleMaximize: () => {
        void call<void>('win_toggle_maximize').catch((error) =>
          console.warn('[flintqode] toggleMaximize failed', error),
        )
      },
      close: () => {
        void call<void>('win_close').catch((error) => console.warn('[flintqode] close failed', error))
      },
      isMaximized: async () => {
        try {
          return await call<boolean>('win_is_maximized')
        } catch {
          return false
        }
      },
      zoom: (delta: number) => {
        void applyZoom(zoomFactor + delta)
      },
      getZoom: async () => zoomFactor,
      setZoom: async (factor: number) => {
        applyZoom(factor)
        return true
      },
      setTitle: (title: string) => {
        const win = currentWindow()
        if (win) void win.setTitle(title).catch((error) => console.warn('[flintqode] setTitle failed', error))
      },
      setTheme: (color: string) => {
        // The webview paints the whole window, including the frame, so there
        // is no native colour to update. The CSS `data-theme` attribute handles
        // the visual theme; this call is kept for API compatibility.
      },
      onMaximizeChange: (cb: (maximized: boolean) => void) => {
        let disposed = false
        let last: boolean | null = null
        let stop: (() => void) | undefined
        const report = (): void => {
          void call<boolean>('win_is_maximized')
            .then((maximized) => {
              if (disposed) return
              if (last === null || maximized !== last) {
                last = maximized
                cb(maximized)
              }
            })
            .catch(() => undefined)
        }
        report()
        // Maximizing or restoring a native window is a resize. Listening to it
        // removes the half-second lag of the old polling loop and keeps the
        // window idle when nothing changes.
        const win = currentWindow()
        if (win) {
          void win
            .onResized(report)
            .then((unlisten) => {
              if (disposed) unlisten()
              else stop = unlisten
            })
            .catch((error: unknown) => console.warn('[flintqode] resize listener failed', error))
        }
        return () => {
          disposed = true
          stop?.()
          stop = undefined
        }
      },
    },

    app: {
      checkUpdate: (currentVersion: string) =>
        call<{ version: string; url: string; assetName: string; sha256: string } | null>('app_check_update', {
          currentVersion,
        }),
      downloadUpdate: (url: string, dest: string, sha256: string) =>
        call<string>('app_download_update', { url, dest, sha256 }),
      installUpdate: (path: string, sha256: string) => call<string>('app_install_update', { path, sha256 }),
    },

    onCommand: (cb: (id: string, payload?: unknown) => void) =>
      subscribe<{ id: string; payload?: unknown }>('menu:command', (event) => cb(event.id, event.payload)),

    onMenuAccelerators: (cb: (commands: string[]) => void) => subscribe<string[]>('menu:accelerators', cb),

    onOpenFiles: (cb: (paths: string[]) => void) => {
      const stop = subscribe<string[]>('flintqode:open-files', cb)
      if (isTauri()) {
        // Files that were passed on the command line before the window was
        // ready are picked up once (the command clears the queue).
        void call<string[]>('open_files_pending')
          .then((paths) => {
            if (paths.length) cb(paths)
          })
          .catch(() => undefined)
      }
      return stop
    },

    onDropPaths: (cb: (paths: string[]) => void) => {
      if (!isTauri()) return () => undefined
      let disposed = false
      let unlisten: UnlistenFn | undefined
      void getCurrentWebview()
        .onDragDropEvent((event) => {
          if (event.payload.type === 'drop') cb(event.payload.paths ?? [])
        })
        .then((stop) => {
          if (disposed) stop()
          else unlisten = stop
        })
        .catch(() => undefined)
      return () => {
        disposed = true
        unlisten?.()
        unlisten = undefined
      }
    },

    pathForFile: (file: File): string => (file as File & { path?: string }).path ?? file.name,
  }
}

/** Install the bridge as `window.api` (the renderer expects that name). */
export function installApi(): void {
  if (typeof window === 'undefined') return
  ;(window as Window & { api: FlintQodeApi }).api = createApi()
}
