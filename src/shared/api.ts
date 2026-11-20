/**
 * The contract between the renderer and the native shell.
 *
 * The Tauri bridge implements this object and installs it as `window.api`.
 * The shape is the same one the old Electron preload exposed, so the React
 * application does not need to know which shell it runs in.
 */

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
} from './types'

/** One event of the process that runs a file. */
export interface RunEvent {
  type: 'start' | 'stdout' | 'stderr' | 'exit' | 'error'
  text?: string
  code?: number
}

/** One event of the integrated shell. */
export interface TerminalEvent {
  type: 'stdout' | 'stderr' | 'exit' | 'error'
  text?: string
  code?: number
}

/** The answer of `terminal.start`. */
export interface TerminalStartResult {
  ok: boolean
  cwd: string
  shell: string
  error?: string
}

/** A hit of the project wide search. */
export interface SearchMatch {
  path: string
  line: number
  column: number
  text: string
}

/** The answer of a project search. */
export interface SearchResult {
  matches: SearchMatch[]
  files: number
  skipped: number
  truncated: boolean
  took: number
  error?: string
}

/** The answer of a project replace. */
export interface ReplaceResult {
  changed: number
  replaced: number
  took: number
  error?: string
}

/** What the user asked the project search to do. */
export interface SearchRequest {
  folder: string
  query: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  include?: string
  maxResults?: number
  replacement?: string
}

/** A problem that a language server published. */
export interface LspProblem {
  line: number
  column: number
  from: number
  to: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source: string
}

/** A diagnostics event of a language server. */
export interface LspDiagnosticsEvent {
  language: string
  uri: string
  problems: LspProblem[]
}

/** A status event of a language server. */
export interface LspStatusEvent {
  language: string
  state: 'starting' | 'ready' | 'error' | 'stopped'
  message?: string
  hint?: string
}

/** The optional test hook. */
export interface TestApi {
  click: (x: number, y: number) => void
  key: (key: string, modifiers?: string[]) => void
}

/**
 * `window.api` — every call is promise based except the subscriptions and
 * the fire-and-forget window commands.
 */
export interface OpenNotesApi {
  info(): Promise<AppInfo>

  fs: {
    openDialog(opts: OpenDialogOptions): Promise<DialogResult>
    saveDialog(opts: SaveDialogOptions): Promise<DialogResult>
    readFile(path: string): Promise<FilePayload>
    writeFile(path: string, content: string, encoding: string, eol: Eol): Promise<void>
    readDir(path: string): Promise<DirEntry[]>
    listRecursive(path: string, maxDepth?: number): Promise<DirEntry[]>
    stat(path: string): Promise<DirEntry | null>
    exists(path: string): Promise<boolean>
    makeDir(path: string): Promise<void>
    remove(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    copyFile(from: string, to: string): Promise<void>
    showInFolder(path: string): Promise<void>
    readTextFile(path: string): Promise<string>
    writeTextFile(path: string, text: string): Promise<void>
    search(request: SearchRequest): Promise<SearchResult>
    replaceInFiles(request: SearchRequest): Promise<ReplaceResult>
    watch(path: string, cb: (changed: boolean) => void): Promise<() => void>
  }

  recent: {
    list(): Promise<string[]>
    add(path: string): Promise<string[]>
    clear(): Promise<void>
  }

  session: {
    load(): Promise<SessionState | null>
    save(state: SessionState): Promise<void>
  }

  settings: {
    load(): Promise<Partial<Settings> | null>
    save(settings: Settings): Promise<void>
  }

  plugins: {
    list(): Promise<PluginManifest[]>
  }

  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<boolean>
  }

  shell: {
    openTerminal(cwd?: string): Promise<boolean>
    run(filePath: string): Promise<string | null>
  }

  menu: {
    setRecent(paths: string[]): Promise<boolean>
    setProfile(profile: string): Promise<boolean>
    setLocale(locale: string): Promise<boolean>
    setKeybindings(bindings: Record<string, string>): Promise<boolean>
    accelerators(): Promise<string[]>
  }

  run: {
    start(filePath: string, language: string, toolchain?: Record<string, string>): Promise<boolean>
    stop(): Promise<boolean>
    onOutput(cb: (event: RunEvent) => void): () => void
  }

  terminal: {
    start(cwd?: string): Promise<TerminalStartResult>
    write(text: string): Promise<unknown>
    interrupt(): Promise<unknown>
    stop(): Promise<unknown>
    resize(cols: number, rows: number): Promise<unknown>
    onOutput(cb: (event: TerminalEvent) => void): () => void
  }

  lsp: {
    start(languages: string[]): Promise<string[]>
    didOpen(params: { language: string; uri: string; text: string }): Promise<boolean>
    didChange(params: { language: string; uri: string; text: string }): Promise<boolean>
    didClose(params: { language: string; uri: string }): Promise<boolean>
    request<T = unknown>(params: { language: string; method: string; params?: unknown }): Promise<T | null>
    stop(language?: string | null): Promise<boolean>
    configure(config: {
      servers?: Record<string, { command: string; args?: string[] }>
      rootPath?: string | null
    }): Promise<boolean>
    onDiagnostics(cb: (event: LspDiagnosticsEvent) => void): () => void
    onStatus(cb: (event: LspStatusEvent) => void): () => void
  }

  /** Report a renderer failure to the native log. */
  reportError(message: string): void

  /** A real mouse click at window coordinates (test builds only). */
  test?: TestApi

  win: {
    newWindow(): Promise<boolean>
    setMenuBar(visible: boolean): Promise<boolean>
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    zoom(delta: number): void
    getZoom(): Promise<number>
    setZoom(factor: number): Promise<boolean>
    setTitle(title: string): void
    setTheme(color: string): void
    onMaximizeChange(cb: (maximized: boolean) => void): () => void
  }

  onCommand(cb: (id: string, payload?: unknown) => void): () => void
  onMenuAccelerators(cb: (commands: string[]) => void): () => void
  onOpenFiles(cb: (paths: string[]) => void): () => void

  /** Native files dropped onto the window (Tauri gives real paths). */
  onDropPaths(cb: (paths: string[]) => void): () => void

  /** Resolve the real path of a File dropped onto the window. */
  pathForFile(file: File): string
}
