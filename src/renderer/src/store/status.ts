import { create } from '@/state/compat'

export interface StatusState {
  line: number
  col: number
  selChars: number
  selLines: number
  totalLines: number
  totalChars: number
  words: number
  mode: string
  language: string
  encoding: string
  eol: string
  dirty: boolean
  zoom: number
  /** True while the window is maximised. */
  maximized: boolean
  /** Current git branch of the active file's repo (empty when not a git repo). */
  gitBranch: string
  /** True when the repo has uncommitted changes. */
  gitDirty: boolean
  set: (patch: Partial<StatusState>) => void
  reset: () => void
}

const initial = {
  line: 1,
  col: 1,
  selChars: 0,
  selLines: 0,
  totalLines: 1,
  totalChars: 0,
  words: 0,
  mode: 'code',
  language: 'text',
  encoding: 'utf8',
  eol: '\n',
  dirty: false,
  zoom: 1,
  maximized: false,
  gitBranch: '',
  gitDirty: false,
}

export const useStatusStore = create<StatusState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set({ ...initial }),
}))
