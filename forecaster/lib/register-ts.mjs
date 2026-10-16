// Loaded with `node --import` (see tools.mjs): registers ts-hooks.mjs for this process.
import { register } from "node:module";

register("./ts-hooks.mjs", import.meta.url);
