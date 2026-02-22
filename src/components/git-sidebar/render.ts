import { createElement } from '../../utils/dom';
import { STATUS_LETTERS, relativeTime } from './shared';
import type { Project, ProjectGitState, GitFileStatus, GitLogEntry } from '../../state/types';

const committedFilesExpanded = new Map<string, boolean>();

export interface GitSidebarRenderHandlers {
  onProjectRowClick(project: Project, canExpand: boolean): void;
  onGenerateCommitMessage(project: Project): Promise<void>;
  onCommit(project: Project, push: boolean): Promise<void>;
  onPush(project: Project): Promise<void>;
}

export interface GitProjectRenderDeps {
  localCommitMessages: Map<string, string>;
  textareaMaxHeight: number;
  handlers: GitSidebarRenderHandlers;
}

export function renderProject(project: Project, gs: ProjectGitState, expanded: boolean, deps: GitProjectRenderDeps): HTMLElement {
  const wrap = createElement('div');
  const hasStatus = gs.status !== null;
  const hasFileChanges = (gs.status?.files.length ?? 0) > 0;
  const ahead = gs.status?.ahead ?? 0;
  const canExpand = hasStatus && (hasFileChanges || ahead > 0);
  const isExpanded = expanded && canExpand;

  const row = createElement('div', { className: `git-project-row${isExpanded ? ' active' : ''}` });

  if (canExpand) {
    const arrow = createElement('span', { className: `git-project-arrow${isExpanded ? ' expanded' : ''}` });
    arrow.textContent = '\u25B6';
    row.appendChild(arrow);
  }

  const name = createElement('span', { className: 'git-project-name' });
  name.textContent = project.name;
  row.appendChild(name);

  if (gs.status) {
    const branch = createElement('span', { className: 'git-project-branch' });
    branch.textContent = gs.status.branch;
    row.appendChild(branch);

    if (gs.status.dirty) {
      const dirty = createElement('span', { className: 'git-project-dirty' });
      dirty.textContent = '*';
      row.appendChild(dirty);
    }

    if (gs.status.ahead > 0) {
      const aheadBadge = createElement('span', { className: 'git-project-ahead' });
      aheadBadge.textContent = `\u2191${gs.status.ahead}`;
      row.appendChild(aheadBadge);
    }
  }

  row.addEventListener('click', () => deps.handlers.onProjectRowClick(project, canExpand));
  wrap.appendChild(row);

  if (isExpanded) {
    if (gs.loading) {
      const loading = createElement('div', { className: 'git-sidebar-loading' });
      loading.textContent = 'Loading...';
      wrap.appendChild(loading);
    } else if (gs.error) {
      const err = createElement('div', { className: 'git-sidebar-error' });
      err.textContent = gs.error;
      wrap.appendChild(err);
    } else if (gs.status) {
      if (hasFileChanges) {
        wrap.appendChild(renderCommitArea(project, gs, deps));
        const fileList = createElement('div', { className: 'git-file-list' });
        for (const file of gs.status.files) {
          fileList.appendChild(renderFile(file));
        }
        wrap.appendChild(fileList);
      } else if (ahead > 0) {
        wrap.appendChild(renderPushArea(project, ahead, gs.status.committedFiles, deps));
      }
    }

    if (gs.notification) {
      const notif = createElement('div', { className: `git-sidebar-notification ${gs.notification.type}` });
      notif.textContent = gs.notification.message;
      wrap.appendChild(notif);
    }
  }

  return wrap;
}

export function renderLog(gs: ProjectGitState): HTMLElement {
  const list = createElement('div', { className: 'git-log-list' });

  if (gs.log.length === 0) {
    const empty = createElement('div', { className: 'git-sidebar-empty' });
    empty.textContent = 'No Commits';
    list.appendChild(empty);
    return list;
  }

  for (const entry of gs.log) {
    list.appendChild(renderLogEntry(entry));
  }
  return list;
}

function renderFile(file: GitFileStatus): HTMLElement {
  const row = createElement('div', { className: 'git-file-row' });

  const statusEl = createElement('span', { className: `git-file-status ${file.status}` });
  statusEl.textContent = STATUS_LETTERS[file.status] ?? '?';
  row.appendChild(statusEl);

  const path = createElement('span', { className: 'git-file-path' });
  path.textContent = file.path;
  path.title = file.path;
  row.appendChild(path);

  return row;
}

