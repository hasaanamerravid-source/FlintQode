/** Small path helpers shared by the active-file commands. */

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function parts(path: string): string[] {
  return normalize(path).split('/').filter(Boolean)
}

/**
 * Path of `file` relative to `root`, or null when there is no root or the file
 * is outside it. Both slash styles work, and Windows drive letters are compared
 * without case.
 */
export function relativeToWorkspace(file: string | null | undefined, root: string | null | undefined): string | null {
  if (!file || !root) return null
  const fileParts = parts(file)
  const rootParts = parts(root)
  if (!fileParts.length || !rootParts.length || rootParts.length > fileParts.length) return null
  const windows = /^[A-Za-z]:/.test(normalize(file)) || /^[A-Za-z]:/.test(normalize(root))
  const same = (a: string, b: string): boolean => (windows ? a.toLowerCase() === b.toLowerCase() : a === b)
  for (let index = 0; index < rootParts.length; index += 1) {
    if (!same(rootParts[index], fileParts[index])) return null
  }
  return fileParts.slice(rootParts.length).join('/') || '.'
}
