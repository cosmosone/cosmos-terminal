import { claudeIcon, codexIcon, geminiIcon, clineIcon } from '../utils/icons';

export interface AgentDef {
  command: string;
  label: string;
  icon: (size?: number) => string;
  initialCmd?: string;
}

export const AGENT_DEFINITIONS: readonly AgentDef[] = [
  { command: 'claude', label: 'Claude', icon: claudeIcon },
  { command: 'codex', label: 'Codex', icon: codexIcon },
  { command: 'gemini', label: 'Gemini', icon: geminiIcon, initialCmd: 'gemini -y' },
  { command: 'cline', label: 'Cline', icon: clineIcon },
];

/** Look up the initial command for an agent session.
 *  Prefers the stored `agentCommand` field; falls back to matching `sessionTitle` for older data. */
export function getAgentCommand(agentCommand: string | undefined, sessionTitle: string): string | null {
  const key = agentCommand ?? sessionTitle.toLowerCase();
  const agent = AGENT_DEFINITIONS.find((a) => a.command === key);
  if (!agent) return null;
  return agent.initialCmd ?? agent.command;
}
