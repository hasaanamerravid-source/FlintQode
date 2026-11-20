import type { OpenNotesApi } from '@shared/api'

declare module '*.css' {
  const content: string
  export default content
}

declare global {
  interface Window {
    api: OpenNotesApi
  }
}

export {}
