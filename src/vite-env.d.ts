/// <reference types="vite/client" />

// Opting into Vite's strict env typing: without it `ImportMetaEnv` carries an
// index signature and every key is `any`, so a typo in a VITE_* name silently
// yields `undefined`. With it, only the keys declared below exist.
interface ViteTypeOptions
{
    strictImportMetaEnv: unknown;
}

// Every variable read through `import.meta.env`. Values are always strings -
// Vite performs no coercion - so booleans and numbers are parsed at the read
// site. Only `VITE_`-prefixed variables reach the client bundle; the rest stay
// server/build-side. Declared here, defaults live in `.env`.
interface ImportMetaEnv
{
    /** `'true'` installs the AzerothJS devtools panel in dev. Never in prod. */
    readonly VITE_DEVTOOLS: string;
}
