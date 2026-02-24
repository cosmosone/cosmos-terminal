import { store } from '../state/store';
import { updateSettings } from '../state/actions';
import { saveSettings } from '../services/settings-service';
import { createElement } from '../utils/dom';
import { keybindings } from '../utils/keybindings';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  showCheckbox?: boolean;
  checkboxLabel?: string;
  danger?: boolean;
}

export interface ConfirmResult {
  confirmed: boolean;
  checkboxChecked: boolean;
}

export function showConfirmDialog(options: ConfirmOptions): Promise<ConfirmResult> {
  const {
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    showCheckbox = false,
    checkboxLabel = "Don't ask again",
    danger = false,
  } = options;

  return new Promise<ConfirmResult>((resolve) => {
    keybindings.setActive(false);

    const backdrop = createElement('div', { className: 'confirm-backdrop' });
    const dialog = createElement('div', { className: 'confirm-dialog' });

    const titleEl = createElement('div', { className: 'confirm-title' });
    titleEl.textContent = title;
    dialog.appendChild(titleEl);

    const messageEl = createElement('div', { className: 'confirm-message' });
    messageEl.textContent = message;
    dialog.appendChild(messageEl);

    let checkbox: HTMLInputElement | null = null;
    if (showCheckbox) {
      const checkboxRow = createElement('label', { className: 'confirm-checkbox' });
      checkbox = createElement('input', { type: 'checkbox' });
      const labelText = document.createTextNode(checkboxLabel);
      checkboxRow.appendChild(checkbox);
      checkboxRow.appendChild(labelText);
      dialog.appendChild(checkboxRow);
    }

    const actions = createElement('div', { className: 'confirm-actions' });

    const cancelBtn = createElement('button', { className: 'confirm-btn-cancel' });
    cancelBtn.textContent = cancelText;

    const confirmBtn = createElement('button', {
      className: `confirm-btn-confirm${danger ? ' danger' : ''}`,
    });
    confirmBtn.textContent = confirmText;

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Focus the confirm button for keyboard accessibility
    confirmBtn.focus();

    function cleanup(result: ConfirmResult): void {
      window.removeEventListener('keydown', onKeydown, true);
      backdrop.remove();
      keybindings.setActive(true);
      resolve(result);
    }

    function cancel(): void {
      cleanup({ confirmed: false, checkboxChecked: false });
    }

    function confirm(): void {
      cleanup({ confirmed: true, checkboxChecked: checkbox?.checked ?? false });
    }

    cancelBtn.addEventListener('click', cancel);
    confirmBtn.addEventListener('click', confirm);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cancel();
    });

    function onKeydown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        cancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        confirm();
      }
    }

    window.addEventListener('keydown', onKeydown, true);
  });
}

/**
 * Show a close-confirmation dialog guarded by a settings flag.
 * If the user checks "Don't ask again", the setting is persisted as disabled.
 * Returns true if the close should proceed, false if cancelled.
 */
async function confirmClose(
  settingKey: 'confirmCloseTerminalTab' | 'confirmCloseProjectTab',
  title: string,
  message: string,
): Promise<boolean> {
  if (!store.getState().settings[settingKey]) return true;

  const result = await showConfirmDialog({
    title,
    message,
    confirmText: 'Close',
    showCheckbox: true,
    checkboxLabel: "Don't ask again",
    danger: true,
  });

  if (!result.confirmed) return false;

  if (result.checkboxChecked) {
    updateSettings({ [settingKey]: false });
    void saveSettings(store.getState().settings);
  }

  return true;
}

export function confirmCloseTerminalTab(sessionTitle: string): Promise<boolean> {
  return confirmClose(
    'confirmCloseTerminalTab',
    'Close Terminal Tab',
    `Close "${sessionTitle}"?`,
  );
}

export function confirmCloseProject(projectName: string): Promise<boolean> {
  return confirmClose(
    'confirmCloseProjectTab',
    'Close Project Tab',
    `Close project "${projectName}"? All terminal sessions in this project will be closed.`,
  );
}
