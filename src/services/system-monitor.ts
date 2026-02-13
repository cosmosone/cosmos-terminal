import { invoke } from '@tauri-apps/api/core';

export interface SystemStats {
  memoryMb: number;
  cpuPercent: number;
}

export function getSystemStats(): Promise<SystemStats> {
  return invoke<SystemStats>('get_system_stats');
}
