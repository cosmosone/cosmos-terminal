import type { GitFileStatus, GitFileStatusKind, GitStatusResult } from '../../state/types';

export const STATUS_LETTERS: Record<GitFileStatusKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: 'C',
};

/** Must match .git-commit-textarea max-height in git-sidebar.css */
export const COMMIT_TEXTAREA_MAX_HEIGHT = 200;

export function relativeTime(epochSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000 - epochSeconds);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

function filesEqual(a: GitFileStatus[], b: GitFileStatus[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const fa = a[i], fb = b[i];
    if (fa.path !== fb.path || fa.status !== fb.status || fa.staged !== fb.staged) return false;
  }
  return true;
}

export function statusEquals(a: GitStatusResult | null, b: GitStatusResult | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.branch !== b.branch || a.dirty !== b.dirty || a.ahead !== b.ahead) return false;
  return filesEqual(a.files, b.files) && filesEqual(a.committedFiles, b.committedFiles);
}
