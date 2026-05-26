import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function loadDotEnv() {
  try {
    const content = await readFile(resolve(".env"), "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const index = line.indexOf("=");
      if (index === -1) continue;

      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env is optional so the app can still show a clear missing-key status.
  }
}
