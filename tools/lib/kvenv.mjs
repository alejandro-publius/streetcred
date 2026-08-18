// A Worker-shaped `env` for Node, backed by the wrangler CLI.
//
// src/press.js and src/voices.js run inside the Worker on the cron. The same
// code has to be runnable by hand, because "wait until 06:10 tomorrow" is not
// a way to rebuild the watchlist after a sweep. Rather than fork the logic
// into a tool, this hands the real modules the two methods they use.
//
// Reads are the common case and are cached here, because a KV read is a CLI
// round trip and the city index is read once per candidate.

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NS = "6918c07a1e1540f0ac9b6c499c5917b7";

export function kvEnv(root, extra = {}) {
  const cache = new Map();
  const tmp = mkdtempSync(join(tmpdir(), "streetcred-kv-"));

  const get = async (key, type) => {
    if (cache.has(key)) return cache.get(key);
    let out = null;
    try {
      out = execFileSync(
        "npx",
        ["wrangler", "kv", "key", "get", key, "--namespace-id", NS, "--remote"],
        { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      // A missing key and a failed CLI call both exit non-zero and are
      // indistinguishable here, so neither is cached. Caching would turn one
      // transient failure into a value this process believes for its lifetime,
      // which is how a verification bar silently switches itself off.
      return null;
    }
    let value = out;
    if (out != null && type === "json") {
      try {
        value = JSON.parse(out);
      } catch {
        value = null;
      }
    }
    cache.set(key, value);
    return value;
  };

  const put = async (key, value) => {
    const file = join(tmp, "value.json");
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    execFileSync(
      "npx",
      ["wrangler", "kv", "key", "put", key, "--path", file, "--namespace-id", NS, "--remote"],
      { cwd: root, stdio: ["ignore", "ignore", "inherit"], timeout: 180_000 },
    );
    cache.set(key, typeof value === "string" ? value : JSON.stringify(value));
  };

  return { STORE: { get, put }, ...extra };
}

// Secrets stay in .dev.vars and never reach a log line or an argv.
export function devVar(root, name) {
  const line = execFileSync("grep", [`^${name}=`, join(root, ".dev.vars")], { encoding: "utf8" }).trim();
  return line.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
}
