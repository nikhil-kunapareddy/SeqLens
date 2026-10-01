import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Check, ChevronsUpDown, Database, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from '@/components/ui/overlays';
import { selectActiveDataset, selectActiveProject, useProjectStore, } from '@/state/projectStore';
import { formatFileFormat, formatInteger, formatSequenceType } from '@/utils/format';
/**
 * Project and dataset selector.
 *
 * Every analysis page reads the active dataset from the store rather than from
 * a route parameter, so this control is the single place the analysis target is
 * chosen. Keeping it in the header means switching datasets never loses the
 * page you were on: the QC view for dataset B opens where the QC view for
 * dataset A was.
 */
export function DatasetSwitcher() {
    const project = useProjectStore(selectActiveProject);
    const dataset = useProjectStore(selectActiveDataset);
    const projects = useProjectStore((state) => state.projects);
    const datasets = useProjectStore((state) => state.datasets);
    const selectProject = useProjectStore((state) => state.selectProject);
    const selectDataset = useProjectStore((state) => state.selectDataset);
    if (project === null) {
        return (_jsx(Button, { variant: "ghost", size: "sm", asChild: true, className: "gap-1.5", children: _jsxs(Link, { to: "/projects", children: [_jsx(FolderOpen, {}), _jsx("span", { children: "No project" })] }) }));
    }
    return (_jsxs("div", { className: "flex min-w-0 items-center gap-1", children: [_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsxs(Button, { variant: "ghost", size: "sm", className: "min-w-0 gap-1.5", children: [_jsx(FolderOpen, { className: "shrink-0" }), _jsx("span", { className: "truncate font-medium", children: project.name }), _jsx(ChevronsUpDown, { className: "size-3 shrink-0 opacity-60" })] }) }), _jsxs(DropdownMenuContent, { align: "start", className: "min-w-56", children: [_jsx(DropdownMenuLabel, { children: "Projects" }), projects.map((candidate) => (_jsxs(DropdownMenuItem, { onSelect: () => void selectProject(candidate.id), className: "justify-between gap-3", children: [_jsx("span", { className: "truncate", children: candidate.name }), candidate.id === project.id ? (_jsx(Check, { className: "size-3.5 shrink-0 text-primary" })) : (_jsxs("span", { className: "tabular shrink-0 text-[10px] text-muted-foreground", children: [candidate.datasetIds.length, " file", candidate.datasetIds.length === 1 ? '' : 's'] }))] }, candidate.id))), _jsx(DropdownMenuSeparator, {}), _jsx(DropdownMenuItem, { asChild: true, children: _jsx(Link, { to: "/projects", children: "Manage projects\u2026" }) })] })] }), _jsx("span", { className: "text-muted-foreground/50", "aria-hidden": true, children: "/" }), datasets.length === 0 ? (_jsx(Button, { variant: "ghost", size: "sm", asChild: true, className: "gap-1.5", children: _jsxs(Link, { to: "/import", children: [_jsx(Database, {}), _jsx("span", { children: "No dataset" })] }) })) : (_jsxs(DropdownMenu, { children: [_jsx(DropdownMenuTrigger, { asChild: true, children: _jsxs(Button, { variant: "ghost", size: "sm", className: "min-w-0 gap-1.5", children: [_jsx(Database, { className: "shrink-0" }), _jsx("span", { className: "truncate font-mono text-xs", children: dataset?.fileName ?? 'Select dataset' }), _jsx(ChevronsUpDown, { className: "size-3 shrink-0 opacity-60" })] }) }), _jsxs(DropdownMenuContent, { align: "start", className: "min-w-80", children: [_jsx(DropdownMenuLabel, { children: "Datasets in this project" }), datasets.map((candidate) => (_jsxs(DropdownMenuItem, { onSelect: () => selectDataset(candidate.id), className: "flex-col items-start gap-1 py-2", children: [_jsxs("div", { className: "flex w-full items-center justify-between gap-2", children: [_jsx("span", { className: "truncate font-mono text-xs text-foreground", children: candidate.fileName }), candidate.id === dataset?.id ? (_jsx(Check, { className: "size-3.5 shrink-0 text-primary" })) : null] }), _jsxs("div", { className: "flex flex-wrap items-center gap-1", children: [_jsx(Badge, { variant: "default", size: "sm", children: formatFileFormat(candidate.format) }), _jsx(Badge, { variant: "default", size: "sm", children: formatSequenceType(candidate.sequenceType) }), _jsxs("span", { className: "tabular text-[10px] text-muted-foreground", children: [formatInteger(candidate.sequenceCount), " sequences"] })] })] }, candidate.id))), _jsx(DropdownMenuSeparator, {}), _jsx(DropdownMenuItem, { asChild: true, children: _jsx(Link, { to: "/import", children: "Import another file\u2026" }) })] })] }))] }));
}
