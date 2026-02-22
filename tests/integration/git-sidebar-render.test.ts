// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { renderProject } from '../../src/components/git-sidebar/render';
import type { Project, ProjectGitState } from '../../src/state/types';

function createProject(): Project {
  return {
    id: 'project-1',
    name: 'cosmos-terminal',
    path: 'D:/workspaces/cosmos-terminal',
    sessions: [],
    activeSessionId: null,
    tabs: [],
    activeTabId: null,
  };
}

function createGitState(files: NonNullable<ProjectGitState['status']>['files']): ProjectGitState {
  return {
    isRepo: true,
    status: {
      branch: 'main',
      dirty: files.length > 0,
      files,
    },
    log: [],
    loading: false,
    error: null,
    commitMessage: '',
    generating: false,
    generatingLabel: '',
    notification: null,
  };
}

describe('git sidebar project render', () => {
  it('hides chevron and commit controls when there are no file changes', () => {
    const clickSpy = vi.fn();
    const project = createProject();
    const gs = createGitState([]);
    const element = renderProject(project, gs, true, {
      localCommitMessages: new Map(),
      textareaMaxHeight: 200,
      handlers: {
        onProjectRowClick: clickSpy,
        onGenerateCommitMessage: async () => {},
        onCommit: async () => {},
        onPush: async () => {},
      },
    });

    expect(element.querySelector('.git-project-arrow')).toBeNull();
    expect(element.querySelector('.git-commit-area')).toBeNull();
    expect(element.querySelector('.git-sidebar-empty')).toBeNull();

    const row = element.querySelector('.git-project-row') as HTMLElement;
    row.click();
    expect(clickSpy).toHaveBeenCalledWith(project, false);
  });

  it('shows chevron and commit controls when there are file changes', () => {
    const clickSpy = vi.fn();
    const project = createProject();
    const gs = createGitState([
      {
        path: 'src/components/git-sidebar/render.ts',
        status: 'modified',
        staged: false,
      },
    ]);
    const element = renderProject(project, gs, true, {
      localCommitMessages: new Map(),
      textareaMaxHeight: 200,
      handlers: {
        onProjectRowClick: clickSpy,
        onGenerateCommitMessage: async () => {},
        onCommit: async () => {},
        onPush: async () => {},
      },
    });

    expect(element.querySelector('.git-project-arrow')).not.toBeNull();
    expect(element.querySelector('.git-commit-area')).not.toBeNull();
    expect(element.querySelectorAll('.git-file-row').length).toBe(1);

    const row = element.querySelector('.git-project-row') as HTMLElement;
    row.click();
    expect(clickSpy).toHaveBeenCalledWith(project, true);
  });
});
