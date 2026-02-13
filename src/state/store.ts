import type { AppState, StateListener, StateSelector, StateUpdater } from './types';

type Subscription<T> = {
  selector: StateSelector<T>;
  listener: StateListener<T>;
  lastValue: T;
};

export class Store {
  private state: AppState;
  private subscriptions: Subscription<any>[] = [];
  private batchDepth = 0;
  private pendingNotify = false;

  constructor(initial: AppState) {
    this.state = initial;
  }

  getState(): AppState {
    return this.state;
  }

  setState(updater: StateUpdater): void {
    this.state = updater(this.state);
    if (this.batchDepth > 0) {
      this.pendingNotify = true;
    } else {
      this.notify();
    }
  }

  batch(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.pendingNotify) {
        this.pendingNotify = false;
        this.notify();
      }
    }
  }

  subscribe(listener: StateListener<AppState>): () => void {
    return this.select((s) => s, listener);
  }

  select<T>(selector: StateSelector<T>, listener: StateListener<T>): () => void {
    const sub: Subscription<T> = {
      selector,
      listener,
      lastValue: selector(this.state),
    };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx >= 0) this.subscriptions.splice(idx, 1);
    };
  }

  private notify(): void {
    for (const sub of this.subscriptions) {
      const newValue = sub.selector(this.state);
      if (newValue !== sub.lastValue) {
        sub.lastValue = newValue;
        sub.listener(newValue);
      }
    }
  }
}

export let store: Store;

export function initStore(initial: AppState): Store {
  store = new Store(initial);
  return store;
}
