import { getVersion } from '@tauri-apps/api/app';
import { getSystemStats } from '../services/system-monitor';
import { logger } from '../services/logger';
import { store } from '../state/store';
import { toggleDebugLogging } from '../state/actions';
import { $ } from '../utils/dom';
import { suppressBrowserWebview, restoreBrowserWebview } from './browser-tab-content';

const POLL_INTERVAL_MS = 5000;
const TIMER_INTERVAL_MS = 60_000;

export function initStatusBar(onOptimise?: () => void): void {
  const bar = $('#status-bar')!;
  bar.innerHTML = `
    <span class="status-version"></span>
    <div class="status-debug-group">
      <span class="status-debug-timer"></span>
      <div class="toggle-switch-sm" title="Toggle Debug Logging"></div>
      <span class="status-item status-debug-label" id="status-log-toggle" title="Toggle Log Viewer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
          <line x1="8" y1="13" x2="16" y2="13"></line>
          <line x1="8" y1="17" x2="13" y2="17"></line>
        </svg>
      </span>
    </div>
    <span class="status-badge">
      <span class="status-badge-stats">
        <span id="status-mem">-- MB</span>
        <span class="status-badge-sep"></span>
        <span id="status-cpu">--%</span>
      </span>
      <span class="status-badge-refresh" id="status-optimise" title="Optimise Memory">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 2v6h-6"/>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
          <path d="M3 22v-6h6"/>
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
      </span>
    </span>
  `;

  const versionEl = bar.querySelector<HTMLElement>('.status-version')!;
  getVersion().then((v) => { versionEl.textContent = `v${v}`; });

  const logToggle = $('#status-log-toggle')!;
  logToggle.addEventListener('click', async () => {
    const viewer = $('#log-viewer-container') as HTMLElement | null;
    if (!viewer) return;
    const willShow = viewer.classList.contains('hidden');
    if (willShow) {
      await suppressBrowserWebview();
      viewer.classList.remove('hidden');
    } else {
      viewer.classList.add('hidden');
      restoreBrowserWebview();
    }
  });

  // Debug logging toggle + timer
  const debugToggle = bar.querySelector<HTMLElement>('.toggle-switch-sm')!;
  const debugTimer = bar.querySelector<HTMLElement>('.status-debug-timer')!;

  debugToggle.addEventListener('click', toggleDebugLogging);

  function updateTimer(): void {
    const { debugLogging, debugLoggingExpiry } = store.getState().settings;
    debugToggle.classList.toggle('active', debugLogging);
    if (!debugLogging || !debugLoggingExpiry) {
      debugTimer.textContent = '';
      return;
    }
    const remaining = new Date(debugLoggingExpiry).getTime() - Date.now();
    if (remaining <= 0) {
      debugTimer.textContent = 'Expired';
      return;
    }
    const hours = Math.floor(remaining / (60 * 60 * 1000));
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
    debugTimer.textContent = `${hours}h ${minutes}m`;
  }

  store.select((s) => s.settings.debugLoggingExpiry, updateTimer);

  let timerIntervalId: ReturnType<typeof setInterval> | null = setInterval(updateTimer, TIMER_INTERVAL_MS);

  const refreshBtn = $('#status-optimise')!;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('sweeping');
    logger.info('app', 'Memory optimisation triggered');

    onOptimise?.();
    logger.clear();

    // Re-poll stats after a brief delay to show updated memory
    setTimeout(async () => {
      await poll();
      refreshBtn.classList.remove('sweeping');
    }, 500);
  });

  const memEl = $('#status-mem')!;
  const cpuEl = $('#status-cpu')!;

  async function poll(): Promise<void> {
    try {
      const stats = await getSystemStats();
      memEl.textContent = `${stats.memoryMb.toFixed(0)} MB`;
      cpuEl.textContent = `${stats.cpuPercent.toFixed(0)}%`;
    } catch {
      // Backend not ready yet
    }
  }

  poll();
  let intervalId: ReturnType<typeof setInterval> | null = setInterval(poll, POLL_INTERVAL_MS);

  // Pause polling when window is not visible (minimised, etc.)
  function clearIfActive(id: ReturnType<typeof setInterval> | null): null {
    if (id) clearInterval(id);
    return null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      intervalId = clearIfActive(intervalId);
      timerIntervalId = clearIfActive(timerIntervalId);
    } else {
      void poll();
      updateTimer();
      if (!intervalId) intervalId = setInterval(poll, POLL_INTERVAL_MS);
      if (!timerIntervalId) timerIntervalId = setInterval(updateTimer, TIMER_INTERVAL_MS);
    }
  });
}
