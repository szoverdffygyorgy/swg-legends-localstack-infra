/**
 * One-time scrape of the SWG resource class hierarchy from SWGAide.
 *
 * Fetches the resource tree page (https://swgaide.com/resources/restree.php),
 * parses the HTML table to extract the full class hierarchy with stat caps,
 * and writes the result to src/data/resource-class-tree.json.
 *
 * The SWG resource class tree is static game data -- it only changes when
 * the game is patched (extremely rare). This script is intended to be run
 * once, and the output JSON checked into version control as reference data.
 *
 * Run with: npm run scrape:tree
 */

// ─── Types ───────────────────────────────────────────────────────────

interface RawNode {
  nodeId: number;
  parentNodeId: number;
  className: string;
  isLeaf: boolean;
  statCaps: Partial<Record<string, [number, number]>>;
}

interface ResourceClassNode {
  nodeId: number;
  className: string;
  classId: string;
  parentNodeId: number;
  parentName: string | null;
  parentClassId: string | null;
  path: string;
  depth: number;
  isLeaf: boolean;
  statCaps: Partial<Record<string, [number, number]>>;
}

// ─── Constants ───────────────────────────────────────────────────────

const SWGAIDE_TREE_URL = "https://swgaide.com/resources/restree.php";
const OUTPUT_PATH = "src/data/resource-class-tree.json";

const STAT_KEYS = ["er", "cr", "cd", "dr", "fl", "hr", "ma", "pe", "oq", "sr", "ut"];

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert a class name to a URL/key-safe slug.
 * "Desh Copper" -> "desh_copper"
 * "Bal'ta'ran Crystal Amorphous Gemstone" -> "baltaran_crystal_amorphous_gemstone"
 * "Non-Ferrous Metal" -> "non-ferrous_metal"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/'/g, "")          // remove apostrophes
    .replace(/[^a-z0-9-]+/g, "_") // non-alphanumeric (except hyphens) -> underscore
    .replace(/^_+|_+$/g, "");  // trim leading/trailing underscores
}

/**
 * Parse a stat cell value. Returns [min, max] or null if empty.
 * "200 600" -> [200, 600]
 * " "       -> null
 */
function parseStatCell(value: string): [number, number] | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(" ");
  if (parts.length !== 2) return null;

  const min = parseInt(parts[0], 10);
  const max = parseInt(parts[1], 10);

  if (isNaN(min) || isNaN(max)) return null;
  return [min, max];
}

// ─── Parse HTML ──────────────────────────────────────────────────────

/**
 * Extract all <tr data-tt-id="..."> rows from the HTML.
 * Each row follows one of two patterns:
 *
 * Branch: <tr data-tt-id="77" data-tt-parent-id="22"><td><span>Ferrous Metal</span></td><td>...</td>...(x11)</tr>
 * Leaf:   <tr data-tt-id="299" data-tt-parent-id="164"><td>Desh Copper</td><td>...</td>...(x11)</tr>
 */
function parseRows(html: string): RawNode[] {
  // Match all <tr data-tt-id="N" data-tt-parent-id="N">...</tr>
  const trPattern = /<tr data-tt-id="(\d+)" data-tt-parent-id="(\d+)">(.*?)<\/tr>/g;
  const nodes: RawNode[] = [];

  let match: RegExpExecArray | null;
  while ((match = trPattern.exec(html)) !== null) {
    const nodeId = parseInt(match[1], 10);
    const parentNodeId = parseInt(match[2], 10);
    const rowContent = match[3];

    // Extract all <td> cell contents
    const tdPattern = /<td>(.*?)<\/td>/g;
    const cells: string[] = [];
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdPattern.exec(rowContent)) !== null) {
      cells.push(tdMatch[1]);
    }

    if (cells.length < 12) {
      console.warn(`  Warning: Row ${nodeId} has ${cells.length} cells (expected 12), skipping`);
      continue;
    }

    // First cell: class name. Branch nodes wrap in <span>, leaf nodes don't.
    const nameCell = cells[0];
    const spanMatch = nameCell.match(/<span>(.*?)<\/span>/);
    const className = spanMatch ? spanMatch[1] : nameCell;
    const isLeaf = !spanMatch;

    // Stat cells (11 stats)
    const statCaps: Partial<Record<string, [number, number]>> = {};
    for (let i = 0; i < STAT_KEYS.length; i++) {
      const parsed = parseStatCell(cells[i + 1]);
      if (parsed) {
        statCaps[STAT_KEYS[i]] = parsed;
      }
    }

    nodes.push({ nodeId, parentNodeId, className, isLeaf, statCaps });
  }

  return nodes;
}

// ─── Build tree ──────────────────────────────────────────────────────

