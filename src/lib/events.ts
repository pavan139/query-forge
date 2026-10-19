// Tiny event bus for celebrations and toasts that any part of the app can trigger.

export type AppEvent =
  | { type: 'xp'; amount: number; reason?: string }
  | { type: 'level'; level: number; title: string; icon: string }
  | { type: 'achievement'; id: string; title: string; icon: string; description: string }
  | { type: 'toast'; tone: 'info' | 'success' | 'error'; message: string }
  | { type: 'confetti' };

type Listener = (e: AppEvent) => void;
const listeners = new Set<Listener>();

export function emit(e: AppEvent) {
  for (const l of listeners) l(e);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function toast(message: string, tone: 'info' | 'success' | 'error' = 'info') {
  emit({ type: 'toast', tone, message });
}
