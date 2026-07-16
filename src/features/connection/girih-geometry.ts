/**
 * Girih geometry for the connection gate.
 *
 * Girih ("knot") is the interlaced strapwork of Persian and wider Islamic
 * architecture - the pierced screens (jali) that let light through a wall. That is
 * exactly what a proxy is: a screen that lets your traffic through a wall. So the
 * app's one signature is a girih rosette that opens when the connection does,
 * rather than the glowing-shield-and-power-button every VPN ships.
 *
 * Points are computed once at module load; the gate only animates transforms and
 * colour, never re-computes geometry.
 */

const CENTER = 100;

const polygon = (radius: number, sides: number, rotationDeg: number): string =>
{
    const rotation = (rotationDeg * Math.PI) / 180;

    return Array.from({ length: sides }, (_unused, i) =>
    {
        const angle = rotation + (i / sides) * Math.PI * 2;
        const x = CENTER + radius * Math.cos(angle);
        const y = CENTER + radius * Math.sin(angle);

        return `${ x.toFixed(2) },${ y.toFixed(2) }`;
    }).join(' ');
};

/** A {points}/{step} star polygon, e.g. a {10/3} decagram - the girih rosette core. */
const star = (outer: number, points: number, step: number, rotationDeg: number): string =>
{
    const rotation = (rotationDeg * Math.PI) / 180;
    const vertices: string[] = [];

    let index = 0;

    for (let i = 0; i < points; i++)
    {
        const angle = rotation + (index / points) * Math.PI * 2;
        const x = CENTER + outer * Math.cos(angle);
        const y = CENTER + outer * Math.sin(angle);

        vertices.push(`${ x.toFixed(2) },${ y.toFixed(2) }`);
        index = (index + step) % points;
    }

    return vertices.join(' ');
};

export const GIRIH =
{
    /** Outer ten-sided frame. */
    frame: polygon(92, 10, -90),
    /** The interlaced {10/3} decagram rosette. */
    rosette: star(88, 10, 3, -90),
    /** A second {10/4} star, rotated, for the woven double-line look. */
    weave: star(78, 10, 4, -90),
    /** Inner decagon that "opens" (scales) on connect. */
    core: polygon(30, 10, -90)
};
