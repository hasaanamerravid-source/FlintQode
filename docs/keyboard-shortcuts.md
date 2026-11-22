# Keyboard shortcuts

This is the reference of the keyboard shortcuts of FlintQode. Every entry is taken from the code;
the table names the command id, which is the stable name used by the command palette, the
keybindings file and the in-app menu.

## Where a shortcut comes from

A shortcut can be written down in three places. They are read in this order:

| Source | Where | Format |
| --- | --- | --- |
| The built-in one | `src/renderer/src/core/builtinCommands.ts`, the `shortcut` property of a command | A string such as `Ctrl+Shift+S` |
| The file of the user | `keybindings.json` in the application-data folder (`keybindingsPath()` in `src/renderer/src/core/keybindings.ts`) | A flat map of a command id to a key combination |
| The file of the project | `.flintqode.json` in the project folder, under `keybindings` | The same flat map |

The project file wins over the file of the user: `readKeybindings()` merges the two with
`{ ...global, ...project }`. The built-in `shortcut` is only the **default binding**; the user and
the project bindings are checked first by the key handler in `App.tsx`.

The file is plain JSON:

```json
{
  "file.open": "Ctrl+Alt+O",
  "view.toggleTerminal": "Ctrl+J",
  "format.sortAsc": "Ctrl+Shift+Alt+A"
}
```

