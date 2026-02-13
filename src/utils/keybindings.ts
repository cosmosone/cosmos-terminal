type KeyHandler = (e: KeyboardEvent) => void;

export interface KeyCombo {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

interface Binding extends KeyCombo {
  handler: KeyHandler;
}

class KeybindingManager {
  private bindings: Binding[] = [];
  private active = true;

  constructor() {
    window.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  register(binding: Binding): () => void {
    this.bindings.push(binding);
    return () => {
      const idx = this.bindings.indexOf(binding);
      if (idx >= 0) this.bindings.splice(idx, 1);
    };
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  /** Check if the event matches any registered binding (without executing). */
  matchesBinding(e: KeyboardEvent): boolean {
    if (!this.active) return false;
    return this.bindings.some((b) => this.comboMatches(e, b));
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (!this.active) return;
    for (const b of this.bindings) {
      if (this.comboMatches(e, b)) {
        e.preventDefault();
        e.stopPropagation();
        b.handler(e);
        return;
      }
    }
  }

  private comboMatches(e: KeyboardEvent, b: KeyCombo): boolean {
    return (
      e.key.toLowerCase() === b.key.toLowerCase() &&
      !!e.ctrlKey === !!b.ctrl &&
      !!e.shiftKey === !!b.shift &&
      !!e.altKey === !!b.alt
    );
  }
}

export const keybindings = new KeybindingManager();

export function parseKeybinding(combo: string): KeyCombo | null {
  if (!combo) return null;
  const parts = combo.split('+');
  const modifiers = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  return {
    key: parts[parts.length - 1],
    ctrl: modifiers.has('ctrl') || undefined,
    shift: modifiers.has('shift') || undefined,
    alt: modifiers.has('alt') || undefined,
  };
}