function renderCommitArea(project: Project, gs: ProjectGitState, deps: GitProjectRenderDeps): HTMLElement {
  const area = createElement('div', { className: 'git-commit-area' });

  const textarea = createElement('textarea', { className: 'git-commit-textarea' });
  textarea.placeholder = 'Commit message...';
  textarea.value = deps.localCommitMessages.get(project.id) ?? gs.commitMessage;

  const autoResize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, deps.textareaMaxHeight) + 'px';
  };

  textarea.addEventListener('input', () => {
    deps.localCommitMessages.set(project.id, textarea.value);
    autoResize();
  });
  area.appendChild(textarea);

  if (textarea.value) {
    requestAnimationFrame(autoResize);
  }

  const buttons = createElement('div', { className: 'git-commit-buttons' });

  const generateBtn = createElement('button', { className: 'git-commit-btn secondary git-generate-btn' });
  generateBtn.textContent = gs.generating ? (gs.generatingLabel || 'Generating...') : 'Generate';
  generateBtn.disabled = gs.generating;
  generateBtn.addEventListener('click', () => {
    void deps.handlers.onGenerateCommitMessage(project);
  });
  buttons.appendChild(generateBtn);

  function addButton(label: string, handler: () => void): void {
    const btn = createElement('button', { className: 'git-commit-btn secondary' });
    btn.textContent = label;
    btn.addEventListener('click', handler);
    buttons.appendChild(btn);
  }

  addButton('Commit', () => {
    void deps.handlers.onCommit(project, false);
  });
  addButton('Push', () => {
    void deps.handlers.onPush(project);
  });
  addButton('Commit & Push', () => {
    void deps.handlers.onCommit(project, true);
  });

  area.appendChild(buttons);
  return area;
}

function renderPushArea(project: Project, ahead: number, committedFiles: GitFileStatus[], deps: GitProjectRenderDeps): HTMLElement {
  const area = createElement('div', { className: 'git-push-area' });

  const row = createElement('div', { className: 'git-push-row' });
  const msg = createElement('span', { className: 'git-push-message' });
  msg.textContent = `${ahead} unpushed commit${ahead === 1 ? '' : 's'}`;
  row.appendChild(msg);

  const pushBtn = createElement('button', { className: 'git-commit-btn secondary' });
  pushBtn.textContent = 'Push';
  pushBtn.addEventListener('click', () => {
    void deps.handlers.onPush(project);
  });
  row.appendChild(pushBtn);
  area.appendChild(row);

  if (committedFiles.length > 0) {
    const expanded = committedFilesExpanded.get(project.id) ?? false;

    const header = createElement('div', { className: 'git-section-header' });
    const arrow = createElement('span', { className: `git-section-arrow${expanded ? '' : ' collapsed'}` });
    arrow.textContent = '\u25B6';
    header.appendChild(arrow);

    const label = createElement('span');
    label.textContent = 'Committed Files';
    header.appendChild(label);

    const fileList = createElement('div', { className: 'git-file-list' });
    fileList.style.display = expanded ? '' : 'none';
    for (const file of committedFiles) {
      fileList.appendChild(renderFile(file));
    }

    header.addEventListener('click', () => {
      const nowExpanded = !(committedFilesExpanded.get(project.id) ?? false);
      committedFilesExpanded.set(project.id, nowExpanded);
      arrow.className = `git-section-arrow${nowExpanded ? '' : ' collapsed'}`;
      fileList.style.display = nowExpanded ? '' : 'none';
    });

    area.appendChild(header);
    area.appendChild(fileList);
  }

  return area;
}

function renderLogEntry(entry: GitLogEntry): HTMLElement {
  const el = createElement('div', { className: 'git-log-entry' });

  const msgRow = createElement('div', { className: 'git-log-message' });
  msgRow.textContent = entry.message;
  msgRow.title = entry.message;
  el.appendChild(msgRow);

  const meta = createElement('div', { className: 'git-log-meta' });

  const sha = createElement('span', { className: 'git-log-sha' });
  sha.textContent = entry.id;
  meta.appendChild(sha);

  const author = createElement('span', { className: 'git-log-author' });
  author.textContent = entry.author;
  meta.appendChild(author);

  const time = createElement('span', { className: 'git-log-time' });
  time.textContent = relativeTime(entry.timestamp);
  meta.appendChild(time);

  el.appendChild(meta);

  if (entry.refsList.length > 0) {
    const refs = createElement('div', { className: 'git-log-refs' });
    for (const ref of entry.refsList) {
      const badge = createElement('span', { className: 'git-log-ref' });
      badge.textContent = ref;
      refs.appendChild(badge);
    }
    el.appendChild(refs);
  }

  return el;
}
