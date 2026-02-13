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
  path: number[] = [],
): LayoutResult {
  const paneRects = new Map<string, Rect>();
  const dividers: DividerInfo[] = [];

  if (node.type === 'leaf') {
    paneRects.set(node.paneId, rect);
    return { paneRects, dividers };
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
      dividers.push({ rect: dividerRect, direction, path: [...path], dividerIndex: i });
    }

    const childRect: Rect = isHorizontal
      ? { x: rect.x + offset, y: rect.y, width: size, height: rect.height }
      : { x: rect.x, y: rect.y + offset, width: rect.width, height: size };

    const child = computeLayout(children[i], childRect, gap, [...path, i]);
    for (const [sid, r] of child.paneRects) paneRects.set(sid, r);
    dividers.push(...child.dividers);

    offset += size + gap;
  }

  return { paneRects, dividers };
}
