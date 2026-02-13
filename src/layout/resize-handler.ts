import type { DividerInfo } from './pane-layout';
import type { PaneNode } from '../state/types';
import { updateRatio } from './pane-tree';
import { logger } from '../services/logger';

export interface ResizeCallbacks {
  onResize: (newTree: PaneNode) => void;
  getTree: () => PaneNode;
  getContainerRect: () => DOMRect;
}

export function setupResizeHandle(
  handle: HTMLElement,
  divider: DividerInfo,
  callbacks: ResizeCallbacks,
): void {
  const isHorizontal = divider.direction === 'horizontal';

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    handle.classList.add('dragging');
    logger.debug('layout', 'Pane resize drag start', { direction: divider.direction, dividerIndex: divider.dividerIndex });

    const containerRect = callbacks.getContainerRect();
    const startPos = isHorizontal ? e.clientX : e.clientY;
    const totalSize = isHorizontal ? containerRect.width : containerRect.height;

    const onMove = (me: MouseEvent) => {
      const currentPos = isHorizontal ? me.clientX : me.clientY;
      const deltaPx = currentPos - startPos;
      const deltaRatio = deltaPx / totalSize;

      const tree = callbacks.getTree();
      const newTree = updateRatio(tree, divider.path, divider.dividerIndex, deltaRatio);
      callbacks.onResize(newTree);
    };

    const onUp = () => {
      handle.classList.remove('dragging');
      logger.debug('layout', 'Pane resize drag end', { direction: divider.direction, dividerIndex: divider.dividerIndex });
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
