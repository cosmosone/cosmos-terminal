import { createElement } from '../utils/dom';

export function startInlineRename(
  tabElement: HTMLElement,
  currentName: string,
  onRename: (newName: string) => void,
): void {
  const label = tabElement.querySelector('.tab-label') as HTMLElement | null;
  if (!label) return;

  const input = createElement('input', { type: 'text', className: 'tab-rename-input' });
  input.value = currentName;
  label.textContent = '';
  label.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      onRename(newName);
    }
    label.textContent = newName || currentName;
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      label.textContent = currentName;
    }
  });
}

export interface MenuItem {
  label: string;
  action: () => void;
  separator?: boolean;
}

let activeMenu: HTMLElement | null = null;

function closeMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('contextmenu', closeMenu);
}

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();

  const menu = createElement('div', { className: 'context-menu' });

  for (const item of items) {
    if (item.separator) {
      menu.appendChild(createElement('div', { className: 'context-menu-separator' }));
    }
    const row = createElement('div', { className: 'context-menu-item' });
    row.textContent = item.label;
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      item.action();
    });
    menu.appendChild(row);
  }

  // Position, keeping menu within viewport
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }

  activeMenu = menu;

  requestAnimationFrame(() => {
    window.addEventListener('click', closeMenu);
    window.addEventListener('contextmenu', closeMenu);
  });
}
