import { getSystemStats } from '../services/system-monitor';
import { logger } from '../services/logger';
import { $ } from '../utils/dom';

const POLL_INTERVAL_MS = 5000;

export function initStatusBar(onCleanup?: () => void): void {
  const bar = $('#status-bar')!;
  bar.innerHTML = `
    <span class="status-item status-log-btn" id="status-log-toggle" title="Toggle Log Viewer">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        <line x1="8" y1="7" x2="16" y2="7"/>
        <line x1="8" y1="11" x2="14" y2="11"/>
      </svg>
    </span>
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
      logger.debug('app', 'System stats', { memoryMb: stats.memoryMb.toFixed(1), cpuPercent: stats.cpuPercent.toFixed(1) });
    } catch {
      // Backend not ready yet
    }
  }

  poll();
  let intervalId: ReturnType<typeof setInterval> | null = setInterval(poll, POLL_INTERVAL_MS);

  // Pause polling when window is not visible (minimized, etc.)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    } else {
      void poll();
      if (!intervalId) {
        intervalId = setInterval(poll, POLL_INTERVAL_MS);
      }
    }
  });
}
