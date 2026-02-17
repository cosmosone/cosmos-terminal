/** Extract the last segment of a path (file or folder name). */
export function basename(path: string, fallback = 'Unknown'): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || fallback;
}
