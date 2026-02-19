import { store } from '../state/store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getActiveProject, setPaneTree, removePane, removeSession, removeProject, setActivePaneId, updateProjectCwd, markSessionActivity, markPaneOscBusy, markPaneOscIdle } from '../state/actions';
import type { PaneNode, Rect } from '../state/types';
import { computeLayout } from '../layout/pane-layout';
import { setupResizeHandle } from '../layout/resize-handler';
import { findLeafPaneIds } from '../layout/pane-tree';
import { logger } from '../services/logger';
import { getAgentCommand } from '../services/agent-definitions';
import { setInitialCommand } from '../services/initial-command';
import { TerminalPane } from './terminal-pane';

export class SplitContainer {
  private container: HTMLElement;
  private terminals = new Map<string, TerminalPane>();
  private handles: HTMLElement[] = [];
  private focusedPaneId: string | null = null;
  private lastPaneRects = new Map<string, Rect>();
  private renderInFlight = false;
  private renderPending = false;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async render(): Promise<void> {
    if (this.renderInFlight) {
      this.renderPending = true;
      return;
    }
    this.renderInFlight = true;
    try {
      await this.renderImpl();
      while (this.renderPending) {
        this.renderPending = false;
        await this.renderImpl();
      }
    } finally {
      this.renderInFlight = false;
    }
  }

  private async renderImpl(): Promise<void> {
    const project = getActiveProject();
    if (!project) {
      await this.disposeAll();
      return;
    }

    const session = project.sessions.find((s) => s.id === project.activeSessionId);
    if (!session) return;

    const tree = session.paneTree;
    const activePaneIds = new Set(findLeafPaneIds(tree));

    // Collect all paneIds across ALL projects' sessions (for cleanup)
    const state = store.getState();
    const allPaneIds = new Set(
      state.projects.flatMap((p) =>
        p.sessions.flatMap((s) => findLeafPaneIds(s.paneTree)),
      ),
    );

    logger.debug('layout', 'SplitContainer render', {
      projectId: project.id,
      sessionId: session.id,
      activePanes: activePaneIds.size,
      totalPanes: allPaneIds.size,
      existingTerminals: this.terminals.size,
    });

    // Dispose terminals for panes that no longer exist in any project
    for (const [paneId, tp] of this.terminals) {
      if (!allPaneIds.has(paneId)) {
        logger.debug('layout', 'Disposing orphaned terminal pane', { paneId });
        await tp.dispose();
        tp.element.remove();
        this.terminals.delete(paneId);
      }
    }

    // Hide all terminals, then show active session's terminals
    for (const [paneId, tp] of this.terminals) {
      tp.element.style.display = activePaneIds.has(paneId) ? '' : 'none';
    }

    // Compute layout before mounting so new panes have correct dimensions
    const { paneRects: preMountRects } = computeLayout(tree, this.containerRect);

    // Create new terminals for active session panes that don't exist yet
    const capturedSessionId = session.id;
    for (const paneId of activePaneIds) {
      if (!this.terminals.has(paneId)) {
        logger.debug('layout', 'Creating terminal pane', { paneId });
        const capturedProjectId = project.id;
        const tp = new TerminalPane(paneId, project.id, project.path, {
          onProcessExit: () => this.handlePaneExit(capturedProjectId, capturedSessionId, paneId),
          onCwdChange: (cwd) => updateProjectCwd(capturedProjectId, cwd),
          onActivity: () => markSessionActivity(capturedProjectId, capturedSessionId, paneId),
          onOscBusy: () => markPaneOscBusy(capturedProjectId, capturedSessionId, paneId),
          onOscIdle: () => markPaneOscIdle(capturedProjectId, capturedSessionId, paneId),
        });
        tp.element.addEventListener('mousedown', () => {
          if (this.focusedPaneId !== paneId) {
            this.setFocus(paneId);
            setActivePaneId(project.id, capturedSessionId, paneId);
          }
        });
        this.terminals.set(paneId, tp);
        this.container.appendChild(tp.element);

        // Pre-size element so proposeDimensions() in mount() sees real size
        const r = preMountRects.get(paneId);
        if (r) SplitContainer.positionElement(tp.element, r);

        // For restored agent sessions, register the initial command so the
        // terminal automatically runs it on mount (e.g. "gemini -y" for Gemini).
        const agentCmd = getAgentCommand(session.title);
        if (agentCmd) {
          setInitialCommand(paneId, agentCmd);
        }

        await tp.mount();
      }
    }

    this.layout(tree, project.id, session.id);

    if (session.activePaneId && this.terminals.has(session.activePaneId)) {
      this.setFocus(session.activePaneId);
    }
  }

