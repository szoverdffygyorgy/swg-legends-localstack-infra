/**
 * Parses the SWGAide schematics XML export into typed Schematic objects.
 *
 * The XML structure looks like:
 *
 *   <schematics last_updated="2021-08-03 06:25:21 UTC">
 *     <schematic name="Dual Wave Synthesizer" id="1717" category="767" base="nge">
 *       <misc desc="This device is..."/>
 *       <statistics complexity="15" data="1" xp="0" manufacture="yes" type="Regular" crate="0" quality="lq"/>
 *       <level profession="830" level="22"/>
 *       <resource id="inp" units="20" desc="Synthesis Data Storage"/>
 *       <resource id="fer" units="20" desc="Wave Translation Head"/>
 *       <component id="200" type="schematic" number="1" similar="no" optional="no" looted="no" desc="liner"/>
 *       <exp_grp desc="Experimental Effectiveness">
 *         <exp desc="Quality" cd="100"/>
 *       </exp_grp>
 *     </schematic>
 *   </schematics>
 *
 * Key parsing challenges:
 * - All data is in XML attributes (not text content)
 * - resource/component/exp_grp/exp elements can be single or multiple (array quirk)
 * - Experimental property weights are stat abbreviations as attribute names (e.g., oq="50" sr="50")
 * - Resource class IDs (e.g., "mtl") must be resolved to class names via the mapping file
 */

import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import type { Schematic, SchematicIngredient, ExperimentalGroup, ExperimentalProperty, StatKey } from "../types.js";
import { ALL_STAT_KEYS } from "../types.js";

// Load the SWGAide abbreviation -> className mapping
import classMapJson from "../data/swgaide-class-map.json" with { type: "json" };
const classMap = classMapJson as Record<string, string>;

export interface SchematicParseResult {
  schematics: Schematic[];
  unresolvedClassIds: Set<string>;
}

/**
 * Parse the SWGAide schematics XML export.
 * Returns typed Schematic objects with resolved resource class names.
 */
export function parseSchematicExport(filePath: string): SchematicParseResult {
  const xml = readFileSync(filePath, "utf-8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (name: string) => {
      // These elements can have 1 or many children per schematic
      return (
        name === "schematic" ||
        name === "resource" ||
        name === "component" ||
        name === "exp_grp" ||
        name === "exp"
      );
    },
  });

  const parsed = parser.parse(xml);
  const rawSchematics = parsed.schematics.schematic;

  const schematics: Schematic[] = [];
  const unresolvedClassIds = new Set<string>();

  for (const raw of rawSchematics) {
    // ─── Metadata ─────────────────────────────────────────────────
    const schematicId = String(raw.id);
    const name = raw.name ?? "";
    const category = String(raw.category ?? "0");
    const base = (raw.base === "nge" ? "nge" : "precu") as "nge" | "precu";

    const description = raw.misc?.desc ?? "";

    const stats = raw.statistics ?? {};
    const complexity = Number(stats.complexity ?? 0);
    const xp = Number(stats.xp ?? 0);
    const dataSize = Number(stats.data ?? 1);
    const manufacture = stats.manufacture === "yes";
    const type = stats.type ?? "Regular";
    const crateSize = Number(stats.crate ?? 0);
    const quality = stats.quality ?? "n/a";

    const level = raw.level ?? {};
    const profession = String(level.profession ?? "");
    const professionLevel = Number(level.level ?? 0);

    // ─── Ingredients ──────────────────────────────────────────────
    const ingredients: SchematicIngredient[] = [];

    // Resource ingredients
    if (raw.resource) {
      for (const res of raw.resource) {
        const classId = res.id ?? "";
        const className = classMap[classId];

        if (!className && classId) {
          unresolvedClassIds.add(classId);
        }

        ingredients.push({
          type: "resource",
          classId,
          className: className ?? undefined,
          desc: res.desc ?? "",
          units: Number(res.units ?? 0),
        });
      }
    }

    // Component ingredients
    if (raw.component) {
      for (const comp of raw.component) {
        ingredients.push({
          type: "component",
          componentId: String(comp.id ?? ""),
          componentType: comp.type ?? "",
          desc: comp.desc ?? "",
          count: Number(comp.number ?? 1),
          similar: comp.similar === "yes",
          optional: comp.optional === "yes",
        });
      }
    }

    // ─── Experimental groups ──────────────────────────────────────
    const experimentalGroups: ExperimentalGroup[] = [];

    if (raw.exp_grp) {
      for (const grp of raw.exp_grp) {
        const properties: ExperimentalProperty[] = [];

        if (grp.exp) {
          for (const exp of grp.exp) {
            // Stat weights are attributes like oq="50" sr="50"
            const weights: Partial<Record<StatKey, number>> = {};
            for (const statKey of ALL_STAT_KEYS) {
              if (exp[statKey] !== undefined) {
                weights[statKey] = Number(exp[statKey]);
              }
            }

            if (Object.keys(weights).length > 0) {
              properties.push({
                name: exp.desc ?? "",
                weights,
              });
            }
          }
        }

        if (properties.length > 0) {
          experimentalGroups.push({
            group: grp.desc ?? "",
            properties,
          });
        }
      }
    }

    schematics.push({
      schematicId,
      name,
      category,
      base,
      description,
      complexity,
      xp,
      dataSize,
      manufacture,
      type,
      crateSize,
      quality,
      profession,
      professionLevel,
      ingredients,
      experimentalGroups,
    });
  }

  return { schematics, unresolvedClassIds };
}

