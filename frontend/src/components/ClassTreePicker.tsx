import React, { useState, useMemo, useCallback } from "react";
import type { ClassTreeNode } from "../api/types";
import "./ClassTreePicker.css";

interface ClassTreePickerProps {
  tree: ClassTreeNode[];
  selected: string | null;
  onSelect: (className: string | null) => void;
  /** Optional map of className -> actual resource count. When provided,
   *  the tree displays aggregated resource counts instead of static leaf type counts. */
  resourceCounts?: Map<string, number>;
}

interface TreeNodeData {
  node: ClassTreeNode;
  children: TreeNodeData[];
  leafCount: number;
  resourceCount: number;
}

export default function ClassTreePicker({
  tree,
  selected,
  onSelect,
  resourceCounts,
}: ClassTreePickerProps) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());

  // Build tree structure from flat array
  const roots = useMemo(() => {
    const nodeMap = new Map<number, TreeNodeData>();
    const rootNodes: TreeNodeData[] = [];

    // Create TreeNodeData for each entry
    for (const node of tree) {
      nodeMap.set(node.nodeId, { node, children: [], leafCount: 0, resourceCount: 0 });
    }

    // Link children to parents
    for (const node of tree) {
      const treeNode = nodeMap.get(node.nodeId)!;
      if (node.parentNodeId === 0) {
        rootNodes.push(treeNode);
      } else {
        const parent = nodeMap.get(node.parentNodeId);
        if (parent) {
          parent.children.push(treeNode);
        }
      }
    }

    // Sort children alphabetically at each level
    function sortChildren(nodes: TreeNodeData[]) {
      nodes.sort((a, b) => a.node.className.localeCompare(b.node.className));
      for (const n of nodes) {
        if (n.children.length > 0) sortChildren(n.children);
      }
    }
    sortChildren(rootNodes);

    // Compute leaf descendant counts bottom-up (static taxonomy count)
    function computeLeafCount(nodes: TreeNodeData[]): number {
      let total = 0;
      for (const n of nodes) {
        if (n.children.length === 0) {
          n.leafCount = 1; // leaf node
          total += 1;
        } else {
          n.leafCount = computeLeafCount(n.children);
          total += n.leafCount;
        }
      }
      return total;
    }
    computeLeafCount(rootNodes);

    // Compute aggregated resource counts bottom-up (actual resource data)
    if (resourceCounts) {
      function computeResourceCount(nodes: TreeNodeData[]): number {
        let total = 0;
        for (const n of nodes) {
          if (n.children.length === 0) {
            n.resourceCount = resourceCounts!.get(n.node.className) ?? 0;
          } else {
            n.resourceCount = computeResourceCount(n.children);
          }
          total += n.resourceCount;
        }
        return total;
      }
      computeResourceCount(rootNodes);
    }

    return rootNodes;
  }, [tree, resourceCounts]);

  // Filter tree by search query -- returns set of nodeIds that match
  // (including ancestors so the path to matches is visible)
  const matchingIds = useMemo(() => {
    if (!search.trim()) return null;

    const query = search.toLowerCase();
    const matches = new Set<number>();

    // Find all matching nodes
    for (const node of tree) {
      if (node.className.toLowerCase().includes(query)) {
        matches.add(node.nodeId);
      }
    }

    // Add all ancestors of matches
    const nodeMap = new Map(tree.map((n) => [n.nodeId, n]));
    const withAncestors = new Set(matches);
    for (const id of matches) {
      let current = nodeMap.get(id);
      while (current && current.parentNodeId !== 0) {
        withAncestors.add(current.parentNodeId);
        current = nodeMap.get(current.parentNodeId);
      }
    }

    return withAncestors;
  }, [search, tree]);

  // Auto-expand nodes that contain search matches
  const effectiveExpanded = useMemo(() => {
    if (matchingIds) {
      // When searching, expand all ancestors of matches
      return matchingIds;
    }
    return expanded;
  }, [matchingIds, expanded]);

  const toggleExpand = useCallback((nodeId: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (className: string) => {
      if (selected === className) {
        onSelect(null); // Deselect
      } else {
        onSelect(className);
      }
    },
    [selected, onSelect]
  );

  function renderNode(treeNode: TreeNodeData, depth: number): React.ReactNode {
    const { node, children } = treeNode;
    const isExpanded = effectiveExpanded.has(node.nodeId);
    const hasBranch = children.length > 0;
    const isSelected = selected === node.className;

    // When searching, hide non-matching nodes (unless they're ancestors of matches)
    if (matchingIds && !matchingIds.has(node.nodeId)) return null;

    // Determine if this node directly matches the search (vs just being an ancestor)
    const isDirectMatch =
      matchingIds && search.trim()
        ? node.className.toLowerCase().includes(search.toLowerCase())
        : false;

    return (
      <div key={node.nodeId} className="tree-node-group">
        <div
          className={`tree-node ${isSelected ? "tree-node--selected" : ""} ${isDirectMatch ? "tree-node--match" : ""}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => handleSelect(node.className)}
        >
          {hasBranch ? (
            <span
              className="tree-chevron"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(node.nodeId);
              }}
            >
              {isExpanded ? "\u25BE" : "\u25B8"}
            </span>
          ) : (
            <span className="tree-leaf-dot" />
          )}
          <span className="tree-label">{node.className}</span>
          {hasBranch && (
            <span className="tree-count">
              {resourceCounts ? treeNode.resourceCount : treeNode.leafCount}
            </span>
          )}
        </div>
        {hasBranch && isExpanded && (
          <div className="tree-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="class-tree-picker">
      <div className="tree-header">
        <span className="tree-title">Class Hierarchy</span>
        {selected && (
          <button className="tree-clear" onClick={() => onSelect(null)}>
            Clear
          </button>
        )}
      </div>

      <div className="tree-search">
        <input
          type="text"
          placeholder="Search classes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {selected && (
        <div className="tree-selection">
          <span className="tree-selection-label">Filtering:</span>
          <span className="tree-selection-value">{selected}</span>
        </div>
      )}

      <div className="tree-body">
        {roots.map((root) => renderNode(root, 0))}
      </div>
    </div>
  );
}
