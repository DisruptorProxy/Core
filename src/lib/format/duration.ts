/** Seconds to m:ss / h:mm:ss - a live connection duration, tabular so it does not jitter. */
export const formatDuration = (seconds: number): string =>
{
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n: number): string => n.toString().padStart(2, '0');

    return h > 0 ? `${ h }:${ pad(m) }:${ pad(s) }` : `${ m }:${ pad(s) }`;
};
