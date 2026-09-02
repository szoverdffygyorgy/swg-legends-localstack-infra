/**
 * Downloads and decompresses the SWGAide schematics export.
 *
 * The schematics data is static game data -- it only changes when the
 * game is patched (very rarely). The file is cached for 24 hours.
 *
 * Run with: npx tsx src/ingest/download-schematics.ts
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { get } from "node:https";
import { SWGAIDE_SCHEMATICS_URL } from "../config.js";

const DATA_DIR = "data";
const OUTPUT_FILE = `${DATA_DIR}/schematics_unity.xml`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours (static data, rarely changes)

/**
 * Downloads the SWGAide schematics export if needed.
 * Returns the path to the local XML file.
 */
export async function downloadSchematicExport(): Promise<string> {
  // Create data/ directory if it doesn't exist
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    console.log(`  Created ${DATA_DIR}/ directory`);
  }

  // Skip download if file is fresh
  if (existsSync(OUTPUT_FILE)) {
    const stats = statSync(OUTPUT_FILE);
    const ageMs = Date.now() - stats.mtimeMs;
    if (ageMs < MAX_AGE_MS) {
      const ageHrs = Math.round(ageMs / 3600000);
      console.log(
        `  Skipping download: ${OUTPUT_FILE} is ${ageHrs}h old (< 24h)`
      );
      return OUTPUT_FILE;
    }
  }

  console.log(`  Downloading from ${SWGAIDE_SCHEMATICS_URL}...`);

  await new Promise<void>((resolve, reject) => {
    get(SWGAIDE_SCHEMATICS_URL, (response) => {
      if (response.statusCode !== 200) {
        reject(
          new Error(
            `Download failed: HTTP ${response.statusCode} ${response.statusMessage}`
          )
        );
        return;
      }

      const gunzip = createGunzip();
      const fileStream = createWriteStream(OUTPUT_FILE);

      pipeline(response, gunzip, fileStream).then(resolve).catch(reject);
    }).on("error", reject);
  });

  const size = statSync(OUTPUT_FILE).size;
  const sizeKB = Math.round(size / 1024);
  console.log(`  Downloaded and decompressed: ${OUTPUT_FILE} (${sizeKB} KB)`);

  return OUTPUT_FILE;
}

// Allow running directly: npx tsx src/ingest/download-schematics.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("=== Download SWGAide Schematics Export ===\n");
  downloadSchematicExport()
    .then((path) => console.log(`\nDone: ${path}`))
    .catch((err) => {
      console.error("Download failed:", err);
      process.exit(1);
    });
}
