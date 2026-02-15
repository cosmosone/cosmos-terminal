import { store } from '../state/store';
import { toggleDebugLogging, updateSettings, toggleSettingsView } from '../state/actions';
import { saveSettings, TERMINAL_FONT_PRESETS, UI_FONT_PRESETS, DEFAULT_KEYBINDINGS } from '../services/settings-service';
import { logger } from '../services/logger';
import type { AppSettings, KeybindingConfig } from '../state/types';
import { keybindings } from '../utils/keybindings';
import { createElement, clearChildren, $ } from '../utils/dom';

export function initSettingsPage(onSettingsChanged: () => void): void {
  const container = $('#settings-container')!;

  // Close dialog when clicking the backdrop (not the dialog itself)
  container.addEventListener('click', (e) => {
    if (e.target === container) toggleSettingsView();
  });

  function render(settings: AppSettings): void {
    // Preserve scroll position across re-renders
    const prevInner = container.querySelector('.settings-inner');
    const savedScrollTop = prevInner?.scrollTop ?? 0;

    clearChildren(container);

    const dialog = createElement('div', { className: 'settings-dialog' });

    // ── Header with expand/collapse controls ──
    const header = createElement('div', { className: 'settings-header' });
    const title = createElement('span');
    title.textContent = 'Settings';

    const headerRight = createElement('div', { className: 'settings-header-actions' });
    const expandAllBtn = createElement('button', { className: 'settings-header-icon-btn', title: 'Expand All' });
    expandAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/></svg>';
    const collapseAllBtn = createElement('button', { className: 'settings-header-icon-btn', title: 'Collapse All' });
    collapseAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 3 12 8 17 3"/><polyline points="7 21 12 16 17 21"/></svg>';
    const closeBtn = createElement('div', { className: 'settings-close' });
    closeBtn.innerHTML = '&#215;';
    closeBtn.addEventListener('click', toggleSettingsView);

    headerRight.appendChild(expandAllBtn);
    headerRight.appendChild(collapseAllBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(headerRight);
    dialog.appendChild(header);

    const inner = createElement('div', { className: 'settings-inner' });
    const allSections: HTMLElement[] = [];

    function createCollapsibleSection(
      sectionTitle: string,
    ): { wrapper: HTMLElement; content: HTMLElement } {
      const wrapper = createElement('div', { className: 'settings-section' });

      const titleBar = createElement('div', { className: 'settings-section-title' });
      const chevron = createElement('span', { className: 'settings-section-chevron' });
      const titleText = createElement('span');
      titleText.textContent = sectionTitle;
      titleBar.appendChild(chevron);
      titleBar.appendChild(titleText);

      titleBar.addEventListener('click', () => {
        wrapper.classList.toggle('collapsed');
      });

      const content = createElement('div', { className: 'settings-section-content' });
      wrapper.appendChild(titleBar);
      wrapper.appendChild(content);
      allSections.push(wrapper);
      return { wrapper, content };
    }

    // ── 1. Font (most commonly adjusted) ──
    const font = createCollapsibleSection('Font');
    font.content.appendChild(
      createFontRow('Terminal Font', settings.fontFamily, TERMINAL_FONT_PRESETS, (v) => apply({ fontFamily: v })),
    );
    font.content.appendChild(
      createNumberRow('Font Size', settings.fontSize, 8, 32, (v) => apply({ fontSize: v }), 0.5),
    );
    font.content.appendChild(
      createNumberRow('Line Height', settings.lineHeight, 1.0, 2.0, (v) => apply({ lineHeight: v }), 0.05, 2),
    );
    font.content.appendChild(
      createFontRow('UI Font', settings.uiFontFamily, UI_FONT_PRESETS, (v) => apply({ uiFontFamily: v })),
    );
    font.content.appendChild(
      createNumberRow('UI Font Size', settings.uiFontSize, 8, 32, (v) => apply({ uiFontSize: v }), 0.5),
    );
    inner.appendChild(font.wrapper);

    // ── 2. Terminal (core behaviour) ──
    const term = createCollapsibleSection('Terminal');
    term.content.appendChild(
      createNumberRow('Scrollback Lines', settings.scrollbackLines, 100, 100000, (v) =>
        apply({ scrollbackLines: v }),
      ),
    );
    term.content.appendChild(
      createToggleRow('Copy on Select', settings.copyOnSelect, (v) => apply({ copyOnSelect: v })),
    );
    term.content.appendChild(
      createToggleRow('Confirm Close Terminal Tab', settings.confirmCloseTerminalTab, (v) =>
        apply({ confirmCloseTerminalTab: v })),
    );
    term.content.appendChild(
      createToggleRow('Confirm Close Project Tab', settings.confirmCloseProjectTab, (v) =>
        apply({ confirmCloseProjectTab: v })),
    );
    inner.appendChild(term.wrapper);

    // ── 3. Shell (fundamental but set-and-forget) ──
    const shell = createCollapsibleSection('Shell');
    shell.content.appendChild(
      createTextRow('Shell Path', settings.shellPath, (v) => apply({ shellPath: v })),
    );
    inner.appendChild(shell.wrapper);

    // ── 4. AI Integration ──
    const ai = createCollapsibleSection('AI Integration');
    ai.content.appendChild(
      createApiKeyRow(settings.openaiApiKey, (v) => apply({ openaiApiKey: v })),
    );
    inner.appendChild(ai.wrapper);

    // ── 5. Keybindings ──
    const kb = createCollapsibleSection('Keybindings');
    const kbLabels: [keyof KeybindingConfig, string][] = [
      ['navigatePaneLeft', 'Move to Left Pane'],
      ['navigatePaneRight', 'Move to Right Pane'],
      ['navigatePaneUp', 'Move to Up Pane'],
      ['navigatePaneDown', 'Move to Down Pane'],
      ['splitDown', 'Split Down'],
      ['splitUp', 'Split Up'],
      ['splitLeft', 'Split Left'],
      ['splitRight', 'Split Right'],
      ['cycleSessionNext', 'Next Terminal Tab'],
      ['cycleSessionPrev', 'Previous Terminal Tab'],
      ['cycleProjectNext', 'Next Project Tab'],
      ['cycleProjectPrev', 'Previous Project Tab'],
      ['toggleGitSidebar', 'Toggle Git Sidebar'],
      ['closeTerminalTab', 'Close Terminal Tab'],
      ['closeProjectTab', 'Close Project Tab'],
      ['scrollToBottom', 'Scroll to Bottom'],
    ];

    // Build conflict map: combo -> list of labels that use it
    const hardcodedBindings: [string, string][] = [
      ['Ctrl+Shift+t', 'New Session'],
      ['Ctrl+Shift+w', 'Close Session'],
      ['Ctrl+,', 'Settings'],
      ['Ctrl+Shift+g', 'Git Sidebar'],
    ];
    const comboToLabels = new Map<string, string[]>();

    function addToConflictMap(combo: string, label: string): void {
      const normalized = normalizeCombo(combo);
      const list = comboToLabels.get(normalized) ?? [];
      list.push(label);
      comboToLabels.set(normalized, list);
    }

    for (const [key, label] of kbLabels) {
      addToConflictMap(settings.keybindings[key], label);
    }
    for (const [combo, label] of hardcodedBindings) {
      addToConflictMap(combo, label);
    }

    for (const [key, label] of kbLabels) {
      const combo = normalizeCombo(settings.keybindings[key]);
      const others = (comboToLabels.get(combo) ?? []).filter((l) => l !== label);
      kb.content.appendChild(
        createKeybindingRow(label, settings.keybindings[key], others, (v) =>
          apply({ keybindings: { ...settings.keybindings, [key]: v } }),
        ),
      );
    }

    // Reset keybindings button
    const resetRow = createElement('div', { className: 'settings-row keybinding-reset-row' });
    const resetBtn = createElement('button', { className: 'settings-btn' });
    resetBtn.textContent = 'Reset All Keybindings';
    resetBtn.addEventListener('click', () => {
      apply({ keybindings: { ...DEFAULT_KEYBINDINGS } });
    });
    resetRow.appendChild(resetBtn);
    kb.content.appendChild(resetRow);

    inner.appendChild(kb.wrapper);

    // ── 6. Logging & Debugging (rarely needed) ──
    const log = createCollapsibleSection('Logging & Debugging');
    log.content.appendChild(
      createToggleRow('Enable Debug Logging', settings.debugLogging, () => {
        toggleDebugLogging();
        onSettingsChanged();
      }),
    );

    const timerRow = createElement('div', { className: 'settings-row' });
    const timerLabel = createElement('label');
    timerLabel.textContent = 'Auto-Disable Timer';
    const timerValue = createElement('span', { className: 'settings-timer' });
    timerValue.textContent = formatExpiry(settings.debugLoggingExpiry);
    timerRow.appendChild(timerLabel);
    timerRow.appendChild(timerValue);
    log.content.appendChild(timerRow);

    const viewerRow = createElement('div', { className: 'settings-row' });
    const viewerLabel = createElement('label');
    viewerLabel.textContent = 'Log Viewer';
    const viewerBtn = createElement('button', { className: 'settings-btn' });
    viewerBtn.textContent = 'Open Log Viewer';
    viewerBtn.addEventListener('click', () => {
      const viewer = document.getElementById('log-viewer-container');
      if (viewer) viewer.classList.remove('hidden');
    });
    viewerRow.appendChild(viewerLabel);
    viewerRow.appendChild(viewerBtn);
    log.content.appendChild(viewerRow);

    inner.appendChild(log.wrapper);

    // Wire up expand/collapse all
    expandAllBtn.addEventListener('click', () => {
      for (const section of allSections) section.classList.remove('collapsed');
    });
    collapseAllBtn.addEventListener('click', () => {
      for (const section of allSections) section.classList.add('collapsed');
    });

    dialog.appendChild(inner);
    container.appendChild(dialog);

    // Restore scroll position after DOM update
    if (savedScrollTop) {
      inner.scrollTop = savedScrollTop;
    }
  }

  function formatExpiry(expiry: string | null): string {
    if (!expiry) return 'Disabled';
    const remaining = new Date(expiry).getTime() - Date.now();
    if (remaining <= 0) return 'Expired';
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    return `${hours}h ${minutes}m remaining`;
  }

  function apply(partial: Partial<AppSettings>): void {
    logger.info('settings', 'Setting changed', partial);
    updateSettings(partial);
    const settings = store.getState().settings;
    saveSettings(settings);
    onSettingsChanged();
  }

  function createTextRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
    const row = createElement('div', { className: 'settings-row' });
    const lbl = createElement('label');
    lbl.textContent = label;
    const input = createElement('input', { type: 'text' });
    input.value = value;
    input.addEventListener('change', () => onChange(input.value));
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  }

  function createNumberRow(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
    step = 1,
    decimals?: number,
  ): HTMLElement {
    const dp = decimals ?? (step % 1 !== 0 ? 1 : 0);
    const factor = Math.pow(10, dp);
    const fmt = (n: number) => dp > 0 ? n.toFixed(dp) : String(n);
    const row = createElement('div', { className: 'settings-row' });
    const lbl = createElement('label');
    lbl.textContent = label;

    const wrapper = createElement('div', { className: 'number-input-wrapper' });

    const downBtn = createElement('button', { className: 'number-btn' });
    downBtn.innerHTML = '&#9662;';
    downBtn.addEventListener('click', () => {
      const n = parseFloat(input.value);
      if (!isNaN(n) && n - step >= min) {
        const next = Math.round((n - step) * factor) / factor;
        input.value = fmt(next);
        onChange(next);
      }
    });

    const input = createElement('input', { type: 'number' });
    input.value = fmt(value);
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener('change', () => {
      const n = parseFloat(input.value);
      if (!isNaN(n) && n >= min && n <= max) onChange(Math.round(n * factor) / factor);
    });

    const upBtn = createElement('button', { className: 'number-btn' });
    upBtn.innerHTML = '&#9652;';
    upBtn.addEventListener('click', () => {
      const n = parseFloat(input.value);
      if (!isNaN(n) && n + step <= max) {
        const next = Math.round((n + step) * factor) / factor;
        input.value = fmt(next);
        onChange(next);
      }
    });

    wrapper.appendChild(downBtn);
    wrapper.appendChild(input);
    wrapper.appendChild(upBtn);

    row.appendChild(lbl);
    row.appendChild(wrapper);
    return row;
  }

  function createFontRow(
    label: string,
    value: string,
    presets: string[],
    onChange: (v: string) => void,
  ): HTMLElement {
    const row = createElement('div', { className: 'settings-row' });
    const lbl = createElement('label');
    lbl.textContent = label;

    const wrapper = createElement('div', { className: 'font-input-wrapper' });

    const select = createElement('select', { className: 'font-select' });
    for (const font of presets) {
      const option = createElement('option');
      option.value = font;
      option.textContent = font;
      if (font === value) option.selected = true;
      select.appendChild(option);
    }
    // "Custom..." option
    const customOpt = createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom...';
    select.appendChild(customOpt);

    // If current value isn't a preset, select Custom and show input
    const isCustom = !presets.includes(value);
    if (isCustom) customOpt.selected = true;

    const customInput = createElement('input', { type: 'text', className: 'font-custom-input' });
    customInput.value = isCustom ? value : '';
    customInput.placeholder = 'Font name...';
    customInput.style.display = isCustom ? '' : 'none';
    customInput.addEventListener('change', () => {
      const v = customInput.value.trim();
      if (v) onChange(v);
    });

    select.addEventListener('change', () => {
      if (select.value === '__custom__') {
        customInput.style.display = '';
        customInput.focus();
      } else {
        customInput.style.display = 'none';
        onChange(select.value);
      }
    });

    wrapper.appendChild(select);
    wrapper.appendChild(customInput);

    row.appendChild(lbl);
    row.appendChild(wrapper);
    return row;
  }

  function createToggleRow(
    label: string,
    value: boolean,
    onChange: (v: boolean) => void,
  ): HTMLElement {
    const row = createElement('div', { className: 'settings-row' });
    const lbl = createElement('label');
    lbl.textContent = label;
    const toggle = createElement('div', { className: `settings-toggle${value ? ' active' : ''}` });
    toggle.addEventListener('click', () => {
      const newVal = !toggle.classList.contains('active');
      toggle.classList.toggle('active', newVal);
      onChange(newVal);
    });
    row.appendChild(lbl);
    row.appendChild(toggle);
    return row;
  }

  function createKeybindingRow(
    label: string,
    value: string,
    conflicts: string[],
    onChange: (v: string) => void,
  ): HTMLElement {
    const row = createElement('div', { className: 'settings-row' });
    const lbl = createElement('label');
    lbl.textContent = label;

    if (conflicts.length > 0) {
      const conflictHint = createElement('span', { className: 'keybinding-conflict-label' });
      conflictHint.textContent = `Conflicts with: ${conflicts.join(', ')}`;
      lbl.appendChild(conflictHint);
    }

    const kbd = createElement('button', {
      className: `keybinding-input${conflicts.length > 0 ? ' conflict' : ''}`,
    });
    kbd.textContent = formatKeybinding(value);

    kbd.addEventListener('click', () => {
      kbd.textContent = 'Press keys... (Esc to cancel)';
      kbd.classList.add('recording');
      keybindings.setActive(false);

      function onKeydown(e: KeyboardEvent) {
        e.preventDefault();
        e.stopImmediatePropagation();

        // Cancel on Escape
        if (e.key === 'Escape') {
          kbd.textContent = formatKeybinding(value);
          kbd.classList.remove('recording');
          keybindings.setActive(true);
          window.removeEventListener('keydown', onKeydown, true);
          return;
        }

        if (['Alt', 'Control', 'Shift', 'Meta'].includes(e.key)) return;

        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);

        const combo = parts.join('+');
        kbd.textContent = formatKeybinding(combo);
        kbd.classList.remove('recording');
        keybindings.setActive(true);

        window.removeEventListener('keydown', onKeydown, true);
        onChange(combo);
      }

      window.addEventListener('keydown', onKeydown, true);
    });

    row.appendChild(lbl);
    row.appendChild(kbd);
    return row;
  }

  function createApiKeyRow(value: string, onChange: (v: string) => void): HTMLElement {
    const wrapper = createElement('div', { className: 'settings-api-key-section' });

    const row = createElement('div', { className: 'settings-row' });
    const lbl = createElement('label');
    lbl.textContent = 'OpenAI API Key';
    const input = createElement('input', { type: 'password' });
    input.value = value;
    input.placeholder = 'sk-...';
    input.addEventListener('change', () => onChange(input.value));
    row.appendChild(lbl);
    row.appendChild(input);
    wrapper.appendChild(row);

    const actionRow = createElement('div', { className: 'settings-row' });
    const hintText = createElement('span', { className: 'settings-hint' });
    hintText.textContent = 'Used for generating commit messages (GPT-5-nano)';
    actionRow.appendChild(hintText);

    const baseClass = 'settings-btn api-key-test-btn';
    const testBtn = createElement('button', { className: baseClass });
    testBtn.textContent = 'Test';

    function showTestResult(text: string, stateClass: string, delayMs: number): void {
      testBtn.textContent = text;
      testBtn.className = stateClass ? `${baseClass} ${stateClass}` : baseClass;
      setTimeout(() => {
        testBtn.textContent = 'Test';
        testBtn.className = baseClass;
      }, delayMs);
    }

    testBtn.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) {
        showTestResult('No key', 'test-fail', 2500);
        return;
      }

      testBtn.textContent = 'Testing..';
      testBtn.disabled = true;

      let resultText: string;
      let resultClass: string;
      try {
        const res = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (res.ok) {
          resultText = 'Valid';
          resultClass = 'test-pass';
        } else if (res.status === 401) {
          resultText = 'Invalid key';
          resultClass = 'test-fail';
        } else {
          resultText = `Error ${res.status}`;
          resultClass = 'test-fail';
        }
      } catch {
        resultText = 'Network error';
        resultClass = 'test-fail';
      }

      testBtn.disabled = false;
      showTestResult(resultText, resultClass, 3000);
    });

    actionRow.appendChild(testBtn);
    wrapper.appendChild(actionRow);

    return wrapper;
  }

  function formatKeybinding(combo: string): string {
    return combo
      .replace(/Arrow/g, '')
      .replace(/\+/g, ' + ');
  }

  function normalizeCombo(combo: string): string {
    return combo.toLowerCase().split('+').sort().join('+');
  }

  store.select((s) => s.settings, render);

  store.select(
    (s) => s.view,
    (view) => {
      container.classList.toggle('hidden', view !== 'settings');
    },
  );

  render(store.getState().settings);
}
