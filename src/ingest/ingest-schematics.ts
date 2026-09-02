/**
 * Schematics ingestion pipeline (dry run).
 *
 * Downloads the SWGAide schematics export, parses all schematics,
 * validates the data, and prints a comprehensive summary.
 *
 * No DynamoDB writes -- this is a dry run to validate the pipeline
 * before provisioning infrastructure.
 *
 * Run with: npm run schematics:ingest
 */

import { downloadSchematicExport } from "./download-schematics.js";
import { parseSchematicExport } from "./parse-schematics.js";

async function main(): Promise<void> {
  console.log("=== Schematics Ingestion Pipeline (Dry Run) ===\n");

  // Step 1: Download
  console.log("Step 1: Download schematics export");
  const xmlPath = await downloadSchematicExport();
  console.log("");

  // Step 2: Parse
  console.log("Step 2: Parse schematics XML");
  const { schematics, unresolvedClassIds } = parseSchematicExport(xmlPath);
  console.log(`  Parsed ${schematics.length} schematics`);
  console.log("");

  // Step 3: Validate
  console.log("Step 3: Validate");

  const nge = schematics.filter((s) => s.base === "nge");
  const precu = schematics.filter((s) => s.base === "precu");
  const withExpGroups = schematics.filter((s) => s.experimentalGroups.length > 0);
  const withComponents = schematics.filter((s) =>
    s.ingredients.some((i) => i.type === "component")
  );
  const manufacturable = schematics.filter((s) => s.manufacture);
  const withDescription = schematics.filter((s) => s.description.length > 0);

  // Ingredient stats
  let totalResourceSlots = 0;
  let totalComponentSlots = 0;
  const resourceClasses = new Set<string>();
  const resolvedClasses = new Set<string>();

  for (const s of schematics) {
    for (const ing of s.ingredients) {
      if (ing.type === "resource") {
        totalResourceSlots++;
        if (ing.classId) resourceClasses.add(ing.classId);
        if (ing.className) resolvedClasses.add(ing.className);
      } else {
        totalComponentSlots++;
      }
    }
  }

  // Experimental group stats
  let totalExpGroups = 0;
  let totalExpProperties = 0;
  const statUsage = new Map<string, number>();

  for (const s of schematics) {
    totalExpGroups += s.experimentalGroups.length;
    for (const grp of s.experimentalGroups) {
      totalExpProperties += grp.properties.length;
      for (const prop of grp.properties) {
        for (const key of Object.keys(prop.weights)) {
          statUsage.set(key, (statUsage.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // Quality breakdown
  const qualityBreakdown = new Map<string, number>();
  for (const s of schematics) {
    qualityBreakdown.set(s.quality, (qualityBreakdown.get(s.quality) ?? 0) + 1);
  }

  const categories = new Set(schematics.map((s) => s.category));

  console.log(`\n=== VALIDATION RESULTS ===\n`);

  console.log("  Schematics");
  console.log(`    Total:              ${schematics.length}`);
  console.log(`    NGE:                ${nge.length}`);
  console.log(`    Pre-CU:             ${precu.length}`);
  console.log(`    Manufacturable:     ${manufacturable.length}`);
  console.log(`    With description:   ${withDescription.length}`);
  console.log(`    Unique categories:  ${categories.size}`);

  console.log("");
  console.log("  Ingredients");
  console.log(`    Resource slots:     ${totalResourceSlots}`);
  console.log(`    Component slots:    ${totalComponentSlots}`);
  console.log(`    Unique class IDs:   ${resourceClasses.size}`);
  console.log(`    Resolved names:     ${resolvedClasses.size}`);
  console.log(`    Unresolved IDs:     ${unresolvedClassIds.size}`);

  console.log("");
  console.log("  Experimental Groups");
  console.log(`    Schematics w/ exp:  ${withExpGroups.length}`);
  console.log(`    Total groups:       ${totalExpGroups}`);
  console.log(`    Total properties:   ${totalExpProperties}`);
  console.log(`    Schematics w/ components: ${withComponents.length}`);

  console.log("");
  console.log("  Quality breakdown:");
  for (const [q, count] of [...qualityBreakdown.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${q}: ${count}`);
  }

  console.log("");
  console.log("  Stat usage in experiments:");
  for (const [key, count] of [...statUsage.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${key.toUpperCase()}: ${count} properties`);
  }

  if (unresolvedClassIds.size > 0) {
    console.log("");
    console.log("  WARNING: Unresolved resource class IDs:");
    for (const id of [...unresolvedClassIds].sort()) {
      console.log(`    ${id}`);
    }
  }

  // Print sample schematics
  console.log("\n=== SAMPLE SCHEMATICS ===\n");
  const samples = nge.filter((s) => s.experimentalGroups.length > 0).slice(0, 5);
  for (const s of samples) {
    console.log(`  ${s.name} (ID: ${s.schematicId})`);
    console.log(`    ${s.base} | category: ${s.category} | complexity: ${s.complexity} | xp: ${s.xp}`);
    if (s.description) {
      console.log(`    "${s.description.slice(0, 80)}${s.description.length > 80 ? "..." : ""}"`);
    }

    console.log("    Ingredients:");
    for (const ing of s.ingredients) {
      if (ing.type === "resource") {
        console.log(`      ${ing.units} x ${ing.className ?? `[${ing.classId}]`} (${ing.desc})`);
      } else {
        console.log(`      ${ing.count} x [${ing.componentType}] ${ing.componentId} (${ing.desc})`);
      }
    }

    if (s.experimentalGroups.length > 0) {
      console.log("    Experiments:");
      for (const grp of s.experimentalGroups) {
        for (const prop of grp.properties) {
          const weights = Object.entries(prop.weights)
            .map(([k, v]) => `${k.toUpperCase()}=${v}%`)
            .join(", ");
          console.log(`      ${grp.group} > ${prop.name}: ${weights}`);
        }
      }
    }
    console.log("");
  }

  // Final verdict
  console.log("=== VERDICT ===\n");
  if (unresolvedClassIds.size === 0) {
    console.log("  ALL RESOURCE CLASS IDS RESOLVED. Pipeline is ready for DynamoDB integration.");
  } else {
    console.log(`  ${unresolvedClassIds.size} UNRESOLVED CLASS IDS. Fix swgaide-class-map.json before proceeding.`);
  }
  console.log("");
}

main().catch((err) => {
  console.error("Schematics ingestion failed:", err);
  process.exit(1);
});
