import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const DEFAULT_LOG_PATH = path.resolve("data", "app.log");

export function resolveLogPath(logPath: string | null | undefined) {
  return logPath?.trim() || DEFAULT_LOG_PATH;
}

export function appendLog(logPath: string, enabled: boolean, level: "info" | "warn" | "error", message: string, meta?: unknown) {
  if (!enabled) return;
  const target = resolveLogPath(logPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const suffix = meta ? ` ${safeJson(meta)}` : "";
  fs.appendFileSync(target, `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix}\n`);
}

export function readRecentLogs(logPath: string, maxLines = 200) {
  const target = resolveLogPath(logPath);
  if (!fs.existsSync(target)) return { path: target, lines: [] };
  const lines = fs.readFileSync(target, "utf8").trimEnd().split("\n");
  return { path: target, lines: lines.slice(-maxLines) };
}

export async function openLogFolder(logPath: string) {
  const folder = path.dirname(resolveLogPath(logPath));
  fs.mkdirSync(folder, { recursive: true });
  if (process.platform === "darwin") {
    await execFileAsync("open", [folder]);
  } else if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", folder]);
  } else {
    await execFileAsync("xdg-open", [folder]);
  }
  return folder;
}

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, nested) => {
    if (typeof nested === "string" && nested.length > 160) return `${nested.slice(0, 160)}...`;
    return nested;
  });
}
