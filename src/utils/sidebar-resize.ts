/** Shared left-edge resize behavior for sidebar panels. */
export function setupSidebarResize(
  handle: HTMLElement,
  onResize: (newWidth: number) => void,
  getWidth: () => number,
): void {
  let resizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    resizing = true;
    startX = e.clientX;
    startWidth = getWidth();
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (!resizing) return;
    const delta = startX - e.clientX;
    onResize(startWidth + delta);
  });

  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}
