import { IPC_COMMANDS, invokeIpc } from './ipc';

export interface SystemStats {
  memoryMb: number;
  cpuPercent: number;
}

export function getSystemStats(): Promise<SystemStats> {
  return invokeIpc<SystemStats>(IPC_COMMANDS.GET_SYSTEM_STATS);
}
