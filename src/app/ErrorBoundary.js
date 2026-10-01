import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { AlertTriangle } from 'lucide-react';
import { Component } from 'react';
import { Button } from '@/components/ui/button';
import { deleteAllLocalData } from '@/storage/repositories';
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
export class ErrorBoundary extends Component {
    state = { error: null, info: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        this.setState({ error, info });
        // Console only. This is the user's own browser, and no report is sent.
        console.error('SeqLens render error:', error, info.componentStack);
    }
    reset = () => {
        this.setState({ error: null, info: null });
    };
    clearData = async () => {
        await deleteAllLocalData();
        window.location.reload();
    };
    render() {
        const { error, info } = this.state;
        if (error === null)
            return this.props.children;
        return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-background p-6", children: _jsx("div", { className: "w-full max-w-xl rounded-lg border border-border bg-card p-6", children: _jsxs("div", { className: "flex items-start gap-3", children: [_jsx(AlertTriangle, { className: "mt-0.5 size-5 shrink-0 text-destructive", "aria-hidden": true }), _jsxs("div", { className: "min-w-0 space-y-3", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("h1", { className: "text-sm font-semibold text-foreground", children: "Something in SeqLens stopped working" }), _jsx("p", { className: "text-xs leading-relaxed text-muted-foreground", children: "The view failed to render. Your imported data is still in local storage and was not affected. Reloading usually clears it; if the failure repeats on the same page, a stored result may be malformed and clearing local data will fix it." })] }), _jsx("div", { className: "rounded border border-border bg-subtle px-3 py-2", children: _jsx("p", { className: "font-mono text-[11px] break-words text-foreground", children: error.message }) }), _jsxs("div", { className: "flex flex-wrap gap-2", children: [_jsx(Button, { size: "sm", onClick: () => window.location.reload(), children: "Reload SeqLens" }), _jsx(Button, { size: "sm", variant: "outline", onClick: this.reset, children: "Try again" }), _jsx(Button, { size: "sm", variant: "destructive", onClick: () => void this.clearData(), children: "Clear all local data" })] }), info?.componentStack ? (_jsxs("details", { className: "text-[11px]", children: [_jsx("summary", { className: "cursor-pointer text-muted-foreground hover:text-foreground", children: "Technical detail" }), _jsxs("pre", { className: "mt-2 max-h-56 overflow-auto rounded border border-border bg-subtle p-2 text-[10px] leading-relaxed whitespace-pre-wrap text-muted-foreground", children: [error.stack, info.componentStack] })] })) : null] })] }) }) }));
    }
}