// Allow running directly: npx tsx src/ingest/parse-schematics.ts [filePath]
if (import.meta.url === `file://${process.argv[1]}`) {
  const filePath = process.argv[2] || "data/schematics_unity.xml";
  console.log("=== Parse SWGAide Schematics Export ===\n");
  console.log(`  Parsing: ${filePath}`);

  const { schematics, unresolvedClassIds } = parseSchematicExport(filePath);

  // ─── Summary statistics ─────────────────────────────────────────
  const nge = schematics.filter((s) => s.base === "nge");
  const precu = schematics.filter((s) => s.base === "precu");
  const withExpGroups = schematics.filter((s) => s.experimentalGroups.length > 0);
  const withComponents = schematics.filter((s) =>
    s.ingredients.some((i) => i.type === "component")
  );
  const manufacturable = schematics.filter((s) => s.manufacture);

  // Unique resource classes referenced
  const resourceClasses = new Set<string>();
  const resolvedClasses = new Set<string>();
  for (const s of schematics) {
    for (const ing of s.ingredients) {
      if (ing.type === "resource" && ing.classId) {
        resourceClasses.add(ing.classId);
        if (ing.className) resolvedClasses.add(ing.className);
      }
    }
  }

  // Unique categories
  const categories = new Set(schematics.map((s) => s.category));

  // Stat usage in experimental groups
  const statUsage = new Map<string, number>();
  for (const s of schematics) {
    for (const grp of s.experimentalGroups) {
      for (const prop of grp.properties) {
        for (const key of Object.keys(prop.weights)) {
          statUsage.set(key, (statUsage.get(key) ?? 0) + 1);
        }
      }
    }
  }

  console.log(`\n=== Schematics Summary ===\n`);
  console.log(`  Total schematics:     ${schematics.length}`);
  console.log(`    NGE:                ${nge.length}`);
  console.log(`    Pre-CU:             ${precu.length}`);
  console.log(`  Manufacturable:       ${manufacturable.length}`);
  console.log(`  With exp. groups:     ${withExpGroups.length}`);
  console.log(`  With components:      ${withComponents.length}`);
  console.log(`  Unique categories:    ${categories.size}`);
  console.log(`  Unique resource IDs:  ${resourceClasses.size}`);
  console.log(`  Resolved class names: ${resolvedClasses.size}`);
  console.log(`  Unresolved class IDs: ${unresolvedClassIds.size}`);

  if (unresolvedClassIds.size > 0) {
    console.log(`\n  WARNING: Unresolved resource class IDs:`);
    for (const id of [...unresolvedClassIds].sort()) {
      console.log(`    ${id}`);
    }
  }

  console.log(`\n  Stat usage in experimental groups:`);
  for (const [key, count] of [...statUsage.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${key.toUpperCase()}: ${count} properties`);
  }

  // Sample schematics
  console.log(`\n  Sample schematics (first 3 NGE with exp groups):`);
  const samples = nge.filter((s) => s.experimentalGroups.length > 0).slice(0, 3);
  for (const s of samples) {
    console.log(`\n    ${s.name} (ID: ${s.schematicId}, category: ${s.category})`);
    console.log(`      ${s.base} | complexity: ${s.complexity} | xp: ${s.xp}`);
    console.log(`      Ingredients:`);
    for (const ing of s.ingredients) {
      if (ing.type === "resource") {
        console.log(`        ${ing.units} x ${ing.className ?? ing.classId} (${ing.desc})`);
      } else {
        console.log(`        ${ing.count} x [component] ${ing.componentId} (${ing.desc})`);
      }
    }
    console.log(`      Experimental groups:`);
    for (const grp of s.experimentalGroups) {
      console.log(`        ${grp.group}:`);
      for (const prop of grp.properties) {
        const weights = Object.entries(prop.weights)
          .map(([k, v]) => `${k.toUpperCase()}=${v}%`)
          .join(", ");
        console.log(`          ${prop.name}: ${weights}`);
      }
    }
  }

  console.log("");
}