`Ctrl` also means `Cmd` on macOS: `matchesShortcut()` accepts `metaKey` wherever `Ctrl` is
written. The named keys are the ones the browser reports (`ArrowUp`, `F12`, `` ` ``, `+`, …).

## The mechanisms that dispatch a key

| Mechanism | Where | What it binds |
| --- | --- | --- |
| The keymap of the application | `src/renderer/src/App.tsx` | One `keydown` listener on `window`. It closes the palette, switches the tabs, runs the user/project bindings and then the default `shortcut` of every command. |
| The keymap of the editor | `src/renderer/src/components/editor/CodeEditor.tsx` | CodeMirror installs `closeBracketsKeymap`, `defaultKeymap`, `searchKeymap`, `historyKeymap`, `foldKeymap`, `completionKeymap`, `lintKeymap`, `indentWithTab` and `standardKeymap`. They work while the editor has the focus. |
| The terminal panel | `src/renderer/src/components/panels/TerminalPanel.tsx` | Enter, Escape and the arrow keys, while the command input has the focus. |

A key is handled exactly once:

1. the keybindings of the user and of the project are checked first, and the key press is
   consumed there (`preventDefault` and `stopPropagation`);
2. a key that the editor has already handled (`e.defaultPrevented`) is left alone — the editor
   knows better what `Ctrl+Z` means in a text;
3. only then the default `shortcut` of the commands is used;
4. the hard-coded window bindings below come last.

There is no native menu in the Tauri build, so `handledByMenu()` is always false and the
`api.menu.*` methods are no-ops. The in-app menu shows the same shortcuts but does not register
them; the key handler owns every key.

## The built-in shortcuts

These are the `shortcut` values in `builtinCommands.ts`. Every one of them can be replaced in
`keybindings.json`.

| Shortcut | Command | What it does |
| --- | --- | --- |
| `Ctrl+N` | `file.new` | New empty document |
| `Ctrl+O` | `file.open` | Open a file from disk |
| `Ctrl+S` | `file.save` | Save the active tab |
| `Ctrl+Shift+S` | `file.saveAs` | Save the active tab under another name |
| `Ctrl+W` | `file.close` | Close the active tab |
| `Ctrl+Shift+T` | `file.reopenClosed` | Reopen the last closed tab |
| `Ctrl+Z` | `edit.undo` | Undo |
| `Ctrl+Y` | `edit.redo` | Redo |
| `Ctrl+A` | `edit.selectAll` | Select the whole document |
| `Ctrl+G` | `edit.gotoLine` | Go to a line |
| `F12` | `editor.goToDefinition` | Go to the definition (needs a language server) |
| `Shift+F12` | `editor.findReferences` | Find the references (needs a language server) |
| `Ctrl+D` | `edit.duplicateLine` | Duplicate the current line |
| `Ctrl+Shift+K` | `edit.deleteLine` | Delete the current line |
| `Alt+Shift+Up` | `edit.moveLineUp` | Move the current line up |
| `Alt+Shift+Down` | `edit.moveLineDown` | Move the current line down |
| `Ctrl+Shift+C` | `edit.copyLine` | Copy the current line |
| `F5` | `edit.insertDateTime` | Insert the date and the time |
| `Ctrl+Shift+L` | `edit.selectAllOccurrences` | Select every occurrence of the selection |
| `Ctrl+F` | `search.find` | Find in the current document |
| `Ctrl+H` | `search.replace` | Replace in the current document |
| `F3` | `search.findNext` | Next match |
| `Shift+F3` | `search.findPrevious` | Previous match |
| `Ctrl+Shift+F` | `search.findInFiles` | Search the whole project |
| `Ctrl+B` | `search.matchBracket` | Jump to the matching bracket |
| `Ctrl+F2` | `edit.toggleBookmark` | Toggle a bookmark on the line |
| `F2` | `edit.nextBookmark` | Next bookmark |
| `Shift+F2` | `edit.prevBookmark` | Previous bookmark |
| `Ctrl+Shift+E` | `view.toggleSidebar` | Show or hide the sidebar |
| `F11` | `view.fullscreen` | Toggle full screen |
| `Ctrl++` | `view.zoomIn` | Zoom in |
| `Ctrl+-` | `view.zoomOut` | Zoom out |
| `Ctrl+0` | `view.zoomReset` | Reset the zoom |
| `Ctrl+Alt+F` | `view.distractionFree` | Distraction-free mode |
| `Ctrl+Alt+S` | `view.toggleSplit` | Split the editor |
| `Ctrl+Shift+P` | `view.commandPalette` | Command palette |
| `Ctrl+Shift+O` | `view.quickSwitcher` | Go to a file |
| ``Ctrl+` `` | `view.toggleTerminal` | Show or hide the integrated terminal |

## The window bindings

`App.tsx` also binds a few keys that do not belong to a single command:

| Shortcut | Action |
| --- | --- |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+1` … `Ctrl+9` | Activate the tab with that index |
| `Alt+Left` / `Alt+Right` | Previous / next tab |
| `Escape` | Close the command palette |

## The editor keys

These are CodeMirror's own bindings; they work while a text editor has the focus and are not
overridden by the application keymap (the handler returns early on `defaultPrevented`):

| Key | Action |
| --- | --- |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+X`, `Ctrl+C`, `Ctrl+V` | Cut, copy, paste |
| `Tab` / `Shift+Tab` | Indent / outdent the selection |
| `Ctrl+F`, `Ctrl+H`, `F3`, `Shift+F3` | The search panel of CodeMirror |
| `Ctrl+Space` | Completion |
| `Ctrl+/` | Toggle a line comment |
| `Ctrl+[` / `Ctrl+]` | Outdent / indent |
| `Ctrl+Home` / `Ctrl+End` | Start / end of the document |
| `Ctrl+Shift+\` | Jump to the matching bracket (CodeMirror) |

## The terminal panel

| Key | Action |
| --- | --- |
| `Enter` | Run the line |
| `ArrowUp` / `ArrowDown` | Previous / next command from the history |
| `Escape` | Clear the input |
| `Ctrl+C` | Interrupt the running command, but only when the input is empty — otherwise it copies the selection |

## Commands without a shortcut

Most commands have no default shortcut: new window, save all, close all, the Format commands
(sort, trim, join, case, encoding, line ending), the Tools commands (compare, macros, character
map, run), the panel commands and every plugin command. They are reachable from the command
palette and the in-app menu, and any of them can be given a key in `keybindings.json`.

The command palette shows the shortcut of every command that has one. **Settings ▸ Shortcuts**
lists the commands that have a shortcut, lets the user change them and writes the change into
`keybindings.json` immediately; the list is built from
`getCommands().filter((command) => command.shortcut && !command.hidden)`.

## See also

* [architecture.md](architecture.md) — the command registry and the editor abstraction.
* [extension-api.md](extension-api.md) — commands contributed by a plugin.
