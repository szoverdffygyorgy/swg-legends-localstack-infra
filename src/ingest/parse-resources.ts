/**
 * Parses the SWGAide XML export into typed SWGResource objects.
 *
 * The XML structure (from swgaide.com) looks like:
 *
 *   <resource_data server_id="138" server_name="SWG Legends">
 *     <resources>
 *       <resource swgaide_id="1741089">
 *         <name>Teiadi</name>
 *         <type>Mustafarian Egg</type>
 *         <swgaide_type_id>muegg</swgaide_type_id>
 *         <stats>
 *           <dr>753</dr>
 *           <oq>794</oq>
 *           ...
 *         </stats>
 *         <planets>
 *           <planet swgaide_id="12">
 *             <name>Mustafar</name>
 *           </planet>
 *         </planets>
 *         <available_timestamp>1785579940</available_timestamp>
 *         <available_by>DGF</available_by>
 *       </resource>
 *     </resources>
 *   </resource_data>
 *
 * Key parsing challenges:
 * - XML attributes (swgaide_id) need special handling
 * - Stats vary per resource class (not all 11 are always present)
 * - Planets can be a single object or an array (XML parser quirk:
 *   a single child element becomes an object, multiple become an array)
 */

import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { SWGResource, ResourceStats, StatKey } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";

/**
 * Parse an SWGAide XML export file into SWGResource objects.
 */
export function parseResourceExport(filePath: string): SWGResource[] {
  const xml = readFileSync(filePath, "utf-8");

  // Configure the XML parser:
  // - ignoreAttributes: false -- we need swgaide_id from <resource> and <planet>
  // - attributeNamePrefix: "" -- don't prefix attribute names with "@_"
  // - isArray -- tell the parser which elements should always be arrays
  //   (handles the "single child = object, multiple children = array" quirk)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (name: string) => {
      // These elements can have 1 or many children.
      // Force them to always be arrays for consistent handling.
      return name === "resource" || name === "planet";
    },
  });

  const parsed = parser.parse(xml);
  const rawResources = parsed.resource_data.resources.resource;

  const resources: SWGResource[] = [];

  for (const raw of rawResources) {
    // Parse stats: only include stats that are present for this resource class
    const stats: ResourceStats = {};
    if (raw.stats) {
      for (const key of ALL_STAT_KEYS) {
        if (raw.stats[key] !== undefined) {
          stats[key] = Number(raw.stats[key]);
        }
      }
    }

    // Parse planets: extract the name from each planet element
    const planets: string[] = [];
    if (raw.planets?.planet) {
      for (const p of raw.planets.planet) {
        planets.push(p.name);
      }
    }

    resources.push({
      resourceId: String(raw.swgaide_id),
      resourceName: raw.name,
      resourceClass: raw.type,
      resourceClassId: raw.swgaide_type_id,
      stats,
      planets,
      availableTimestamp: Number(raw.available_timestamp),
      availableBy: raw.available_by ?? "Unknown",
    });
  }

  return resources;
}

// Allow running directly: npx tsx src/ingest/parse-resources.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2] || "data/currentresources_138.xml";
  console.log(`=== Parse SWGAide Resource Export ===\n`);
  console.log(`  Parsing: ${filePath}`);

  const resources = parseResourceExport(filePath);

  console.log(`  Parsed ${resources.length} resources\n`);

  // Print summary stats
  const planets = new Set(resources.flatMap((r) => r.planets));
  const classes = new Set(resources.map((r) => r.resourceClass));
  const multiPlanet = resources.filter((r) => r.planets.length > 1);

  console.log(`  Unique planets: ${planets.size} (${[...planets].sort().join(", ")})`);
  console.log(`  Unique resource classes: ${classes.size}`);
  console.log(`  Multi-planet resources: ${multiPlanet.length}`);

  // Print first 3 as samples
  console.log(`\n  Sample resources:`);
  for (const r of resources.slice(0, 3)) {
    const statStr = Object.entries(r.stats)
      .map(([k, v]) => `${k.toUpperCase()}=${v}`)
      .join(", ");
    console.log(
      `    ${r.resourceName} (${r.resourceClass}) [${r.planets.join(", ")}] ${statStr}`
    );
  }
}
