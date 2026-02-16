/** Registry for initial commands to run when a terminal pane first mounts. */
const pendingCommands = new Map<string, string>();

export function setInitialCommand(paneId: string, command: string): void {
  pendingCommands.set(paneId, command);
}

export function consumeInitialCommand(paneId: string): string | null {
  const cmd = pendingCommands.get(paneId) ?? null;
  pendingCommands.delete(paneId);
  return cmd;
}
