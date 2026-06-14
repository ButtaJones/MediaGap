import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppMeta } from "../../shared/types.js";

const projectRoot = fileURLToPath(new URL("../../..", import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
  version?: string;
};

function git(args: string[]) {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

export function getAppMeta(): AppMeta {
  const status = git(["status", "--porcelain"]);
  return {
    version: process.env.APP_VERSION || packageJson.version || "0.0.0",
    commit: process.env.APP_COMMIT || git(["rev-parse", "--short", "HEAD"]),
    dirty: status ? status.length > 0 : false,
    builtAt: process.env.APP_BUILT_AT || null
  };
}
