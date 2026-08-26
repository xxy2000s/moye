import { rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const target = path.resolve(root, "package-dist");
if (path.dirname(target) !== root || path.basename(target) !== "package-dist") throw new Error("unsafe package output path");
await rm(target, { recursive: true, force: true });
