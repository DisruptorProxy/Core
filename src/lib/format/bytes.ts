/** Bytes to a compact data-size string: MB, or GB once it passes 1024 MB. */
export const formatBytes = (bytes: number): string =>
{
    const mb = bytes / (1024 * 1024);

    return mb >= 1024 ? `${ (mb / 1024).toFixed(2) } GB` : `${ mb.toFixed(1) } MB`;
};
