/**
 * bot-index.mjs — derive the bot component index from the catalog.
 *
 * The index answers one question for the app: "what does this listing
 * contain?" — the bundled skill names + descriptions, the routine
 * names, and the connector/channel requirements — without downloading
 * and verifying every package file just to render a list of cards.
 * It is GENERATED data: `scripts/generate-bot-index.mjs` writes it,
 * the validate-bots gate (check 10) fails if the committed copy is
 * stale, and the app ignores any record whose recorded pin does not
 * match the pin in bots.json, so a stale index can never misdescribe
 * a listing.
 *
 * Derivation is purely local: the package files live in this repo,
 * so building the index needs no network access. The output is
 * deterministic — sorted listing keys, authored component order, no
 * timestamps — so a byte comparison is a valid freshness check.
 *
 * No dependencies beyond the Node standard library.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const BOT_INDEX_VERSION = 1;

// Index descriptions are snippets for list/search surfaces; the full
// text always lives in the package itself.
const MAX_DESCRIPTION_CHARS = 200;

function cleanSnippet(text) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_DESCRIPTION_CHARS) return flat;
  return flat.slice(0, MAX_DESCRIPTION_CHARS - 1).trimEnd() + "…";
}

/**
 * The `description` out of a SKILL.md frontmatter block. Handles the
 * shapes Boom skills actually use: a plain one-line value, a quoted
 * value, or a `>` / `|` block of indented lines. Returns "" when the
 * file carries no usable frontmatter description.
 */
export function skillDescription(skillMd) {
  if (typeof skillMd !== "string") return "";
  const lines = skillMd.split("\n");
  if (lines[0]?.trim() !== "---") return "";
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---" || line.trim() === "...") break;
    const m = line.match(/^description:\s*(.*)$/);
    if (!m) continue;
    let value = m[1].trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (!/^\s/.test(lines[j])) break;
        if (lines[j].trim()) block.push(lines[j].trim());
      }
      value = block.join(" ");
    } else if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1);
    }
    return cleanSnippet(value);
  }
  return "";
}

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const stringList = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim() !== "") : [];

/**
 * Build the index object from parsed catalog data.
 *
 * `index` is the parsed bots.json value; `packages` is a Map of
 * repo-relative package path → parsed package value (or null when a
 * file did not parse). Entries whose package is missing or unusable
 * are skipped — the gate's other checks report those problems; the
 * index only ever describes packages that are actually there.
 */
export function buildBotIndex(index, packages) {
  const bots = {};
  const entries = Array.isArray(index?.bots) ? index.bots : [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    const { key, package: rel, sha256 } = entry;
    if (typeof key !== "string" || typeof rel !== "string" || typeof sha256 !== "string") {
      continue;
    }
    const pkg = packages.get(rel);
    if (!isPlainObject(pkg)) continue;
    const skills = [];
    if (Array.isArray(pkg.skills)) {
      for (const s of pkg.skills) {
        if (!isPlainObject(s) || typeof s.name !== "string") continue;
        const item = { name: s.name };
        const description = skillDescription(s.skill_md);
        if (description) item.description = description;
        skills.push(item);
      }
    }
    const routines = [];
    if (Array.isArray(pkg.routines)) {
      for (const r of pkg.routines) {
        if (isPlainObject(r) && typeof r.name === "string" && r.name.trim() !== "") {
          routines.push({ name: r.name });
        }
      }
    }
    bots[key] = {
      sha256,
      components: {
        skills,
        routines,
        requires: stringList(pkg.requires),
      },
    };
  }
  const sorted = {};
  for (const key of Object.keys(bots).sort()) sorted[key] = bots[key];
  return { version: BOT_INDEX_VERSION, bots: sorted };
}

/** The canonical byte form of the index (what freshness compares). */
export function renderBotIndex(indexObj) {
  return JSON.stringify(indexObj, null, 2) + "\n";
}

/**
 * Load a catalog directory (bots.json + packages/**) from disk in
 * the shape buildBotIndex consumes. Used by the generator CLI and
 * the validator's tests; the gate itself loads through its own
 * snapshot code and passes the same shapes in.
 */
export function loadCatalogDir(root) {
  let index = null;
  const indexPath = join(root, "bots.json");
  if (existsSync(indexPath)) {
    try {
      index = JSON.parse(readFileSync(indexPath, "utf8"));
    } catch {
      index = null;
    }
  }
  const packages = new Map();
  const pkgRoot = join(root, "packages");
  if (existsSync(pkgRoot)) {
    for (const handle of readdirSync(pkgRoot)) {
      const handleDir = join(pkgRoot, handle);
      if (!statSync(handleDir).isDirectory()) continue;
      for (const file of readdirSync(handleDir)) {
        if (!file.endsWith(".json")) continue;
        let value = null;
        try {
          value = JSON.parse(readFileSync(join(handleDir, file), "utf8"));
        } catch {
          value = null;
        }
        packages.set(`packages/${handle}/${file}`, value);
      }
    }
  }
  return { index, packages };
}
