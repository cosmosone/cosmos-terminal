import { isWindows } from './platform';

/** Extract the last segment of a path (file or folder name). */
export function basename(path: string, fallback = 'Unknown'): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || fallback;
}

/** Normalize a filesystem path for case-insensitive comparisons. */
export function normalizeFsPath(path: string): string {
  const withForwardSlashes = path.replace(/\\/g, '/');
  // Keep "/" intact; trim trailing slashes on all other paths.
  const trimmed = withForwardSlashes.length > 1
    ? withForwardSlashes.replace(/\/+$/, '')
    : withForwardSlashes;
  return isWindows() ? trimmed.toLowerCase() : trimmed;
}

/** True when `path` is the same as, or nested under, `directory`. */
export function isPathWithinDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizeFsPath(path);
  const normalizedDir = normalizeFsPath(directory);
  if (!normalizedDir) return false;
  if (normalizedDir === '/') {
    return normalizedPath.startsWith('/');
  }
  return normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}/`);
}
