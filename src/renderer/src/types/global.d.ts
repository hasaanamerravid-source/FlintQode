import type { FlintQodeApi } from '@shared/api'

declare module '*.css' {
  const content: string
  export default content
}

declare global {
  interface Window {
    api: FlintQodeApi
  }
}

export {}
