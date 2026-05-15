/**
 * Stop the dev server cleanly — without touching anything else.
 *
 * Targets ONLY processes whose command line is literally
 * `bun --hot server.ts` (the line from `package.json`'s `dev` script).
 * Port-based discovery (`lsof -ti:3000`) is explicitly avoided because
 * VS Code and other editors sometimes have transient processes near
 * common dev ports — killing those by port killed the editor in the
 * past.
 *
 * Usage:
 *   bun run kill           # graceful: SIGTERM then SIGKILL fallback
 *   bun run kill --force   # skip SIGTERM, go straight to SIGKILL
 */

import { $ } from "bun";

const MATCH = "bun --hot server.ts";
const FORCE = process.argv.includes("--force");

async function pidsMatching(): Promise<number[]> {
  // `pgrep -f` matches against the full command line, not just argv[0].
  // We re-validate each match against the literal `MATCH` substring so a
  // partial regex match (e.g. someone else's wrapper) can't escalate.
  const text = await $`pgrep -af "bun --hot server\\.ts"`.text().catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.includes(MATCH))
    .map((line) => Number(line.split(/\s+/)[0]))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

const initial = await pidsMatching();
if (initial.length === 0) {
  console.log(`No "${MATCH}" process found.`);
  process.exit(0);
}

const signal = FORCE ? "SIGKILL" : "SIGTERM";
console.log(`Sending ${signal} to: ${initial.join(", ")}`);
for (const pid of initial) {
  try {
    process.kill(pid, signal);
  } catch (err) {
    console.warn(`  pid ${pid}: ${(err as Error).message}`);
  }
}

if (FORCE) {
  console.log("Done.");
  process.exit(0);
}

// Give SIGTERM up to ~1s to take effect, then escalate.
for (let i = 0; i < 5; i++) {
  await new Promise((r) => setTimeout(r, 200));
  const still = await pidsMatching();
  if (still.length === 0) {
    console.log("Stopped.");
    process.exit(0);
  }
}

const stuck = await pidsMatching();
if (stuck.length > 0) {
  console.log(`Escalating SIGKILL to: ${stuck.join(", ")}`);
  for (const pid of stuck) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (err) {
      console.warn(`  pid ${pid}: ${(err as Error).message}`);
    }
  }
  await new Promise((r) => setTimeout(r, 200));
  const survivors = await pidsMatching();
  if (survivors.length > 0) {
    console.error(`Failed to stop: ${survivors.join(", ")}`);
    process.exit(1);
  }
}
console.log("Stopped.");
