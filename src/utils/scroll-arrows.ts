const SCROLL_STEP = 200;

interface ScrollArrowElements {
  tabList: HTMLElement;
  leftArrow: HTMLElement;
  rightArrow: HTMLElement;
}

/**
 * Wire up scroll-arrow visibility, wheel-to-scroll, and click-to-scroll
 * for a horizontally scrollable tab list.
 * Returns an `updateScrollArrows` function for external callers (e.g. ResizeObserver).
 */
export function setupScrollArrows({ tabList, leftArrow, rightArrow }: ScrollArrowElements): () => void {
  function update(): void {
    const scrollLeft = tabList.scrollLeft;
    const maxScroll = tabList.scrollWidth - tabList.clientWidth;
    leftArrow.classList.toggle('visible', scrollLeft > 1);
    rightArrow.classList.toggle('visible', maxScroll > 1 && scrollLeft < maxScroll - 1);
  }

  tabList.addEventListener('scroll', update);
  tabList.addEventListener('wheel', (e: WheelEvent) => {
    if (tabList.scrollWidth <= tabList.clientWidth) return;
    e.preventDefault();
    tabList.scrollLeft += e.deltaY;
  }, { passive: false });

  leftArrow.addEventListener('click', () => {
    tabList.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' });
  });
  rightArrow.addEventListener('click', () => {
    tabList.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' });
  });

  return update;
}
