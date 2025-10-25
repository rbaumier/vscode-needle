import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LOG_FILE = path.join(os.tmpdir(), "go-to-fuzzy-debug.log");

export function log(...args: any[]): void {
  const timestamp = new Date().toISOString();
  const message = args.map(arg =>
    typeof arg === "object" ? JSON.stringify(arg, null, 2) : String(arg)
  ).join(" ");

  const logLine = `[${timestamp}] ${message}\n`;

  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (err) {
    // Fallback to console if file writing fails
    console.error("Failed to write log:", err);
  }
}

export function getLogPath(): string {
  return LOG_FILE;
}

export function clearLog(): void {
  try {
    fs.writeFileSync(LOG_FILE, "");
  } catch (err) {
    console.error("Failed to clear log:", err);
  }
}
