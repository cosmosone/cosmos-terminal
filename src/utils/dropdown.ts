import { createElement } from './dom';

/** Position a fixed dropdown panel below an anchor element, clamping to viewport. */
export function positionDropdownPanel(panel: HTMLElement, anchorRect: DOMRect): void {
  // Cache viewport dimensions before any writes to minimise layout thrash
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  panel.style.top = `${anchorRect.bottom + 2}px`;
  panel.style.left = `${anchorRect.left}px`;

  // Single forced layout flush to measure the panel
  const panelRect = panel.getBoundingClientRect();
  if (panelRect.right > vw) {
    panel.style.left = `${vw - panelRect.width - 4}px`;
  }
  if (panelRect.bottom > vh) {
    panel.style.maxHeight = `${vh - anchorRect.bottom - 8}px`;
  }
}

/** Create a section header for a dropdown list. */
export function createDropdownHeader(text: string): HTMLElement {
  const header = createElement('div', { className: 'tab-dropdown-header' });
  header.textContent = text;
  return header;
}

/** Create a standard dropdown row (icon + name + optional detail). */
export function createDropdownRow(opts: {
  icon: string;
  name: string;
  detail?: string;
  isActive: boolean;
  onClick: () => void;
}): HTMLElement {
  const row = createElement('div', { className: `tab-dropdown-item${opts.isActive ? ' active' : ''}` });

  const iconEl = createElement('span', { className: 'tab-dropdown-icon' });
  iconEl.innerHTML = opts.icon;
  row.appendChild(iconEl);

  const info = createElement('div', { className: 'tab-dropdown-info' });
  const nameEl = createElement('div', { className: 'tab-dropdown-name' });
  nameEl.textContent = opts.name;
  info.appendChild(nameEl);
  if (opts.detail) {
    const detailEl = createElement('div', { className: 'tab-dropdown-detail' });
    detailEl.textContent = opts.detail;
    info.appendChild(detailEl);
  }
  row.appendChild(info);

  row.addEventListener('click', opts.onClick);
  return row;
}
