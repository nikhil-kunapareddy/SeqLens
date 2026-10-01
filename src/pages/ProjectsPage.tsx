import { Check, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import {
  Alert,
  Badge,
  EmptyState,
  MetricList,
  SectionHeading,
} from '@/components/ui/display';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { Input, Label, Textarea } from '@/components/ui/primitives';
import { useProjectStore } from '@/state/projectStore';
import type { Project } from '@/types';
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
  const [editing, setEditing] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [confirmText, setConfirmText] = useState('');

  const submitCreate = async () => {
    if (newName.trim().length === 0) return;
    await createProject(newName, newDescription);
    setNewName('');
    setNewDescription('');
    setCreating(false);
  };

  const submitRename = async () => {
    if (editing === null) return;
    await renameProject(editing.id, editName, editDescription);
    setEditing(null);
  };

  const submitDelete = async () => {
    if (deleting === null) return;
    await deleteProject(deleting.id);
    setDeleting(null);
    setConfirmText('');
  };

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Projects"
        description="Each project holds its own imported files, analysis configuration, cached results, and reports. Everything is stored in this browser's IndexedDB on this device."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <FolderPlus />
            New project
          </Button>
        }
      />

      {error ? (
        <Alert variant="error" title={error.message}>
          {error.suggestion ? <p>{error.suggestion}</p> : null}
        </Alert>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="No projects yet"
          description="Create a project to group related sequence files, or import a file directly and SeqLens will create one named after it."
          actions={
            <>
              <Button size="sm" onClick={() => setCreating(true)}>
                Create a project
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/import">Import a file</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => {
            const isActive = project.id === activeProjectId;
            return (
              <Card key={project.id} className={isActive ? 'border-primary/40' : undefined}>
                <CardHeaderRow
                  title={
                    <span className="flex items-center gap-1.5">
                      {project.name}
                      {isActive ? <Badge variant="primary">Active</Badge> : null}
                    </span>
                  }
                  description={project.description || 'No description.'}
                  actions={
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setEditing(project);
                          setEditName(project.name);
                          setEditDescription(project.description);
                        }}
                        aria-label={`Rename ${project.name}`}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setDeleting(project);
                          setConfirmText('');
                        }}
                        aria-label={`Delete ${project.name}`}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </>
                  }
                />
                <div className="px-4 pb-3">
                  <MetricList
                    rows={[
                      { label: 'Datasets', value: formatInteger(project.datasetIds.length) },
                      { label: 'Created', value: formatTimestamp(project.createdAt) },
                      { label: 'Last change', value: formatRelativeTime(project.updatedAt) },
                      {
                        label: 'Duplicate threshold',
                        value: `${(project.config.qc.duplicateWarn * 100).toFixed(0)}% warn`,
                        hint: 'From this project’s saved analysis configuration',
                      },
                    ]}
                  />
                </div>
                <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
                  {isActive ? (
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Check className="size-3 text-primary" aria-hidden />
                      {formatInteger(datasets.length)} dataset
                      {datasets.length === 1 ? '' : 's'} loaded
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void selectProject(project.id)}
                    >
                      Open
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              A project groups related sequence files and keeps its own analysis thresholds, so
              results stay reproducible against the configuration that produced them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="e.g. E. coli assembly QC"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-description">Description (optional)</Label>
              <Textarea
                id="project-description"
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="What this project is for, which run the data came from, anything a future reader needs."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submitCreate()} disabled={newName.trim().length === 0}>
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void submitRename()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setConfirmText('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleting?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently removes the project, its{' '}
              {formatInteger(deleting?.datasetIds.length ?? 0)} imported dataset
              {deleting?.datasetIds.length === 1 ? '' : 's'}, every sequence block, all cached
              analysis results, and all generated reports from this browser. There is no undo and
              no copy anywhere else &mdash; SeqLens never sent your data off this device.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-delete">
              Type <span className="font-mono font-semibold">delete</span> to confirm
            </Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder="delete"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDeleting(null);
                setConfirmText('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void submitDelete()}
              disabled={confirmText.trim().toLowerCase() !== 'delete'}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
