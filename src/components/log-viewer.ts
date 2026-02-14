import { logger, type LogLevel, type LogEntry } from '../services/logger';
import { store } from '../state/store';
import { toggleDebugLogging } from '../state/actions';
import { createElement, clearChildren } from '../utils/dom';

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: 'var(--text-muted)',
  INFO: 'var(--accent)',
  WARN: 'var(--warning)',
  ERROR: 'var(--danger)',
};

export function initLogViewer(): void {
  const container = document.getElementById('log-viewer-container')!;
  let currentLevel: LogLevel | '' = '';
  let currentKeyword = '';
  let autoScroll = true;

  // --- Header ---
  const header = createElement('div', { className: 'log-viewer-header' });

  const titleGroup = createElement('div', { className: 'log-viewer-title-group' });

  const title = createElement('span', { className: 'log-viewer-title' });
  title.textContent = 'Debug Logs';
  titleGroup.appendChild(title);

  const { debugLogging } = store.getState().settings;
  const toggle = createElement('div', {
    className: `log-debug-toggle${debugLogging ? ' active' : ''}`,
  });
  toggle.title = debugLogging ? 'Disable debug logging' : 'Enable debug logging';
  toggle.addEventListener('click', toggleDebugLogging);
  titleGroup.appendChild(toggle);

  store.select(
    (s) => s.settings.debugLogging,
    (enabled) => {
      toggle.classList.toggle('active', enabled);
      toggle.title = enabled ? 'Disable debug logging' : 'Enable debug logging';
    },
  );

  header.appendChild(titleGroup);

  const controls = createElement('div', { className: 'log-viewer-controls' });

  // Level filter
  const levelSelect = createElement('select', { className: 'log-filter-select' });
  for (const opt of ['All Levels', 'DEBUG', 'INFO', 'WARN', 'ERROR']) {
    const option = createElement('option');
    option.value = opt === 'All Levels' ? '' : opt;
    option.textContent = opt;
    levelSelect.appendChild(option);
  }
  levelSelect.addEventListener('change', () => {
    currentLevel = levelSelect.value as LogLevel | '';
    renderEntries();
  });
  controls.appendChild(levelSelect);

  // Keyword search
  const searchInput = createElement('input', {
    type: 'text',
    className: 'log-search-input',
    placeholder: 'Search logs...',
  });
  searchInput.addEventListener('input', () => {
    currentKeyword = (searchInput as HTMLInputElement).value;
    renderEntries();
  });
  controls.appendChild(searchInput);

  // Copy button
  const copyBtn = createElement('button', { className: 'log-btn' });
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    const entries = getFilteredEntries();
    const text = logger.exportAsText(entries);
    navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
  });
  controls.appendChild(copyBtn);

  // Clear button
  const clearBtn = createElement('button', { className: 'log-btn' });
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    logger.clear();
    renderEntries();
  });
  controls.appendChild(clearBtn);

  // Close button
  const closeBtn = createElement('button', { className: 'log-btn log-btn-close' });
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', () => {
    container.classList.add('hidden');
  });
  controls.appendChild(closeBtn);

  header.appendChild(controls);
  container.appendChild(header);

  // --- Log list ---
  const logList = createElement('div', { className: 'log-list' });
  container.appendChild(logList);

  // Auto-scroll detection
  logList.addEventListener('scroll', () => {
    autoScroll = logList.scrollTop + logList.clientHeight >= logList.scrollHeight - 20;
  });

  function getFilteredEntries(): LogEntry[] {
    return logger.getEntries({
      level: currentLevel || undefined,
      keyword: currentKeyword || undefined,
    });
  }

  function renderEntries(): void {
    clearChildren(logList);
    const entries = getFilteredEntries();
    for (const entry of entries) {
      logList.appendChild(createLogRow(entry));
    }
    if (autoScroll) {
      logList.scrollTop = logList.scrollHeight;
    }
  }

  function createLogRow(entry: LogEntry): HTMLElement {
    const row = createElement('div', { className: `log-row log-level-${entry.level.toLowerCase()}` });

    const ts = createElement('span', { className: 'log-ts' });
    const d = new Date(entry.timestamp);
    ts.textContent = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
    row.appendChild(ts);

    const level = createElement('span', { className: 'log-level' });
    level.textContent = entry.level;
    level.style.color = LEVEL_COLORS[entry.level];
    row.appendChild(level);

    const cat = createElement('span', { className: 'log-cat' });
    cat.textContent = entry.category;
    row.appendChild(cat);

    const msg = createElement('span', { className: 'log-msg' });
    msg.textContent = entry.message;
    row.appendChild(msg);

    if (entry.data) {
      const data = createElement('span', { className: 'log-data' });
      data.textContent = entry.data;
      row.appendChild(data);
    }

    return row;
  }

  // Live updates — skip DOM work when log viewer is hidden
  logger.onLog((entry) => {
    if (container.classList.contains('hidden')) return;

    const matches =
      (!currentLevel || ['DEBUG', 'INFO', 'WARN', 'ERROR'].indexOf(entry.level) >= ['DEBUG', 'INFO', 'WARN', 'ERROR'].indexOf(currentLevel)) &&
      (!currentKeyword ||
        entry.message.toLowerCase().includes(currentKeyword.toLowerCase()) ||
        (entry.data && entry.data.toLowerCase().includes(currentKeyword.toLowerCase())));

    if (matches) {
      logList.appendChild(createLogRow(entry));
      // Keep DOM from growing unbounded
      while (logList.children.length > 1000) {
        logList.removeChild(logList.firstChild!);
      }
      if (autoScroll) {
        logList.scrollTop = logList.scrollHeight;
      }
    }
  });

  // Initial render
  renderEntries();
}
