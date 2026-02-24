export function isWindows(): boolean {
  return navigator.userAgent.includes('Windows');
}

export function defaultShell(): string {
  if (isWindows()) return 'powershell.exe';
  return '/bin/zsh';
}
