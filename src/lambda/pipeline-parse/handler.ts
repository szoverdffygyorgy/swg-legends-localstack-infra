/**
 * Pipeline Lambda: Parse XML
 *
 * Step 2 of the ingestion state machine.
 * Reads raw XML from S3, parses into SWGResource objects, writes
 * the parsed JSON back to S3 (because the full resource array is
 * too large for Step Functions' 256 KB payload limit).
 *
 * Input:  { xmlS3Key: string }
 * Output: { parsedS3Key: string, resourceCount: number, dataIssueCount: number }
 */

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { XMLParser } from "fast-xml-parser";

// ─── Config ──────────────────────────────────────────────────────────

const BUCKET = process.env.RAW_EXPORTS_BUCKET || "swg-legends-raw-exports";
const endpoint = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const region = process.env.AWS_REGION_CUSTOM || process.env.AWS_REGION || "us-east-1";

const s3 = new S3Client({
  endpoint,
  region,
  forcePathStyle: true,
  credentials: { accessKeyId: "test", secretAccessKey: "test" },
});

const ALL_STAT_KEYS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

// ─── Types ───────────────────────────────────────────────────────────

interface ParseInput {
  xmlS3Key: string;
}

interface ParseOutput {
  xmlS3Key: string;
  parsedS3Key: string;
  resourceCount: number;
  dataIssueCount: number;
}

interface SWGResource {
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  resourceClassId: string;
  stats: Record<string, number>;
  planets: string[];
  availableTimestamp: number;
  availableBy: string;
}

interface DataIssue {
  resourceId: string;
  resourceName: string;
  resourceClass: string;
  issue: string;
  rawPlanets: string;
}

// ─── Handler ─────────────────────────────────────────────────────────

export async function handler(event: ParseInput): Promise<ParseOutput> {
  console.log(`Step 2: Parsing XML from s3://${BUCKET}/${event.xmlS3Key}`);

  // Read XML from S3
  const response = await s3.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: event.xmlS3Key })
  );
  const xml = await response.Body!.transformToString("utf-8");

  // Parse XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: (name: string) => name === "resource" || name === "planet",
  });

  const parsed = parser.parse(xml);
  const rawResources = parsed.resource_data.resources.resource;

  const resources: SWGResource[] = [];
  const dataIssues: DataIssue[] = [];

  for (const raw of rawResources) {
    const stats: Record<string, number> = {};
    if (raw.stats) {
      for (const key of ALL_STAT_KEYS) {
        if (raw.stats[key] !== undefined) {
          stats[key] = Number(raw.stats[key]);
        }
      }
    }

    const rawPlanetNames: string[] = [];
    const validPlanets: string[] = [];
    if (raw.planets?.planet) {
      for (const p of raw.planets.planet) {
        const name = p.name;
        rawPlanetNames.push(String(name ?? ""));
        if (name && typeof name === "string" && name.trim()) {
          validPlanets.push(name.trim());
        }
      }
    }

    const resourceId = String(raw.swgaide_id);
    const resourceName = raw.name;
    const resourceClass = raw.type;

    if (validPlanets.length === 0) {
      dataIssues.push({
        resourceId,
        resourceName,
        resourceClass,
        issue: "empty planet name",
        rawPlanets: rawPlanetNames.join(", ") || "(none)",
      });
      continue;
    }

    resources.push({
      resourceId,
      resourceName,
      resourceClass,
      resourceClassId: raw.swgaide_type_id,
      stats,
      planets: validPlanets,
      availableTimestamp: Number(raw.available_timestamp),
      availableBy: raw.available_by ?? "Unknown",
    });
  }

  console.log(`Parsed ${resources.length} resources, ${dataIssues.length} data issues`);

  // Write parsed data to S3 (too large for Step Functions payload)
  const parsedS3Key = event.xmlS3Key.replace("raw.xml", "parsed.json");
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: parsedS3Key,
      Body: JSON.stringify({ resources, dataIssues }),
      ContentType: "application/json",
    })
  );

  console.log(`Wrote parsed data to s3://${BUCKET}/${parsedS3Key}`);

  return {
    xmlS3Key: event.xmlS3Key,
    parsedS3Key,
    resourceCount: resources.length,
    dataIssueCount: dataIssues.length,
  };
}
