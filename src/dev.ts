// Dev-only reactive inspector, gated three ways:
//
//   import.meta.env.DEV         - never ships: the dynamic import behind it is
//                                 tree-shaken out of production builds.
//   VITE_DEVTOOLS               - the switch you own (.env / .env.local).
//                                 Explicit opt-in, so an unset value is "off".
//   ?no-devtools                - per-page-load escape hatch. The devtools
//                                 README documents this, but the package
//                                 implements no query handling, so it is here.
//
// The top-level await installs the hook before the app mounts, so nodes created
// during the first render are captured. Env values are strings, never booleans.
const enabled = import.meta.env.VITE_DEVTOOLS === 'true';
const skipped = new URLSearchParams(window.location.search).has('no-devtools');

if (import.meta.env.DEV && !enabled && !skipped)
{
    const { installDevtools } = await import('@azerothjs/devtools');

    installDevtools();
}