function buildTree(rawNodes: RawNode[]): ResourceClassNode[] {
  // Build lookup maps
  const nodeMap = new Map<number, RawNode>();
  for (const node of rawNodes) {
    nodeMap.set(node.nodeId, node);
  }

  // Compute path and depth for each node by walking up to root
  function getAncestorChain(nodeId: number): RawNode[] {
    const chain: RawNode[] = [];
    let current = nodeId;
    while (current !== 0) {
      const node = nodeMap.get(current);
      if (!node) break;
      chain.unshift(node);
      current = node.parentNodeId;
    }
    return chain;
  }

  const result: ResourceClassNode[] = [];

  for (const raw of rawNodes) {
    const chain = getAncestorChain(raw.nodeId);
    const path = chain.map((n) => slugify(n.className)).join("/");
    const depth = chain.length - 1; // root nodes are depth 0

    const parent = raw.parentNodeId !== 0 ? nodeMap.get(raw.parentNodeId) : null;

    result.push({
      nodeId: raw.nodeId,
      className: raw.className,
      classId: slugify(raw.className),
      parentNodeId: raw.parentNodeId,
      parentName: parent?.className ?? null,
      parentClassId: parent ? slugify(parent.className) : null,
      path,
      depth,
      isLeaf: raw.isLeaf,
      statCaps: raw.statCaps,
    });
  }

  return result;
}

// ─── Validation ──────────────────────────────────────────────────────

function validate(nodes: ResourceClassNode[]): void {
  // Check for duplicate classIds (slugified names)
  const classIdCounts = new Map<string, string[]>();
  for (const node of nodes) {
    const existing = classIdCounts.get(node.classId) ?? [];
    existing.push(node.className);
    classIdCounts.set(node.classId, existing);
  }

  const duplicates = [...classIdCounts.entries()].filter(([, names]) => names.length > 1);
  if (duplicates.length > 0) {
    console.warn("\n  Warning: Duplicate classIds detected after slugification:");
    for (const [classId, names] of duplicates) {
      console.warn(`    "${classId}" <- ${names.map((n) => `"${n}"`).join(", ")}`);
    }
    console.warn("  These will need nodeId-based disambiguation in the seed script.\n");
  }

  // Check that all parent references resolve
  const nodeIds = new Set(nodes.map((n) => n.nodeId));
  for (const node of nodes) {
    if (node.parentNodeId !== 0 && !nodeIds.has(node.parentNodeId)) {
      console.warn(`  Warning: Node "${node.className}" references missing parent ${node.parentNodeId}`);
    }
  }

  // Verify leaf/branch consistency: branch nodes should be referenced as parents
  const parentIds = new Set(nodes.map((n) => n.parentNodeId));
  for (const node of nodes) {
    if (!node.isLeaf && !parentIds.has(node.nodeId)) {
      console.warn(`  Warning: Branch node "${node.className}" (${node.nodeId}) has no children`);
    }
  }
}

// ─── Stats ───────────────────────────────────────────────────────────

function printSummary(nodes: ResourceClassNode[]): void {
  const leafCount = nodes.filter((n) => n.isLeaf).length;
  const branchCount = nodes.filter((n) => !n.isLeaf).length;
  const rootCount = nodes.filter((n) => n.parentNodeId === 0).length;
  const maxDepth = Math.max(...nodes.map((n) => n.depth));

  const depthDist = new Map<number, number>();
  for (const node of nodes) {
    depthDist.set(node.depth, (depthDist.get(node.depth) ?? 0) + 1);
  }

  const roots = nodes
    .filter((n) => n.parentNodeId === 0)
    .map((n) => n.className);

  console.log("\n=== Resource Class Tree Summary ===\n");
  console.log(`  Total nodes:   ${nodes.length}`);
  console.log(`  Branch nodes:  ${branchCount}`);
  console.log(`  Leaf nodes:    ${leafCount}`);
  console.log(`  Root nodes:    ${rootCount} (${roots.join(", ")})`);
  console.log(`  Max depth:     ${maxDepth}`);
  console.log("");
  console.log("  Depth distribution:");
  for (const [depth, count] of [...depthDist.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`    Depth ${depth}: ${count} nodes`);
  }

  // Sample a few leaf nodes
  const sampleLeaves = nodes.filter((n) => n.isLeaf).slice(0, 3);
  console.log("\n  Sample leaf nodes:");
  for (const leaf of sampleLeaves) {
    const statList = Object.entries(leaf.statCaps)
      .map(([k, v]) => `${k.toUpperCase()}:${v[0]}-${v[1]}`)
      .join(" ");
    console.log(`    ${leaf.className} (depth ${leaf.depth})`);
    console.log(`      path: ${leaf.path}`);
    console.log(`      caps: ${statList || "(none)"}`);
  }

  console.log("");
}

// ─── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== SWG Resource Class Tree Scraper ===\n");

  // Fetch the page
  console.log(`  Fetching ${SWGAIDE_TREE_URL}...`);
  const response = await fetch(SWGAIDE_TREE_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const html = await response.text();
  console.log(`  Downloaded ${Math.round(html.length / 1024)} KB`);

  // Parse HTML rows
  console.log("  Parsing HTML table...");
  const rawNodes = parseRows(html);
  console.log(`  Found ${rawNodes.length} rows`);

  if (rawNodes.length === 0) {
    throw new Error("No rows parsed -- the HTML structure may have changed");
  }

  // Build tree with paths and depths
  console.log("  Building tree...");
  const tree = buildTree(rawNodes);

  // Validate
  console.log("  Validating...");
  validate(tree);

  // Write output
  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUTPUT_PATH, JSON.stringify(tree, null, 2) + "\n");
  console.log(`  Wrote ${tree.length} nodes to ${OUTPUT_PATH}`);

  // Summary
  printSummary(tree);
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
