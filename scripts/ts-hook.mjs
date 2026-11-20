/**
 * A small loader that lets Node run the TypeScript sources of the project
 * directly, without a build step.
 *
 * It does three things:
 *
 * 1. It resolves the path aliases of the project (`@shared/*`, `@/*`) and the
 *    imports that have no file extension.
 * 2. It transpiles TypeScript with the compiler that is already installed
 *    (`typescript` is a dev dependency). Node 20 cannot strip types itself.
 * 3. It turns a JSON file into an ES module, so that the catalogues of the
 *    translation can be imported the same way the bundler does it.
 *
 * The hook is registered by `scripts/register-ts.mjs`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..')

/** The aliases of the project, the same as in vite.config.ts. */
const ALIASES = [
  ['@shared/', resolvePath(root, 'src', 'shared') + '/'],
  ['@/', resolvePath(root, 'src', 'renderer', 'src') + '/'],
]

/** The files that are tried when a file is imported without an extension. */
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.json']

let typescript = null

/** The places a TypeScript compiler may live. The npm dependency is the
 * preferred one, but TypeScript 7 dropped `transpileModule`, so a 5/6
 * compiler (such as the one bundled with VS Code) is used as a fallback. */
const TYPESCRIPT_CANDIDATES = [
  'typescript',
  '/usr/share/code/resources/app/extensions/node_modules/typescript',
  '/usr/lib/node_modules/typescript',
  '/usr/local/lib/node_modules/typescript',
]

/** Load the compiler once (the loader thread cannot use the module cache of
 * the test thread, so it is kept here). */
function compiler() {
  if (typescript) return typescript
  for (const candidate of TYPESCRIPT_CANDIDATES) {
    try {
      const loaded = require(candidate)
      if (loaded && typeof loaded.transpileModule === 'function') {
        typescript = loaded
        return typescript
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error('No TypeScript compiler with transpileModule was found.')
}

/** Find the file of an import that has no extension. */
function findFile(base) {
  if (existsSync(base)) {
    try {
      if (statSync(base).isDirectory()) return findFile(resolvePath(base, 'index'))
    } catch {
      /* not a file */
    }
    return base
  }
  for (const extension of EXTENSIONS) {
    const candidate = base + extension
    if (existsSync(candidate)) return candidate
  }
  for (const extension of EXTENSIONS) {
    const candidate = resolvePath(base, 'index' + extension)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Resolve an import to a file on disk. */
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : resolvePath(root, 'index.js')
    const found = findFile(resolvePath(dirname(parentPath), specifier))
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
  }
  for (const [prefix, target] of ALIASES) {
    if (specifier.startsWith(prefix)) {
      const found = findFile(target + specifier.slice(prefix.length))
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}

/** Load a file: JSON becomes a module, TypeScript is transpiled. */
export function load(url, context, nextLoad) {
  if (!url.startsWith('file:')) return nextLoad(url, context)

  if (url.endsWith('.json')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    return { format: 'module', source: `export default ${source};\n`, shortCircuit: true }
  }

  if (/\.(ts|tsx|mts)$/.test(url)) {
    const file = fileURLToPath(url)
    const source = readFileSync(file, 'utf8')
    const result = compiler().transpileModule(source, {
      fileName: file,
      compilerOptions: {
        target: compiler().ScriptTarget.ES2022,
        module: compiler().ModuleKind.ESNext,
        moduleResolution: compiler().ModuleResolutionKind.Bundler,
        jsx: compiler().JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        sourceMap: false,
      },
    })
    return { format: 'module', source: result.outputText, shortCircuit: true }
  }

  return nextLoad(url, context)
}
