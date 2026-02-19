interface TabRect {
  id: string;
  left: number;
  right: number;
  center: number;
}

type DropCallback = (itemId: string, originIndex: number, dropIndex: number) => void;

interface ActiveDrag {
  tab: HTMLElement;
  startX: number;
  tabRects: TabRect[];
  indicator: HTMLElement;
  originIndex: number;
  dropIndex: number;
  dragging: boolean;
  itemId: string;
  onDrop: DropCallback;
}

export interface TabDragManager {
  /** Call from mousedown to begin a potential drag. */
  startDrag(
    e: MouseEvent,
    tab: HTMLElement,
    tabList: HTMLElement,
    indicator: HTMLElement,
    itemId: string,
    originIndex: number,
    selector: string,
    items: { id: string }[],
    onDrop: DropCallback,
  ): void;
  /** True while a click should be suppressed (right after a drag). */
  readonly suppressClick: boolean;
  /** Abort an in-progress drag (e.g. on re-render). */
  cleanupDrag(): void;
}

export function createTabDragManager(): TabDragManager {
  let drag: ActiveDrag | null = null;
  let suppressNextClick = false;

  function onMouseMove(e: MouseEvent): void {
    if (!drag) return;
    const dx = e.clientX - drag.startX;

    if (!drag.dragging) {
      if (Math.abs(dx) < 4) return;
      drag.dragging = true;
      drag.tab.classList.add('dragging');
      drag.indicator.style.display = 'block';
    }

    // Safety: if DOM detached during drag, abort
    if (!drag.tab.isConnected) {
      cleanupDrag();
      return;
    }

    drag.tab.style.transform = `translateX(${dx}px)`;

    // Compute drop index from cursor position vs tab centers
    const rects = drag.tabRects;
    let dropIndex = rects.length - 1;
    for (let i = 0; i < rects.length; i++) {
      if (e.clientX < rects[i].center) {
        dropIndex = i;
        break;
      }
    }
    drag.dropIndex = dropIndex;

    // Position the indicator line relative to the parent.
    // The indicator is absolutely positioned inside the scrollable tabList,
    // so we must add scrollLeft to convert viewport coords to content coords.
    const parent = drag.indicator.parentElement!;
    const parentLeft = parent.getBoundingClientRect().left;
    let indicatorLeft: number;
    if (dropIndex === 0) {
      indicatorLeft = rects[0].left;
    } else if (dropIndex < rects.length) {
      indicatorLeft = (rects[dropIndex - 1].right + rects[dropIndex].left) / 2;
    } else {
      indicatorLeft = rects[dropIndex - 1].right;
    }
    drag.indicator.style.left = `${indicatorLeft - parentLeft + parent.scrollLeft}px`;
  }

  function onMouseUp(): void {
    if (!drag) return;
    const { itemId, dragging, originIndex, dropIndex, onDrop } = drag;
    cleanupDrag();
    if (dragging) {
      suppressNextClick = true;
      requestAnimationFrame(() => { suppressNextClick = false; });
      // Adjust dropIndex: if dropping after original position, account for removal
      const adjustedIndex = dropIndex > originIndex ? dropIndex - 1 : dropIndex;
      if (adjustedIndex !== originIndex) {
        onDrop(itemId, originIndex, adjustedIndex);
      }
    }
  }

  function cleanupDrag(): void {
    if (drag) {
      drag.tab.classList.remove('dragging');
      drag.tab.style.transform = '';
      drag.indicator.style.display = 'none';
      drag = null;
    }
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  return {
    startDrag(
      e: MouseEvent,
      tab: HTMLElement,
      tabList: HTMLElement,
      indicator: HTMLElement,
      itemId: string,
      originIndex: number,
      selector: string,
      items: { id: string }[],
      onDrop: DropCallback,
    ): void {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.tab-close, .tab-lock')) return;

      const tabEls = tabList.querySelectorAll(selector);
      const tabRects = Array.from(tabEls).map((el, i) => {
        const r = el.getBoundingClientRect();
        return { id: items[i].id, left: r.left, right: r.right, center: r.left + r.width / 2 };
      });

      drag = {
        tab,
        startX: e.clientX,
        tabRects,
        indicator,
        originIndex,
        dropIndex: originIndex,
        dragging: false,
        itemId,
        onDrop,
      };
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    get suppressClick() { return suppressNextClick; },
    cleanupDrag,
  };
}
