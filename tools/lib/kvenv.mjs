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
        { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      // A missing key and a failed call both exit non-zero, and telling them
      // apart matters: an absent key is an answer, a failed call is not. Read
      // as "absent", a failed budget read says zero spent, which is how a tool
      // talks itself past a spending ceiling. Cloudflare returns 404 for the
      // first and something else for the second, including the transient
      // authentication errors this CLI produces under load.
      const stderr = String(e.stderr || "");
      if (!/404: Not Found/.test(stderr)) {
        throw new Error(`kv read failed for ${key}: ${stderr.replace(/\s+/g, " ").slice(0, 160)}`);
      }
      // Not cached either way: a transient failure must not become a value
      // this process believes for its lifetime.
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

  // The third argument is the Worker KV options bag. Dropping it silently was
  // a divergence waiting to happen: the segment cache asks for a seven day
  // life, and a tool that ignores the TTL writes entries that never expire.
  const put = async (key, value, opts = {}) => {
    const file = join(tmp, "value.json");
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    const args = ["wrangler", "kv", "key", "put", key, "--path", file, "--namespace-id", NS, "--remote"];
    // The CLI spells it --ttl where the Worker binding spells it
    // expirationTtl. Getting that wrong is not a warning, it is a rejected
    // write, and the first symptom is a cache that is cold every single time.
    if (opts.expirationTtl) args.push("--ttl", String(Math.max(60, Math.floor(opts.expirationTtl))));
    execFileSync("npx", args, { cwd: root, stdio: ["ignore", "ignore", "inherit"], timeout: 180_000 });
    cache.set(key, typeof value === "string" ? value : JSON.stringify(value));
  };

  // Anything another writer can move under us has to be re-readable. The
  // Worker spends the same Exa balance this tool does, so a cached meter is a
  // meter that reads low, and a meter that reads low is an overspend.
  const uncache = (...keys) => keys.forEach((k) => cache.delete(k));

  return { STORE: { get, put }, uncache, ...extra };
}

// Secrets stay in .dev.vars and never reach a log line or an argv.
export function devVar(root, name) {
  const line = execFileSync("grep", [`^${name}=`, join(root, ".dev.vars")], { encoding: "utf8" }).trim();
  return line.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "");
}
