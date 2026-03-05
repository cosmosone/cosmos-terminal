import { getSystemStats } from '../services/system-monitor';
import { logger } from '../services/logger';
import { store } from '../state/store';
import { toggleDebugLogging } from '../state/actions';
import { $ } from '../utils/dom';

const POLL_INTERVAL_MS = 5000;
const TIMER_INTERVAL_MS = 60_000;

export function initStatusBar(onCleanup?: () => void): void {
  const bar = $('#status-bar')!;
  bar.innerHTML = `
    <div class="status-debug-group">
      <span class="status-item status-debug-label" id="status-log-toggle" title="Toggle Log Viewer">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      </span>
      <div class="toggle-switch-sm" title="Toggle Debug Logging"></div>
      <span class="status-debug-timer"></span>
    </div>
    <span class="status-badge">
      <span class="status-badge-stats">
        <span id="status-mem">-- MB</span>
        <span class="status-badge-sep"></span>
        <span id="status-cpu">--%</span>
      </span>
      <span class="status-badge-refresh" id="status-cleanup" title="Optimize Memory">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 2v6h-6"/>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
          <path d="M3 22v-6h6"/>
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
        </svg>
      </span>
    </span>
  `;

  const logToggle = $('#status-log-toggle')!;
  logToggle.addEventListener('click', () => {
    const viewer = $('#log-viewer-container');
    if (viewer) viewer.classList.toggle('hidden');
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

  const refreshBtn = $('#status-cleanup')!;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('sweeping');
    logger.info('app', 'Memory cleanup triggered');

    // Clear terminal scrollback buffers (biggest memory consumer)
    onCleanup?.();

    // Clear debug log entries
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
