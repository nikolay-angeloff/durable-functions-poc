/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
    /** Public URL of the form SPA (for “Open form” / resume links). */
    readonly VITE_FORM_APP_BASE_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
