export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type LogCategory =
  | 'app'
  | 'pty'
  | 'layout'
  | 'settings'
  | 'project'
  | 'session'
  | 'git';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: string;
}

type LogListener = (entry: LogEntry) => void;

const MAX_ENTRIES = 1000;

const SENSITIVE_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api[_-]?key/i,
  /authorization/i,
  /credential/i,
];

function sanitize(value: unknown): string | undefined {
  if (value == null) return undefined;
  let str = typeof value === 'string' ? value : JSON.stringify(value);
  if (SENSITIVE_PATTERNS.some((p) => p.test(str))) {
    str = str.replace(
      /("[^"]*(?:password|token|secret|api[_-]?key|authorization|credential)[^"]*"\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    );
  }
  return str;
}

class Logger {
  private entries: LogEntry[] = [];
  private listeners: LogListener[] = [];
  private _enabled = false;

  get enabled(): boolean {
    return this._enabled;
  }

  enable(): void {
    this._enabled = true;
    this.log('INFO', 'app', 'Debug logging enabled');
  }

  disable(): void {
    this.log('INFO', 'app', 'Debug logging disabled');
    this._enabled = false;
  }

  log(level: LogLevel, category: LogCategory, message: string, data?: unknown): void {
    if (!this._enabled) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data: sanitize(data),
    };

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }

    for (const listener of this.listeners) {
      listener(entry);
    }
  }

  debug(category: LogCategory, message: string, data?: unknown): void {
    this.log('DEBUG', category, message, data);
  }

  info(category: LogCategory, message: string, data?: unknown): void {
    this.log('INFO', category, message, data);
  }

  warn(category: LogCategory, message: string, data?: unknown): void {
    this.log('WARN', category, message, data);
  }

  error(category: LogCategory, message: string, data?: unknown): void {
    this.log('ERROR', category, message, data);
  }

  getEntries(filter?: {
    level?: LogLevel;
    category?: LogCategory;
    keyword?: string;
  }): LogEntry[] {
    let result = this.entries;
    if (filter?.level) {
      const levels: LogLevel[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
      const minIdx = levels.indexOf(filter.level);
      result = result.filter((e) => levels.indexOf(e.level) >= minIdx);
    }
    if (filter?.category) {
      result = result.filter((e) => e.category === filter.category);
    }
    if (filter?.keyword) {
      const kw = filter.keyword.toLowerCase();
      result = result.filter(
        (e) =>
          e.message.toLowerCase().includes(kw) ||
          (e.data && e.data.toLowerCase().includes(kw)),
      );
    }
    return result;
  }

  clear(): void {
    this.entries = [];
  }

  onLog(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  exportAsText(entries?: LogEntry[]): string {
    const list = entries ?? this.entries;
    return list
      .map((e) => {
        const ts = new Date(e.timestamp).toISOString();
        const data = e.data ? ` | ${e.data}` : '';
        return `[${ts}] [${e.level}] [${e.category}] ${e.message}${data}`;
      })
      .join('\n');
  }
}

export const logger = new Logger();
