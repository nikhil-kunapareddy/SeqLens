import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { AlignLeft, BarChart3, Dna, FileText, FlaskConical, FolderOpen, LayoutDashboard, Network, ScatterChart, Settings, Upload, } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { APP_VERSION } from '@/types';
import { cn } from '@/utils/cn';
const PRIMARY = [
    { to: '/', label: 'Overview', icon: LayoutDashboard, hint: 'Project dashboard and headline metrics' },
    { to: '/projects', label: 'Projects', icon: FolderOpen, hint: 'Create, switch, and delete local projects' },
    { to: '/import', label: 'Import', icon: Upload, hint: 'Import FASTA and FASTQ files' },
];
const ANALYSIS = [
    { to: '/qc', label: 'QC', icon: BarChart3, hint: 'Quality control and dataset statistics' },
    { to: '/composition', label: 'Composition', icon: FlaskConical, hint: 'Residue composition and k-mer spectra' },
    { to: '/similarity', label: 'Similarity', icon: Network, hint: 'Redundancy, similarity matrix, and clustering' },
    { to: '/orf', label: 'ORF & Translation', icon: Dna, hint: 'Open reading frames and six-frame translation' },
    { to: '/alignment', label: 'Alignment', icon: AlignLeft, hint: 'Pairwise and multiple sequence alignment' },
    { to: '/embeddings', label: 'Embeddings', icon: ScatterChart, hint: 'Sequence embeddings and 2-D exploration' },
];
const SECONDARY = [
    { to: '/reports', label: 'Reports', icon: FileText, hint: 'Generate and export local analysis reports' },
    { to: '/settings', label: 'Settings', icon: Settings, hint: 'Thresholds, display, privacy, and local data' },
];
/**
 * Left navigation.
 *
 * Grouped by workflow stage - set up, analyse, report - rather than
 * alphabetically, so the order matches the order a user actually works in. The
 * analysis group is indented to signal that every item in it operates on the
 * dataset selected above.
 */
export function Sidebar({ className, onNavigate, }) {
    return (_jsxs("nav", { className: cn('flex h-full flex-col border-r border-border bg-card', className), "aria-label": "Main navigation", children: [_jsxs("div", { className: "flex items-center gap-2 px-4 py-3.5", children: [_jsx(Logo, {}), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-[13px] leading-none font-semibold tracking-tight text-foreground", children: "SeqLens" }), _jsx("p", { className: "mt-1 text-[10px] leading-none text-muted-foreground", children: "Local sequence intelligence" })] })] }), _jsx("div", { className: "h-px bg-border" }), _jsxs("div", { className: "flex-1 overflow-y-auto px-2 py-3", children: [_jsx(NavGroup, { items: PRIMARY, onNavigate: onNavigate }), _jsx(GroupLabel, { children: "Analysis" }), _jsx(NavGroup, { items: ANALYSIS, indent: true, onNavigate: onNavigate }), _jsx("div", { className: "my-3 h-px bg-border" }), _jsx(NavGroup, { items: SECONDARY, onNavigate: onNavigate })] }), _jsx("div", { className: "border-t border-border px-4 py-2.5", children: _jsxs("p", { className: "text-[10px] text-muted-foreground", children: ["Version ", APP_VERSION, " \u00B7 runs offline"] }) })] }));
}
function GroupLabel({ children }) {
    return (_jsx("p", { className: "mt-4 mb-1 px-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase", children: children }));
}
function NavGroup({ items, indent = false, onNavigate, }) {
    return (_jsx("ul", { className: "space-y-0.5", children: items.map((item) => (_jsx("li", { children: _jsx(NavLink, { to: item.to, end: item.to === '/', title: item.hint, onClick: onNavigate, className: ({ isActive }) => cn('flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors', indent && 'pl-3', isActive
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'), children: ({ isActive }) => (_jsxs(_Fragment, { children: [_jsx(item.icon, { className: cn('size-4 shrink-0', isActive ? 'text-primary' : ''), strokeWidth: 1.75, "aria-hidden": true }), _jsx("span", { className: "truncate", children: item.label })] })) }) }, item.to))) }));
}
/** Wordmark: a stylised double helix over a rule, matching the favicon. */
function Logo() {
    return (_jsxs("svg", { width: "26", height: "26", viewBox: "0 0 32 32", className: "shrink-0", role: "img", "aria-label": "SeqLens", children: [_jsx("rect", { width: "32", height: "32", rx: "7", fill: "#0f172a" }), _jsxs("g", { stroke: "#7dd3fc", strokeWidth: "2.1", strokeLinecap: "round", fill: "none", children: [_jsx("path", { d: "M9 7c6 3 6 15 0 18" }), _jsx("path", { d: "M23 7c-6 3-6 15 0 18" })] }), _jsxs("g", { stroke: "#38bdf8", strokeWidth: "1.6", strokeLinecap: "round", children: [_jsx("path", { d: "M11.2 11h9.6" }), _jsx("path", { d: "M10.4 16h11.2" }), _jsx("path", { d: "M11.2 21h9.6" })] })] }));
}
