import react from "@vitejs/plugin-react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version?: string;
};

function git(args: string[]) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

const gitStatus = git(["status", "--porcelain"]);

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version ?? "0.0.0"),
    __APP_COMMIT__: JSON.stringify(git(["rev-parse", "--short", "HEAD"])),
    __APP_DIRTY__: JSON.stringify(Boolean(gitStatus)),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString())
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4174"
    }
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true
  }
});
