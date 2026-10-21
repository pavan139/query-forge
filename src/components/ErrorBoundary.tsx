import { Component, type ReactNode } from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** When this changes, a caught error is cleared and the children render again. */
  resetKey?: unknown;
  /** Short description of what failed, e.g. "this step". */
  what?: string;
  /** Extra action shown next to "Try again" (e.g. a link home). */
  action?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Keeps one broken piece (a step, a page) from blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-accent/40 bg-warn-soft p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <TriangleAlert size={16} className="text-accent" /> Sorry — {this.props.what ?? 'this part'} couldn't be shown.
        </div>
        <p className="mt-1 text-muted">Your progress is safe. Try again, or carry on — nothing else is affected.</p>
        <p className="mt-1 break-words font-mono text-[11px] text-muted">{error.message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => this.setState({ error: null })}>
            <RotateCcw size={14} /> Try again
          </button>
          {this.props.action}
        </div>
      </div>
    );
  }
}
