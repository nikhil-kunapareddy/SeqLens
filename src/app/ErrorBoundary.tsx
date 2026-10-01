import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { deleteAllLocalData } from '@/storage/repositories';

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

/**
 * Top-level error boundary.
 *
 * A render failure in a data-dense view should not leave a blank page with the
 * real message only in the console. The boundary states what happened, offers
 * the two recoveries that actually help - reload, or clear local data if the
 * stored state itself is the problem - and keeps the stack available behind a
 * disclosure for a bug report.
 *
 * Nothing is reported anywhere: there is no telemetry in SeqLens, so an error
 * the user does not read is an error nobody sees.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    // Console only. This is the user's own browser, and no report is sent.
    console.error('SeqLens render error:', error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null, info: null });
  };

  private clearData = async () => {
    await deleteAllLocalData();
    window.location.reload();
  };

  render(): ReactNode {
    const { error, info } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-xl rounded-lg border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 space-y-3">
              <div className="space-y-1">
                <h1 className="text-sm font-semibold text-foreground">
                  Something in SeqLens stopped working
                </h1>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The view failed to render. Your imported data is still in local storage and was
                  not affected. Reloading usually clears it; if the failure repeats on the same
                  page, a stored result may be malformed and clearing local data will fix it.
                </p>
              </div>

              <div className="rounded border border-border bg-subtle px-3 py-2">
                <p className="font-mono text-[11px] break-words text-foreground">{error.message}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => window.location.reload()}>
                  Reload SeqLens
                </Button>
                <Button size="sm" variant="outline" onClick={this.reset}>
                  Try again
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void this.clearData()}>
                  Clear all local data
                </Button>
              </div>

              {info?.componentStack ? (
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    Technical detail
                  </summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded border border-border bg-subtle p-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                    {error.stack}
                    {info.componentStack}
                  </pre>
                </details>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }
}
