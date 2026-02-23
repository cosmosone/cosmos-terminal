// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultFileBrowserSidebarState, defaultGitSidebarState, setActiveTab, setFileTabEditing } from '../../src/state/actions';
import { initFileTabContent } from '../../src/components/file-tab-content';
import { initStore } from '../../src/state/store';
import type { AppState, KeybindingConfig } from '../../src/state/types';

const runtime = vi.hoisted(() => ({
  fsChangeHandler: null as ((affectedDir: string) => void) | null,
}));

const fsMocks = vi.hoisted(() => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  writeTextFileIfUnmodified: vi.fn(),
  getFileMtime: vi.fn(),
  onFsChange: vi.fn(async (callback: (affectedDir: string) => void) => {
    runtime.fsChangeHandler = callback;
    return () => {
      if (runtime.fsChangeHandler === callback) {
        runtime.fsChangeHandler = null;
      }
    };
  }),
}));

vi.mock('../../src/services/fs-service', () => fsMocks);
vi.mock('../../src/components/context-menu', () => ({ showContextMenu: vi.fn() }));
const confirmMocks = vi.hoisted(() => ({
  showConfirmDialog: vi.fn(async () => ({ confirmed: false })),
}));
vi.mock('../../src/components/confirm-dialog', () => confirmMocks);
vi.mock('../../src/highlight/languages/index', () => ({ getGrammar: vi.fn(() => null) }));
vi.mock('../../src/components/find-in-document', () => ({
  createFindController: vi.fn(() => ({
    attach: vi.fn(),
    detach: vi.fn(),
    refreshHighlights: vi.fn(),
    open: vi.fn(),
  })),
}));

const KEYBINDINGS: KeybindingConfig = {
  newSession: 'Ctrl+Shift+t',
  toggleSettings: 'Ctrl+,',
  navigatePaneLeft: 'Alt+ArrowLeft',
  navigatePaneRight: 'Alt+ArrowRight',
  navigatePaneUp: 'Alt+ArrowUp',
  navigatePaneDown: 'Alt+ArrowDown',
  splitDown: 'Alt+x',
  splitUp: 'Alt+s',
  splitLeft: 'Alt+z',
  splitRight: 'Alt+c',
  cycleSessionNext: 'Alt+k',
  cycleSessionPrev: 'Alt+j',
  cycleProjectNext: 'Alt+i',
  cycleProjectPrev: 'Alt+u',
  toggleGitSidebar: 'Alt+d',
  toggleFileBrowser: 'Alt+f',
  searchFileBrowser: 'Ctrl+Shift+f',
  closeTerminalTab: 'Alt+l',
  closeProjectTab: 'Alt+o',
  scrollToBottom: 'Alt+b',
  findInDocument: 'Ctrl+f',
};

function createState(): AppState {
  return {
    projects: [
      {
        id: 'project-1',
        name: 'Project',
        path: 'D:/workspace/project',
        sessions: [
          {
            id: 'session-1',
            title: 'Terminal',
            paneTree: { type: 'leaf', paneId: 'pane-1' },
            activePaneId: 'pane-1',
            hasActivity: false,
            activityCompleted: false,
            locked: false,
          },
        ],
        activeSessionId: null,
        tabs: [
          {
            id: 'tab-1',
            title: 'README.md',
            filePath: 'D:/workspace/project/README.md',
            fileType: 'markdown',
            editing: false,
            dirty: false,
            locked: false,
          },
        ],
        activeTabId: 'tab-1',
        tabActivationSeq: 0,
      },
    ],
    activeProjectId: 'project-1',
    settings: {
      shellPath: 'pwsh.exe',
      fontSize: 12.5,
      fontFamily: 'Cascadia Code',
      lineHeight: 1.2,
      uiFontFamily: 'System Default',
      uiFontSize: 12.5,
      viewerFontSize: 12.5,
      editorFontSize: 12.5,
      scrollbackLines: 10000,
      copyOnSelect: false,
      rightClickPaste: false,
      debugLogging: false,
      debugLoggingExpiry: null,
      confirmCloseTerminalTab: true,
      confirmCloseProjectTab: true,
      keybindings: { ...KEYBINDINGS },
      openaiApiKey: '',
    },
    view: 'terminal',
    gitSidebar: defaultGitSidebarState(),
    fileBrowserSidebar: defaultFileBrowserSidebarState(),
    gitStates: {},
  };
}

