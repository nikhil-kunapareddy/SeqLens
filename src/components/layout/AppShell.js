import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Menu, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/overlays';
import { DatasetSwitcher } from './DatasetSwitcher';
import { JobActivity } from './JobActivity';
import { PrivacyIndicator } from './PrivacyIndicator';
import { Sidebar } from './Sidebar';
/**
 * Application frame.
 *
 * A fixed sidebar with a scrolling content pane, which is what a dense
 * analytical tool wants: navigation stays put while a table of a hundred
 * thousand rows scrolls, and the dataset switcher in the header is always
 * reachable because every analysis page operates on the selected dataset.
 *
 * Below the large breakpoint the sidebar collapses into a dialog rather than a
 * squeezed rail, because the navigation labels matter more than the icons.
 */
export function AppShell() {
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const location = useLocation();
    return (_jsxs("div", { className: "flex h-screen overflow-hidden bg-background", children: [_jsx(Sidebar, { className: "hidden w-56 shrink-0 lg:flex" }), _jsx(Dialog, { open: mobileNavOpen, onOpenChange: setMobileNavOpen, children: _jsxs(DialogContent, { className: "max-w-60 p-0", hideClose: true, children: [_jsx("div", { className: "flex items-center justify-end border-b border-border px-2 py-1.5", children: _jsx(Button, { variant: "ghost", size: "icon-sm", onClick: () => setMobileNavOpen(false), "aria-label": "Close navigation", children: _jsx(X, {}) }) }), _jsx(Sidebar, { className: "border-r-0", onNavigate: () => setMobileNavOpen(false) })] }) }), _jsxs("div", { className: "flex min-w-0 flex-1 flex-col", children: [_jsxs("header", { className: "flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3", children: [_jsx(Button, { variant: "ghost", size: "icon-sm", className: "lg:hidden", onClick: () => setMobileNavOpen(true), "aria-label": "Open navigation", children: _jsx(Menu, {}) }), _jsx(DatasetSwitcher, {}), _jsxs("div", { className: "ml-auto flex items-center gap-2", children: [_jsx(PrivacyIndicator, { className: "hidden sm:inline-flex" }), _jsx(JobActivity, {}), _jsx(Button, { size: "sm", asChild: true, children: _jsxs(Link, { to: "/import", children: [_jsx(Upload, {}), _jsx("span", { className: "hidden sm:inline", children: "Import FASTA / FASTQ" }), _jsx("span", { className: "sm:hidden", children: "Import" })] }) })] })] }), _jsx("main", { id: "main-content", className: "min-w-0 flex-1 overflow-y-auto", children: _jsx("div", { className: "mx-auto max-w-[1600px] px-4 py-5 lg:px-6", children: _jsx(Outlet, {}) }) }, location.pathname)] })] }));
}
