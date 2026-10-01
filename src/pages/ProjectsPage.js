import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Check, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, EmptyState, MetricList, SectionHeading, } from '@/components/ui/display';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from '@/components/ui/overlays';
import { Input, Label, Textarea } from '@/components/ui/primitives';
import { useProjectStore } from '@/state/projectStore';
import { formatInteger, formatRelativeTime, formatTimestamp } from '@/utils/format';
/**
 * Project management.
 *
 * A project is the unit of persistence: it owns its datasets, its analysis
 * configuration, its cached results, and its reports. Deleting one removes all
 * of that in a single transaction, which is why deletion is behind a typed
 * confirmation rather than a single click - there is no undo and no copy
 * anywhere else.
 */
export function ProjectsPage() {
    const projects = useProjectStore((state) => state.projects);
    const activeProjectId = useProjectStore((state) => state.activeProjectId);
    const datasets = useProjectStore((state) => state.datasets);
    const createProject = useProjectStore((state) => state.createProject);
    const selectProject = useProjectStore((state) => state.selectProject);
    const renameProject = useProjectStore((state) => state.renameProject);
    const deleteProject = useProjectStore((state) => state.deleteProject);
    const error = useProjectStore((state) => state.error);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [newDescription, setNewDescription] = useState('');
    const [editing, setEditing] = useState(null);
    const [editName, setEditName] = useState('');
    const [editDescription, setEditDescription] = useState('');
    const [deleting, setDeleting] = useState(null);
    const [confirmText, setConfirmText] = useState('');
    const submitCreate = async () => {
        if (newName.trim().length === 0)
            return;
        await createProject(newName, newDescription);
        setNewName('');
        setNewDescription('');
        setCreating(false);
    };
    const submitRename = async () => {
        if (editing === null)
            return;
        await renameProject(editing.id, editName, editDescription);
        setEditing(null);
    };
    const submitDelete = async () => {
        if (deleting === null)
            return;
        await deleteProject(deleting.id);
        setDeleting(null);
        setConfirmText('');
    };
    return (_jsxs("div", { className: "space-y-5", children: [_jsx(SectionHeading, { title: "Projects", description: "Each project holds its own imported files, analysis configuration, cached results, and reports. Everything is stored in this browser's IndexedDB on this device.", actions: _jsxs(Button, { size: "sm", onClick: () => setCreating(true), children: [_jsx(FolderPlus, {}), "New project"] }) }), error ? (_jsx(Alert, { variant: "error", title: error.message, children: error.suggestion ? _jsx("p", { children: error.suggestion }) : null })) : null, projects.length === 0 ? (_jsx(EmptyState, { icon: FolderPlus, title: "No projects yet", description: "Create a project to group related sequence files, or import a file directly and SeqLens will create one named after it.", actions: _jsxs(_Fragment, { children: [_jsx(Button, { size: "sm", onClick: () => setCreating(true), children: "Create a project" }), _jsx(Button, { size: "sm", variant: "outline", asChild: true, children: _jsx(Link, { to: "/import", children: "Import a file" }) })] }) })) : (_jsx("div", { className: "grid gap-3 md:grid-cols-2 xl:grid-cols-3", children: projects.map((project) => {
                    const isActive = project.id === activeProjectId;
                    return (_jsxs(Card, { className: isActive ? 'border-primary/40' : undefined, children: [_jsx(CardHeaderRow, { title: _jsxs("span", { className: "flex items-center gap-1.5", children: [project.name, isActive ? _jsx(Badge, { variant: "primary", children: "Active" }) : null] }), description: project.description || 'No description.', actions: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "ghost", size: "icon-sm", onClick: () => {
                                                setEditing(project);
                                                setEditName(project.name);
                                                setEditDescription(project.description);
                                            }, "aria-label": `Rename ${project.name}`, children: _jsx(Pencil, {}) }), _jsx(Button, { variant: "ghost", size: "icon-sm", onClick: () => {
                                                setDeleting(project);
                                                setConfirmText('');
                                            }, "aria-label": `Delete ${project.name}`, children: _jsx(Trash2, { className: "text-destructive" }) })] }) }), _jsx("div", { className: "px-4 pb-3", children: _jsx(MetricList, { rows: [
                                        { label: 'Datasets', value: formatInteger(project.datasetIds.length) },
                                        { label: 'Created', value: formatTimestamp(project.createdAt) },
                                        { label: 'Last change', value: formatRelativeTime(project.updatedAt) },
                                        {
                                            label: 'Duplicate threshold',
                                            value: `${(project.config.qc.duplicateWarn * 100).toFixed(0)}% warn`,
                                            hint: 'From this project’s saved analysis configuration',
                                        },
                                    ] }) }), _jsx("div", { className: "flex items-center gap-2 border-t border-border px-4 py-2.5", children: isActive ? (_jsxs("span", { className: "flex items-center gap-1 text-[11px] text-muted-foreground", children: [_jsx(Check, { className: "size-3 text-primary", "aria-hidden": true }), formatInteger(datasets.length), " dataset", datasets.length === 1 ? '' : 's', " loaded"] })) : (_jsx(Button, { size: "sm", variant: "outline", onClick: () => void selectProject(project.id), children: "Open" })) })] }, project.id));
                }) })), _jsx(Dialog, { open: creating, onOpenChange: setCreating, children: _jsxs(DialogContent, { className: "max-w-md", children: [_jsxs(DialogHeader, { children: [_jsx(DialogTitle, { children: "New project" }), _jsx(DialogDescription, { children: "A project groups related sequence files and keeps its own analysis thresholds, so results stay reproducible against the configuration that produced them." })] }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "project-name", children: "Name" }), _jsx(Input, { id: "project-name", value: newName, onChange: (event) => setNewName(event.target.value), placeholder: "e.g. E. coli assembly QC", autoFocus: true })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "project-description", children: "Description (optional)" }), _jsx(Textarea, { id: "project-description", value: newDescription, onChange: (event) => setNewDescription(event.target.value), placeholder: "What this project is for, which run the data came from, anything a future reader needs.", rows: 3 })] })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => setCreating(false), children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => void submitCreate(), disabled: newName.trim().length === 0, children: "Create project" })] })] }) }), _jsx(Dialog, { open: editing !== null, onOpenChange: (open) => !open && setEditing(null), children: _jsxs(DialogContent, { className: "max-w-md", children: [_jsx(DialogHeader, { children: _jsx(DialogTitle, { children: "Rename project" }) }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "edit-name", children: "Name" }), _jsx(Input, { id: "edit-name", value: editName, onChange: (event) => setEditName(event.target.value) })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsx(Label, { htmlFor: "edit-description", children: "Description" }), _jsx(Textarea, { id: "edit-description", value: editDescription, onChange: (event) => setEditDescription(event.target.value), rows: 3 })] })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => setEditing(null), children: "Cancel" }), _jsx(Button, { size: "sm", onClick: () => void submitRename(), children: "Save" })] })] }) }), _jsx(Dialog, { open: deleting !== null, onOpenChange: (open) => {
                    if (!open) {
                        setDeleting(null);
                        setConfirmText('');
                    }
                }, children: _jsxs(DialogContent, { className: "max-w-md", children: [_jsxs(DialogHeader, { children: [_jsxs(DialogTitle, { children: ["Delete \u201C", deleting?.name, "\u201D?"] }), _jsxs(DialogDescription, { children: ["This permanently removes the project, its", ' ', formatInteger(deleting?.datasetIds.length ?? 0), " imported dataset", deleting?.datasetIds.length === 1 ? '' : 's', ", every sequence block, all cached analysis results, and all generated reports from this browser. There is no undo and no copy anywhere else \u2014 SeqLens never sent your data off this device."] })] }), _jsxs("div", { className: "space-y-1.5", children: [_jsxs(Label, { htmlFor: "confirm-delete", children: ["Type ", _jsx("span", { className: "font-mono font-semibold", children: "delete" }), " to confirm"] }), _jsx(Input, { id: "confirm-delete", value: confirmText, onChange: (event) => setConfirmText(event.target.value), placeholder: "delete", autoComplete: "off" })] }), _jsxs(DialogFooter, { children: [_jsx(Button, { variant: "ghost", size: "sm", onClick: () => {
                                        setDeleting(null);
                                        setConfirmText('');
                                    }, children: "Cancel" }), _jsx(Button, { variant: "destructive", size: "sm", onClick: () => void submitDelete(), disabled: confirmText.trim().toLowerCase() !== 'delete', children: "Delete permanently" })] })] }) })] }));
}
