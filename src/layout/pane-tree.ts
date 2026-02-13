import type { PaneNode, PaneBranch } from '../state/types';

export function findLeafPaneIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.paneId];
  return node.children.flatMap(findLeafPaneIds);
}

export function updateRatio(
  node: PaneNode,
  path: number[],
  dividerIndex: number,
  delta: number,
): PaneNode {
  if (path.length === 0 && node.type === 'branch') {
    return adjustRatios(node, dividerIndex, delta);
  }
  if (node.type === 'branch' && path.length > 0) {
    const [head, ...rest] = path;
    return {
      ...node,
      children: node.children.map((c, i) =>
        i === head ? updateRatio(c, rest, dividerIndex, delta) : c,
      ),
    };
  }
  return node;
}

function adjustRatios(branch: PaneBranch, dividerIndex: number, delta: number): PaneBranch {
  const ratios = [...branch.ratios];
  const minRatio = 0.1;
  const a = ratios[dividerIndex] + delta;
  const b = ratios[dividerIndex + 1] - delta;
  if (a >= minRatio && b >= minRatio) {
    ratios[dividerIndex] = a;
    ratios[dividerIndex + 1] = b;
  }
  return { ...branch, ratios };
}
