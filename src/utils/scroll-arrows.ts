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
 * The function returns `true` when visibility changed for either arrow.
 */
export function setupScrollArrows({ tabList, leftArrow, rightArrow }: ScrollArrowElements): () => boolean {
  function update(): boolean {
    const scrollLeft = tabList.scrollLeft;
    const maxScroll = tabList.scrollWidth - tabList.clientWidth;
    const prevShowLeft = leftArrow.classList.contains('visible');
    const prevShowRight = rightArrow.classList.contains('visible');
    const showLeft = scrollLeft > 1;
    const showRight = maxScroll > 1 && scrollLeft < maxScroll - 1;
    leftArrow.classList.toggle('visible', showLeft);
    rightArrow.classList.toggle('visible', showRight);
    return prevShowLeft !== showLeft || prevShowRight !== showRight;
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
