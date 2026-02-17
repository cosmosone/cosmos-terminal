import { createElement } from '../utils/dom';

const CHECKMARK_SVG = '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 8.5 6 12.5 14 3.5"/></svg>';

/**
 * Append the appropriate activity indicator to a tab element:
 * - Pulsing dot for ongoing activity (hasActivity)
 * - Static checkmark for completed activity (activityCompleted)
 * - Nothing if neither flag is set
 */
export function appendActivityIndicator(
  tab: HTMLElement,
  hasActivity: boolean,
  activityCompleted: boolean,
): void {
  if (hasActivity) {
    tab.appendChild(createElement('span', { className: 'tab-activity' }));
  } else if (activityCompleted) {
    const done = createElement('span', { className: 'tab-activity-done' });
    done.innerHTML = CHECKMARK_SVG;
    tab.appendChild(done);
  }
}
