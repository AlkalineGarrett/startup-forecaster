// fictional business-register series: registered small field-service firms, by year
import { writeFileSync } from "node:fs";
import { data, dumps, fx, N } from "./_shared.mjs";

const pts = [[2019, 13120], [2021, 13350], [2022, 13740], [2023, 14260]];
const [y0, v0] = pts[0], [y1, v1] = pts[pts.length - 1];
const cagr = Math.pow(v1 / v0, 1 / (y1 - y0)) - 1;
const target = 2026, ext = v1 * Math.pow(1 + cagr, target - y1);
const line = [[y0, v0], [target, Math.round(ext)]];
writeFileSync(data("ts_curve.json"), dumps({ points: pts, cagr: (cagr), target, extrapolated: Math.round(ext), line }));
console.log(`CAGR ${fx(cagr, 4)} (${fx(cagr * 100, 1)}%/yr); extrapolate to ${target} = ${fx(ext, 0)}`);
