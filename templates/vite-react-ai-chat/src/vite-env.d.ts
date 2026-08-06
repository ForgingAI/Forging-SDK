/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FORGING_APP_ID: string
  readonly VITE_FORGING_APP_NAME?: string
  readonly VITE_FORGING_APP_GREETING?: string
  readonly VITE_FORGING_PROXY_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
