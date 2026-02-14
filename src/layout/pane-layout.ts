import type { PaneNode, Rect } from '../state/types';

const PANE_GAP = 2;

export interface DividerInfo {
  rect: Rect;
  direction: 'horizontal' | 'vertical';
  path: number[];
  dividerIndex: number;
}

export interface LayoutResult {
  paneRects: Map<string, Rect>;
  dividers: DividerInfo[];
}

export function computeLayout(
  node: PaneNode,
  rect: Rect,
  gap: number = PANE_GAP,
): LayoutResult {
  const paneRects = new Map<string, Rect>();
  const dividers: DividerInfo[] = [];
  computeLayoutInner(node, rect, gap, [], paneRects, dividers);
  return { paneRects, dividers };
}

function computeLayoutInner(
  node: PaneNode,
  rect: Rect,
  gap: number,
  path: number[],
  paneRects: Map<string, Rect>,
  dividers: DividerInfo[],
): void {
  if (node.type === 'leaf') {
    paneRects.set(node.paneId, rect);
    return;
  }

  const { direction, children, ratios } = node;
  const isHorizontal = direction === 'horizontal';
  const totalGap = gap * (children.length - 1);
  const available = isHorizontal ? rect.width - totalGap : rect.height - totalGap;

  let offset = 0;
  for (let i = 0; i < children.length; i++) {
    const size = available * ratios[i];

    if (i < children.length - 1) {
      const dividerRect: Rect = isHorizontal
        ? { x: rect.x + offset + size, y: rect.y, width: gap, height: rect.height }
        : { x: rect.x, y: rect.y + offset + size, width: rect.width, height: gap };
      // Snapshot path for the divider (dividers need stable path references)
      dividers.push({ rect: dividerRect, direction, path: path.slice(), dividerIndex: i });
    }

    const childRect: Rect = isHorizontal
      ? { x: rect.x + offset, y: rect.y, width: size, height: rect.height }
      : { x: rect.x, y: rect.y + offset, width: rect.width, height: size };

    path.push(i);
    computeLayoutInner(children[i], childRect, gap, path, paneRects, dividers);
    path.pop();

    offset += size + gap;
  }
}
