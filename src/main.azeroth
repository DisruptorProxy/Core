import './dev';

import { render } from 'azerothjs';

import Shell from './app/shell.component.azeroth';

// `import.meta.env.PROD` is Vite's built-in, true only in a production build
// (`vite build`) and false under `npm run dev` - unlike a custom env var it can't be
// left mis-set, so the input-blocking below reliably fires in release, never in dev.
if (import.meta.env.PROD)
{
    document.addEventListener('keydown', (event) =>
    {
        if (event.key === 'F3' ||
            event.key === 'F5' ||
            event.key === 'F7' ||
        (event.ctrlKey && (event.key === 'p' || event.key === 'P')) ||
        (event.ctrlKey && (event.key === 'j' || event.key === 'J')) ||
        (event.ctrlKey && (event.key === 'r' || event.key === 'R')) ||
        (event.ctrlKey && (event.key === 'f' || event.key === 'F')) ||
        (event.ctrlKey && event.shiftKey && (event.key === 'p' || event.key === 'P')) ||
        (event.ctrlKey && event.shiftKey && (event.key === 'i' || event.key === 'I')))
        {
            event.preventDefault();
        }
    });

    document.addEventListener('contextmenu', (event) =>
    {
        event.preventDefault();
    });
}

render(() => Shell(), document.getElementById('root')!);
