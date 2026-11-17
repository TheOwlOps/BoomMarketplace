#!/usr/bin/env node
/**
 * check-pin-drift.mjs — report MCP catalog pins that upstream has moved past.
 *
 * The MCP section of this catalog pins exact upstream versions on
 * purpose: a new upstream release is adopted only after it has been
 * vetted, never automatically. This script is the lookout for that
 * process, and nothing more:
 *
 *   - For every entry whose install hint pins an npm or PyPI package,
 *     it asks the registry for the current latest version and reports
 *     pinned vs latest.
 *   - It NEVER edits a file, bumps a pin, or opens a PR. Adopting a
 *     newer version stays a deliberate, vetted change made by hand.
 *   - Remote (hosted) entries carry no version pin, and the vendored
 *     entry tracks Boom's own fork, so both are listed as skipped —
 *     there is nothing to drift.
 *
 * A registry that cannot be reached (offline, rate-limited) marks
 * its entries "unknown" instead of failing the run: the report is
 * advisory, so a partial report beats no report. The run only fails
 * when the catalog itself cannot be read.
 *
 *   node scripts/check-pin-drift.mjs [--catalog marketplace.json]
 *
 * In CI (see .github/workflows/pin-drift.yml) the same report is
 * written to the job summary.
 */

import { appendFileSync, readFileSync } from "node:fs";

const FETCH_TIMEOUT_MS = 15000;

function parseArgs(argv) {
  const opts = { catalog: "marketplace.json" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--catalog") opts.catalog = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: node scripts/check-pin-drift.mjs [--catalog marketplace.json]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${argv[i]}`);
      process.exit(2);
    }
  }
  return opts;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function latestVersion(kind, pkg) {
  if (kind === "npm") {
    const data = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`);
    return typeof data?.version === "string" ? data.version : null;
  }
  const data = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
  return typeof data?.info?.version === "string" ? data.info.version : null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(opts.catalog, "utf8"));
  } catch (e) {
    console.error(`check-pin-drift: cannot read ${opts.catalog}: ${e.message}`);
    process.exit(1);
  }
  const entries = Array.isArray(catalog.entries) ? catalog.entries : [];

  const drifted = [];
  const current = [];
  const unknown = [];
  const skipped = [];
  for (const entry of entries) {
    const hint = entry?.install;
    if (!hint || (hint.kind !== "npm" && hint.kind !== "pypi")) {
      skipped.push({ id: entry?.id ?? "?", why: hint?.kind ? `kind=${hint.kind}` : "metadata only" });
      continue;
    }
    const pinned = hint.version || entry.version || "";
    if (!pinned || typeof hint.package !== "string" || hint.package === "") {
      unknown.push({ id: entry.id, pinned, why: "entry carries no usable pin" });
      continue;
    }
    try {
      const latest = await latestVersion(hint.kind, hint.package);
      if (!latest) unknown.push({ id: entry.id, pinned, why: "registry returned no version" });
      else if (latest === pinned) current.push({ id: entry.id, pinned });
      else drifted.push({ id: entry.id, kind: hint.kind, package: hint.package, pinned, latest });
    } catch (e) {
      unknown.push({ id: entry.id, pinned, why: `registry unreachable (${e.message})` });
    }
  }

  const lines = [];
  lines.push(`check-pin-drift: ${entries.length} catalog entries`);
  lines.push(`  drifted (upstream has a newer release): ${drifted.length}`);
  for (const d of drifted) lines.push(`    - ${d.id} (${d.package}): pinned ${d.pinned} → latest ${d.latest}`);
  lines.push(`  up to date: ${current.length}`);
  lines.push(`  unknown (registry unreachable or unusable pin): ${unknown.length}`);
  for (const u of unknown) lines.push(`    - ${u.id}: pinned ${u.pinned || "?"} — ${u.why}`);
  lines.push(`  skipped (no registry pin to drift): ${skipped.length}`);
  lines.push("");
  lines.push("Drift is a prompt to vet the new release, never an instruction to bump:");
  lines.push("pins in this catalog change only through a reviewed update.");
  console.log(lines.join("\n"));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [
      "## Pin drift report",
      "",
      `${drifted.length} of ${entries.length} entries pin a version upstream has moved past. ` +
        "Adopting a newer version requires the usual vetting pass — this report changes nothing by itself.",
      "",
    ];
    if (drifted.length) {
      md.push("| Entry | Package | Pinned | Latest |", "|---|---|---|---|");
      for (const d of drifted) md.push(`| ${d.id} | ${d.package} | ${d.pinned} | ${d.latest} |`);
      md.push("");
    }
    if (unknown.length) {
      md.push(`Unknown (registry unreachable): ${unknown.map((u) => u.id).join(", ")}`, "");
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n"));
  }
}

await main();
