// Number formatting for the compiler's output and diagnostics.

/** x rounded to n decimals, as a number (toFixed rounds the exact binary value). */
export const round = (x, n) => Number(x.toFixed(n));

/** x to p significant digits, without trailing zeros (diagnostics). */
export const sig = (x, p = 6) => String(Number(x.toPrecision(p)));
