import { createElement } from './dom';
import { chevronLeftIcon, chevronRightIcon } from './icons';

const SCROLL_STEP = 200;

export interface ScrollableTabList {
  /** The outer wrapper element — add to the bar's flex layout */
  wrapper: HTMLElement;
  /** The scrollable list element — append tab elements here */
  tabList: HTMLElement;
  /** Drop indicator for drag operations — already inside tabList */
  indicator: HTMLElement;
  /** Remove all tabs from tabList (preserves indicator). Saves scroll position. */
  clearTabs(): void;
  /** Restore scroll position and scroll active tab into view. Call after rebuilding tabs. */
  finalizeRender(activeSelector: string): void;
  /** Update scroll arrow visibility. Returns true if changed. */
  updateArrows(): boolean;
  /** Disconnect the ResizeObserver. Call when the tab list is permanently removed. */
  destroy(): void;
}

/**
 * Create a scrollable tab list with overlay scroll arrows.
 *
 * The arrows are absolutely positioned over the tab list edges so they
 * never affect flex layout — eliminating the position drift caused by
 * arrows toggling between width:0 and width:26px.
 */
export function createScrollableTabList(): ScrollableTabList {
  const wrapper = createElement('div', { className: 'tab-scroll-wrapper' });

  const leftArrow = createElement('button', { className: 'scroll-arrow left' });
  leftArrow.innerHTML = chevronLeftIcon(16);

  const tabList = createElement('div', { className: 'tab-list' });

  const rightArrow = createElement('button', { className: 'scroll-arrow right' });
  rightArrow.innerHTML = chevronRightIcon(16);

  const indicator = createElement('div', { className: 'tab-drop-indicator' });
  tabList.appendChild(indicator);

  wrapper.appendChild(leftArrow);
  wrapper.appendChild(tabList);
  wrapper.appendChild(rightArrow);

  let savedScrollLeft = 0;

  function updateArrows(): boolean {
    const sl = tabList.scrollLeft;
    const max = tabList.scrollWidth - tabList.clientWidth;
    const prevL = leftArrow.classList.contains('visible');
    const prevR = rightArrow.classList.contains('visible');
    const showL = sl > 1;
    const showR = max > 1 && sl < max - 1;
    leftArrow.classList.toggle('visible', showL);
    rightArrow.classList.toggle('visible', showR);
    return prevL !== showL || prevR !== showR;
  }

  tabList.addEventListener('scroll', () => {
    savedScrollLeft = tabList.scrollLeft;
    updateArrows();
  });

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

  const resizeObserver = new ResizeObserver(updateArrows);
  resizeObserver.observe(wrapper);

  function clearTabs(): void {
    savedScrollLeft = tabList.scrollLeft;
    tabList.replaceChildren(indicator);
  }

  function finalizeRender(activeSelector: string): void {
    requestAnimationFrame(() => {
      if (!tabList.isConnected) return;
      // Query before writing scroll position to avoid a forced layout flush
      const active = activeSelector
        ? tabList.querySelector(activeSelector) as HTMLElement | null
        : null;
      tabList.scrollLeft = savedScrollLeft;
      active?.scrollIntoView({ inline: 'nearest', behavior: 'instant' });
      updateArrows();
      savedScrollLeft = tabList.scrollLeft;
    });
  }

  function destroy(): void {
    resizeObserver.disconnect();
  }

  return { wrapper, tabList, indicator, clearTabs, finalizeRender, updateArrows, destroy };
}
