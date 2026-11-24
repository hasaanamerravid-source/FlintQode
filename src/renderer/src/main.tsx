import { render } from '@solidjs/web'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAppStore } from './store/app'
import { runCommand, getCommands } from './core/commands'
import { currentProblems } from './core/useProblems'
import { getEditor } from './core/editors'
import { installApi } from './bridge'
import './styles/app.css'
import './styles/appearance.css'
import './styles/workbench.css'
import './core/syntaxThemes.css'
import './styles/design-system.css'

// The renderer was written for an Electron preload; install the Tauri
// equivalent before the first component asks for it.
installApi()

const container = document.getElementById('root')
if (!container) throw new Error('Root container missing')

// A small scripting surface: handy for power users and for automated checks.
;(window as unknown as { flintqode: unknown }).flintqode = {
  store: useAppStore,
  run: runCommand,
  setState: (patch: Record<string, unknown>) => useAppStore.setState(patch as never),
  commands: { list: getCommands },
  get problems() {
    return currentProblems()
  },
  get editor() {
    return getEditor(useAppStore.getState().activeTabId)
  },
}
// Keep the old name working so existing plugins and scripts do not break after
// the rename.
;(window as unknown as { opennotes: unknown }).opennotes = (window as unknown as { flintqode: unknown }).flintqode

render(
  () => (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  ),
  container,
)
