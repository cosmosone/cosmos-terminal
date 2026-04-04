import { store } from '../state/store';
import { updateProjectSettings } from '../state/actions';
import { createElement } from '../utils/dom';
import { keybindings } from '../utils/keybindings';
import { suppressBrowserWebview, restoreBrowserWebview } from './browser-tab-content';

export async function showProjectSettingsDialog(projectId: string): Promise<void> {
  const project = store.getState().projects.find((p) => p.id === projectId);
  if (!project) return;

  keybindings.setActive(false);
  await suppressBrowserWebview();

  const backdrop = createElement('div', { className: 'project-settings-backdrop' });
  const dialog = createElement('div', { className: 'project-settings-dialog' });

  // ── Header ──
  const header = createElement('div', { className: 'project-settings-header' });
  const title = createElement('span');
  title.textContent = `Project Settings - ${project.name}`;
  const closeBtn = createElement('div', { className: 'settings-close' });
  closeBtn.textContent = '\u00D7';
  header.appendChild(title);
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  // ── Content ──
  const content = createElement('div', { className: 'project-settings-content' });

  // Run Custom Command
  const cmdRow = createElement('div', { className: 'settings-row' });
  const cmdLabel = createElement('label');
  cmdLabel.textContent = 'Run Custom Command';
  const cmdRight = createElement('div', { className: 'settings-cmd-right' });
  const cmdInput = createElement('input', { type: 'text' });
  cmdInput.value = project.runCommand ?? '';
  const cmdSave = createElement('button', { className: 'settings-cmd-save' });
  cmdSave.textContent = 'Save';
  cmdSave.disabled = true;
  cmdInput.addEventListener('input', () => {
    cmdSave.disabled = cmdInput.value === (project.runCommand ?? '');
  });
  cmdSave.addEventListener('click', () => {
    updateProjectSettings(projectId, { runCommand: cmdInput.value });
    project.runCommand = cmdInput.value;
    cmdSave.disabled = true;
  });
  cmdRight.appendChild(cmdInput);
  cmdRight.appendChild(cmdSave);
  cmdRow.appendChild(cmdLabel);
  cmdRow.appendChild(cmdRight);
  content.appendChild(cmdRow);

  // Show Run Button in Tabs
  const toggleRow = createElement('div', { className: 'settings-row' });
  const toggleLabel = createElement('label');
  toggleLabel.textContent = 'Show Run Button in Tabs';
  const toggle = createElement('div', {
    className: `settings-toggle${project.showRunButton !== false ? ' active' : ''}`,
  });
  toggle.addEventListener('click', () => {
    const newVal = !toggle.classList.contains('active');
    toggle.classList.toggle('active', newVal);
    updateProjectSettings(projectId, { showRunButton: newVal });
  });
  toggleRow.appendChild(toggleLabel);
  toggleRow.appendChild(toggle);
  content.appendChild(toggleRow);

  dialog.appendChild(content);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  let closed = false;
  function cleanup(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKeydown, true);
    backdrop.remove();
    keybindings.setActive(true);
    restoreBrowserWebview();
  }

  closeBtn.addEventListener('click', cleanup);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) cleanup();
  });

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      cleanup();
    }
  }
  window.addEventListener('keydown', onKeydown, true);
}
