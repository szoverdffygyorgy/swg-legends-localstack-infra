/**
 * Downloads and decompresses the SWGAide resource export for SWG Legends.
 *
 * What this does:
 * 1. Fetches the gzipped XML from swgaide.com
 * 2. Decompresses it using Node.js built-in zlib (no extra deps)
 * 3. Writes the raw XML to data/currentresources_138.xml
 *
 * Skips the download if the file already exists and is less than 30
 * minutes old (SWGAide updates roughly every 30 minutes).
 *
 * Why download + decompress ourselves instead of using a library?
 * - Node.js has built-in HTTP (node:https) and gzip (node:zlib) support
 * - The file is small (~200KB compressed, ~1.5MB uncompressed)
 * - No external dependencies needed for something this simple
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { get } from "node:https";
import { SWGAIDE_RESOURCES_URL } from "../config.js";

const DATA_DIR = "data";
const OUTPUT_FILE = `${DATA_DIR}/currentresources_138.xml`;
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Downloads the SWGAide resource export if needed.
 * Returns the path to the local XML file.
 */
export async function downloadResourceExport(): Promise<string> {
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
      const ageMin = Math.round(ageMs / 60000);
      console.log(
        `  Skipping download: ${OUTPUT_FILE} is ${ageMin} min old (< 30 min)`
      );
      return OUTPUT_FILE;
    }
  }

  console.log(`  Downloading from ${SWGAIDE_RESOURCES_URL}...`);

  // Download and decompress in a single streaming pipeline:
  // HTTP response -> gunzip -> file
  //
  // This is memory-efficient: we never hold the entire file in memory.
  // The data flows through the pipeline chunk by chunk.
  await new Promise<void>((resolve, reject) => {
    get(SWGAIDE_RESOURCES_URL, (response) => {
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

// Allow running directly: npx tsx src/ingest/download.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("=== Download SWGAide Resource Export ===\n");
  downloadResourceExport()
    .then((path) => console.log(`\nDone: ${path}`))
    .catch((err) => {
      console.error("Download failed:", err);
      process.exit(1);
    });
}
