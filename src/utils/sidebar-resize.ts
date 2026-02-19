/** Shared left-edge resize behavior for sidebar panels. */
export function setupSidebarResize(
  handle: HTMLElement,
  onResize: (newWidth: number) => void,
  getWidth: () => number,
): void {
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = getWidth();
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (me: MouseEvent) => {
      const delta = startX - me.clientX;
      onResize(startWidth + delta);
    };

    const onUp = () => {
      handle.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
}