  /** Current container dimensions as a layout rect anchored at the origin. */
  private get containerRect(): Rect {
    return {
      x: 0,
      y: 0,
      width: this.container.offsetWidth,
      height: this.container.offsetHeight,
    };
  }

  /** Apply absolute position and size from a layout rect to an element. */
  private static positionElement(el: HTMLElement, r: Rect): void {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.width}px`;
    el.style.height = `${r.height}px`;
  }

  private static readonly HANDLE_EXPAND = 4;

  private positionHandle(handle: HTMLElement, d: { rect: Rect; direction: string }): void {
    const expand = SplitContainer.HANDLE_EXPAND;
    const isHz = d.direction === 'horizontal';
    handle.style.left = `${d.rect.x - (isHz ? expand : 0)}px`;
    handle.style.top = `${d.rect.y - (isHz ? 0 : expand)}px`;
    handle.style.width = `${d.rect.width + (isHz ? expand * 2 : 0)}px`;
    handle.style.height = `${d.rect.height + (isHz ? 0 : expand * 2)}px`;
  }

  /** Position panes and defer fit(). When activeOnly is true, skip hidden panes. */
  private applyPaneRects(paneRects: Map<string, Rect>, activeOnly: boolean): void {
    const panesToFit: TerminalPane[] = [];
    for (const [paneId, r] of paneRects) {
      const tp = this.terminals.get(paneId);
      if (!tp) continue;
      if (activeOnly && tp.element.style.display === 'none') continue;
      SplitContainer.positionElement(tp.element, r);
      panesToFit.push(tp);
    }
    if (panesToFit.length > 0) {
      requestAnimationFrame(() => {
        for (const tp of panesToFit) tp.fit();
      });
    }
  }

  /** Lightweight position-only update (no handle recreation). */
  private updatePositions(tree: PaneNode): void {
    const { paneRects, dividers } = computeLayout(tree, this.containerRect);
    this.lastPaneRects = paneRects;
    this.applyPaneRects(paneRects, true);

    for (let i = 0; i < this.handles.length && i < dividers.length; i++) {
      this.positionHandle(this.handles[i], dividers[i]);
    }
  }

  private layout(tree: PaneNode, projectId: string, sessionId: string): void {
    const rect = this.containerRect;
    const { paneRects, dividers } = computeLayout(tree, rect);
    this.lastPaneRects = paneRects;
    logger.debug('layout', 'Layout computed', {
      paneCount: paneRects.size,
      dividerCount: dividers.length,
      containerSize: `${rect.width}x${rect.height}`,
      treeType: tree.type,
      direction: tree.type === 'branch' ? tree.direction : 'leaf',
    });
    this.applyPaneRects(paneRects, false);

    // Remove old handles
    for (const h of this.handles) h.remove();
    this.handles = [];
    for (const d of dividers) {
      const handle = document.createElement('div');
      handle.className = `pane-resize-handle ${d.direction}`;
      this.positionHandle(handle, d);

      setupResizeHandle(handle, d, {
        getTree: () => {
          const p = getActiveProject();
          const s = p?.sessions.find((ses) => ses.id === p.activeSessionId);
          return s?.paneTree ?? tree;
        },
        getContainerRect: () => this.container.getBoundingClientRect(),
        onResize: (newTree) => {
          setPaneTree(projectId, sessionId, newTree);
          this.updatePositions(newTree);
        },
      });

      this.container.appendChild(handle);
      this.handles.push(handle);
    }
  }

  setFocus(paneId: string): void {
    if (this.focusedPaneId !== paneId) {
      logger.debug('layout', 'Focus changed', { from: this.focusedPaneId, to: paneId });
    }
    if (this.focusedPaneId) {
      this.terminals.get(this.focusedPaneId)?.blur();
    }
    this.focusedPaneId = paneId;
    this.terminals.get(paneId)?.focus();
  }

  applySettings(): void {
    const settings = store.getState().settings;
    for (const tp of this.terminals.values()) {
      tp.applySettings(settings);
    }
  }

  clearAllScrollback(): void {
    for (const tp of this.terminals.values()) {
      tp.clearScrollback();
    }
  }

  scrollToBottom(): void {
    if (this.focusedPaneId) {
      this.terminals.get(this.focusedPaneId)?.scrollToBottom();
    }
  }

  reLayout(): void {
    const project = getActiveProject();
    if (!project) return;
    const session = project.sessions.find((s) => s.id === project.activeSessionId);
    if (session) this.updatePositions(session.paneTree);
  }

  navigatePane(direction: 'left' | 'right' | 'up' | 'down'): void {
    if (!this.focusedPaneId) return;
    const currentRect = this.lastPaneRects.get(this.focusedPaneId);
    if (!currentRect) return;

    const cx = currentRect.x + currentRect.width / 2;
    const cy = currentRect.y + currentRect.height / 2;

    let bestPaneId: string | null = null;
    let bestDist = Infinity;

    for (const [paneId, rect] of this.lastPaneRects) {
      if (paneId === this.focusedPaneId) continue;

      const px = rect.x + rect.width / 2;
      const py = rect.y + rect.height / 2;
      const dx = px - cx;
      const dy = py - cy;

      let valid = false;
      switch (direction) {
        case 'left': valid = dx < 0; break;
        case 'right': valid = dx > 0; break;
        case 'up': valid = dy < 0; break;
        case 'down': valid = dy > 0; break;
      }
      if (!valid) continue;

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestPaneId = paneId;
      }
    }

    if (bestPaneId) {
      this.setFocus(bestPaneId);
      const project = getActiveProject();
      if (project?.activeSessionId) {
        setActivePaneId(project.id, project.activeSessionId, bestPaneId);
      }
    }
  }

  private handlePaneExit(projectId: string, sessionId: string, paneId: string): void {
    const project = store.getState().projects.find((p) => p.id === projectId);
    if (!project) return;

    const session = project.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const leafCount = findLeafPaneIds(session.paneTree).length;

    if (leafCount <= 1) {
      // Last pane in this tab — close the tab
      logger.info('layout', 'Closing session after last pane exited', { sessionId });
      removeSession(projectId, sessionId);

      const state = store.getState();
      const updated = state.projects.find((p) => p.id === projectId);

      if (updated && updated.sessions.length === 0) {
        if (state.projects.length <= 1) {
          // Last project, last tab — close the window
          logger.info('app', 'Last session exited, closing window');
          getCurrentWindow().close();
          return;
        }
        // Other projects exist — remove this empty project
        removeProject(projectId);
      }
    } else {
      // Multiple panes — just close this pane
      logger.info('layout', 'Closing pane after process exit', { paneId });
      removePane(projectId, sessionId, paneId);
    }

    this.render();
  }

  private async disposeAll(): Promise<void> {
    for (const [, tp] of this.terminals) {
      await tp.dispose();
      tp.element.remove();
    }
    this.terminals.clear();
    for (const h of this.handles) h.remove();
    this.handles = [];
    this.focusedPaneId = null;
  }
}
