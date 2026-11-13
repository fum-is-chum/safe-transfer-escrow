/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PACKAGE_ID?: string;
  readonly VITE_INDEX_ID?: string;
  readonly VITE_PUBLISHED_AT?: string;
  readonly VITE_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