describe('file tab markdown view/edit flow', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="file-tab-container"></div>';
    runtime.fsChangeHandler = null;

    fsMocks.readTextFile.mockResolvedValue({
      path: 'D:/workspace/project/README.md',
      content: '# Title\n\nParagraph one.\n\nParagraph two.',
      size: 40,
      truncated: false,
      binary: false,
    });
    fsMocks.writeTextFile.mockResolvedValue(undefined);
    fsMocks.writeTextFileIfUnmodified.mockResolvedValue({ written: true, mtime: 1700000001 });
    fsMocks.getFileMtime.mockResolvedValue(1700000000);
    confirmMocks.showConfirmDialog.mockReset();
    confirmMocks.showConfirmDialog.mockResolvedValue({ confirmed: false });

    initStore(createState());
  });

  it('transitions markdown file between view and edit modes', async () => {
    initFileTabContent();

    await vi.waitFor(() => {
      expect(document.querySelector('.file-tab-markdown')).not.toBeNull();
    });

    expect(document.querySelector('textarea')).toBeNull();

    setFileTabEditing('project-1', 'tab-1', true);

    await vi.waitFor(() => {
      expect(document.querySelector('textarea.file-tab-editor')).not.toBeNull();
    });

    const textarea = document.querySelector('textarea.file-tab-editor') as HTMLTextAreaElement;
    expect(textarea.value).toContain('Paragraph one.');

    setFileTabEditing('project-1', 'tab-1', false);

    await vi.waitFor(() => {
      expect(document.querySelector('.file-tab-markdown')).not.toBeNull();
    });

    expect(document.querySelector('textarea.file-tab-editor')).toBeNull();
  });

  it('reloads external changes when reselecting the active file tab', async () => {
    fsMocks.readTextFile
      .mockResolvedValueOnce({
        path: 'D:/workspace/project/README.md',
        content: '# Original',
        size: 10,
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: 'D:/workspace/project/README.md',
        content: '# Updated',
        size: 9,
        truncated: false,
        binary: false,
      });
    fsMocks.getFileMtime
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(101);

    initFileTabContent();

    await vi.waitFor(() => {
      const md = document.querySelector('.file-tab-markdown') as HTMLElement | null;
      expect(md?.textContent).toContain('Original');
    });

    setActiveTab('project-1', 'tab-1');

    await vi.waitFor(() => {
      const md = document.querySelector('.file-tab-markdown') as HTMLElement | null;
      expect(md?.textContent).toContain('Updated');
    });

    expect(fsMocks.readTextFile.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('reloads external changes on fs watcher events for the active tab', async () => {
    fsMocks.readTextFile
      .mockResolvedValueOnce({
        path: 'D:/workspace/project/README.md',
        content: '# Original',
        size: 10,
        truncated: false,
        binary: false,
      })
      .mockResolvedValueOnce({
        path: 'D:/workspace/project/README.md',
        content: '# Live Update',
        size: 13,
        truncated: false,
        binary: false,
      });
    fsMocks.getFileMtime
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(101);

    initFileTabContent();

    await vi.waitFor(() => {
      const md = document.querySelector('.file-tab-markdown') as HTMLElement | null;
      expect(md?.textContent).toContain('Original');
    });

    await vi.waitFor(() => {
      expect(runtime.fsChangeHandler).not.toBeNull();
    });

    runtime.fsChangeHandler?.('D:/workspace/project');

    await vi.waitFor(() => {
      const md = document.querySelector('.file-tab-markdown') as HTMLElement | null;
      expect(md?.textContent).toContain('Live Update');
    });
  });

  it('guards save with mtime conflict checks and explicit overwrite', async () => {
    fsMocks.readTextFile.mockResolvedValueOnce({
      path: 'D:/workspace/project/README.md',
      content: '# Original',
      size: 10,
      truncated: false,
      binary: false,
    });
    fsMocks.getFileMtime
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(200);
    fsMocks.writeTextFileIfUnmodified.mockResolvedValueOnce({ written: false, mtime: 150 });
    confirmMocks.showConfirmDialog
      .mockResolvedValueOnce({ confirmed: false })
      .mockResolvedValueOnce({ confirmed: true });

    initFileTabContent();
    setFileTabEditing('project-1', 'tab-1', true);

    await vi.waitFor(() => {
      expect(document.querySelector('textarea.file-tab-editor')).not.toBeNull();
    });

    const textarea = document.querySelector('textarea.file-tab-editor') as HTMLTextAreaElement;
    textarea.value = '# Local Edit';
    textarea.dispatchEvent(new Event('input'));

    await vi.waitFor(() => {
      expect(document.querySelector('.file-tab-save-btn')).not.toBeNull();
    });

    (document.querySelector('.file-tab-save-btn') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(fsMocks.writeTextFileIfUnmodified).toHaveBeenCalledWith(
        'D:/workspace/project/README.md',
        '# Local Edit',
        100,
      );
      expect(fsMocks.writeTextFile).toHaveBeenCalledWith('D:/workspace/project/README.md', '# Local Edit');
    });
  });
});
