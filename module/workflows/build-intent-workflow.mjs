import {mkdir, copyFile} from "node:fs/promises";
const target = new URL("../dist/workflows/optimize-intent/", import.meta.url);
await mkdir(target, {recursive: true});
await copyFile(new URL("./optimize-intent/SKILL.md", import.meta.url), new URL("SKILL.md", target));
