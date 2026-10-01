import { Check, ChevronsUpDown, Database, FolderOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import {
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
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
    return (
      <Button variant="ghost" size="sm" asChild className="gap-1.5">
        <Link to="/projects">
          <FolderOpen />
          <span>No project</span>
        </Link>
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 gap-1.5">
            <FolderOpen className="shrink-0" />
            <span className="truncate font-medium">{project.name}</span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {projects.map((candidate) => (
            <DropdownMenuItem
              key={candidate.id}
              onSelect={() => void selectProject(candidate.id)}
              className="justify-between gap-3"
            >
              <span className="truncate">{candidate.name}</span>
              {candidate.id === project.id ? (
                <Check className="size-3.5 shrink-0 text-primary" />
              ) : (
                <span className="tabular shrink-0 text-[10px] text-muted-foreground">
                  {candidate.datasetIds.length} file
                  {candidate.datasetIds.length === 1 ? '' : 's'}
                </span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to="/projects">Manage projects&hellip;</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="text-muted-foreground/50" aria-hidden>
        /
      </span>

      {datasets.length === 0 ? (
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link to="/import">
            <Database />
            <span>No dataset</span>
          </Link>
        </Button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 gap-1.5">
              <Database className="shrink-0" />
              <span className="truncate font-mono text-xs">
                {dataset?.fileName ?? 'Select dataset'}
              </span>
              <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-80">
            <DropdownMenuLabel>Datasets in this project</DropdownMenuLabel>
            {datasets.map((candidate) => (
              <DropdownMenuItem
                key={candidate.id}
                onSelect={() => selectDataset(candidate.id)}
                className="flex-col items-start gap-1 py-2"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-foreground">
                    {candidate.fileName}
                  </span>
                  {candidate.id === dataset?.id ? (
                    <Check className="size-3.5 shrink-0 text-primary" />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="default" size="sm">
                    {formatFileFormat(candidate.format)}
                  </Badge>
                  <Badge variant="default" size="sm">
                    {formatSequenceType(candidate.sequenceType)}
                  </Badge>
                  <span className="tabular text-[10px] text-muted-foreground">
                    {formatInteger(candidate.sequenceCount)} sequences
                  </span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/import">Import another file&hellip;</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
