#!/usr/bin/env node
/**
 * generate-bot-index.mjs — regenerate bot-index.json from the catalog.
 *
 * Run this after adding or changing a bot listing, and commit the
 * result with the listing change:
 *
 *   node scripts/generate-bot-index.mjs
 *
 * `--check` writes nothing and exits 1 when the committed file is
 * stale (the same comparison the validate-bots gate runs as its
 * check 10). The derivation lives in scripts/bot-index.mjs and is
 * fully local — package files are read from this repo.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBotIndex, loadCatalogDir, renderBotIndex } from "./bot-index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = join(root, "bot-index.json");
const check = process.argv.includes("--check");

const { index, packages } = loadCatalogDir(root);
if (!index) {
  console.error("generate-bot-index: bots.json is missing or does not parse");
  process.exit(1);
}
const rendered = renderBotIndex(buildBotIndex(index, packages));

if (check) {
  const committed = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  if (committed !== rendered) {
    console.error(
      "generate-bot-index: bot-index.json is out of date — run `node scripts/generate-bot-index.mjs` and commit the result",
    );
    process.exit(1);
  }
  console.log("generate-bot-index: bot-index.json is up to date");
} else {
  writeFileSync(indexPath, rendered);
  console.log(`generate-bot-index: wrote bot-index.json (${Object.keys(JSON.parse(rendered).bots).length} listing(s))`);
}
