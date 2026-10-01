import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import {
  createId,
  datasetRepository,
  projectRepository,
  settingsRepository,
} from '@/storage';
import { JobCancelled, JobFailedError, runJob } from '@/workers/client';
import type {
  AnalysisConfig,
  Dataset,
  ImportJobResult,
  JobError,
  Project,
  SequenceType,
} from '@/types';
import { useJobStore } from './jobStore';

export interface ImportRequest {
  file: File;
  /** Overrides automatic molecule-type detection. */
  forcedType?: SequenceType;
}

interface ProjectStoreState {
  projects: Project[];
  activeProjectId: string | null;
  datasets: Dataset[];
  activeDatasetId: string | null;
  loading: boolean;
  /** Set when loading or import fails at the store level. */
  error: JobError | null;
  /** In-flight import controllers, keyed by dataset id, for cancellation. */
  importControllers: Record<string, AbortController>;

  initialize: () => Promise<void>;
  createProject: (name: string, description?: string) => Promise<Project>;
  selectProject: (projectId: string | null) => Promise<void>;
  renameProject: (projectId: string, name: string, description?: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  updateConfig: (projectId: string, config: AnalysisConfig) => Promise<void>;

  selectDataset: (datasetId: string | null) => void;
  importFiles: (requests: ImportRequest[]) => Promise<Dataset[]>;
  cancelImport: (datasetId: string) => void;
  deleteDataset: (datasetId: string) => Promise<void>;
  refreshDatasets: () => Promise<void>;
  clearError: () => void;
}

const LAST_PROJECT_KEY = 'lastProjectId';

/**
 * Projects, datasets, and import orchestration.
 *
 * Deliberately holds only metadata. Residues live in IndexedDB and are read
 * through the block store on demand; putting a dataset's sequences in a React
 * store would defeat the whole point of the block layout, since every state
 * update would retain the entire dataset in the JS heap for as long as any
 * component subscribed to it.
 */
export const useProjectStore = create<ProjectStoreState>()((set, get) => ({
  projects: [],
  activeProjectId: null,
  datasets: [],
  activeDatasetId: null,
  loading: true,
  error: null,
  importControllers: {},

  async initialize() {
    set({ loading: true });
    try {
      const projects = await projectRepository.list();
      const remembered = await settingsRepository.get<string | null>(LAST_PROJECT_KEY, null);
      const activeProjectId =
        remembered && projects.some((project) => project.id === remembered)
          ? remembered
          : (projects[0]?.id ?? null);

      set({ projects, activeProjectId, loading: false });
      if (activeProjectId) await get().refreshDatasets();
    } catch (error) {
      set({
        loading: false,
        error: {
          code: 'internal',
          message: 'Saved projects could not be read from this browser.',
          suggestion:
            'Local storage may be disabled or the browser profile may be in private mode, where IndexedDB is unavailable. Analysis still works; projects just cannot be saved.',
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  },

  async createProject(name, description) {
    const project = await projectRepository.create({ name, description });
    set((state) => ({
      projects: [project, ...state.projects],
      activeProjectId: project.id,
      datasets: [],
      activeDatasetId: null,
    }));
    await settingsRepository.set(LAST_PROJECT_KEY, project.id);
    return project;
  },

  async selectProject(projectId) {
    set({ activeProjectId: projectId, datasets: [], activeDatasetId: null });
    await settingsRepository.set(LAST_PROJECT_KEY, projectId);
    if (projectId) await get().refreshDatasets();
  },

  async renameProject(projectId, name, description) {
    await projectRepository.update(projectId, { name, description });
    const projects = await projectRepository.list();
    set({ projects });
  },

  async deleteProject(projectId) {
    await projectRepository.delete(projectId);
    const projects = await projectRepository.list();
    const activeProjectId =
      get().activeProjectId === projectId ? (projects[0]?.id ?? null) : get().activeProjectId;
    set({ projects, activeProjectId, datasets: [], activeDatasetId: null });
    await settingsRepository.set(LAST_PROJECT_KEY, activeProjectId);
    if (activeProjectId) await get().refreshDatasets();
  },

  async updateConfig(projectId, config) {
    await projectRepository.update(projectId, { config });
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === projectId ? { ...project, config } : project,
      ),
    }));
  },

  selectDataset(datasetId) {
    set({ activeDatasetId: datasetId });
  },

  async refreshDatasets() {
    const projectId = get().activeProjectId;
    if (!projectId) {
      set({ datasets: [], activeDatasetId: null });
      return;
    }
    const datasets = (await datasetRepository.listForProject(projectId)).sort(
      (a, b) => a.importedAt - b.importedAt,
    );
    const activeDatasetId = get().activeDatasetId;
    set({
      datasets,
      activeDatasetId:
        activeDatasetId && datasets.some((dataset) => dataset.id === activeDatasetId)
          ? activeDatasetId
          : (datasets[0]?.id ?? null),
    });
  },

  /**
   * Imports files one at a time.
   *
   * Sequential rather than parallel on purpose: each import streams a file and
   * writes blocks to IndexedDB, so running several at once contends for the
   * same write transactions and multiplies peak memory without finishing any
   * sooner. A file that fails does not stop the others - the error is recorded
   * against its own job and the next file starts.
   */
  async importFiles(requests) {
    let projectId = get().activeProjectId;
    if (!projectId) {
      // Importing without a project creates one named after the first file.
      const label = requests[0]?.file.name.replace(/\.(gz|bgz)$/i, '') ?? 'New project';
      const project = await get().createProject(label);
      projectId = project.id;
    }

    const jobStore = useJobStore.getState();
    const imported: Dataset[] = [];

    for (const request of requests) {
      const datasetId = createId('ds');
      const jobId = `import_${datasetId}`;
      const controller = new AbortController();

      set((state) => ({
        importControllers: { ...state.importControllers, [datasetId]: controller },
      }));

      jobStore.start({
        id: jobId,
        kind: 'import',
        label: `Importing ${request.file.name}`,
        datasetId,
      });

      try {
        const config = get().projects.find((p) => p.id === projectId)?.config ?? DEFAULT_CONFIG;
        const result: ImportJobResult = await runJob(
          {
            kind: 'import',
            datasetId,
            projectId,
            file: request.file,
            config: config.import,
            forcedType:
              request.forcedType && request.forcedType !== 'unknown'
                ? request.forcedType
                : undefined,
          },
          {
            signal: controller.signal,
            onProgress: (stages) => useJobStore.getState().progress(jobId, stages),
          },
        );

        await datasetRepository.register(result);
        useJobStore.getState().finish(jobId);
        imported.push(result.dataset);
      } catch (error) {
        if (error instanceof JobCancelled) {
          useJobStore.getState().cancel(jobId);
        } else if (error instanceof JobFailedError) {
          useJobStore.getState().fail(jobId, error.jobError);
        } else {
          useJobStore.getState().fail(jobId, {
            code: 'internal',
            message: `"${request.file.name}" could not be imported.`,
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        set((state) => {
          const { [datasetId]: _removed, ...rest } = state.importControllers;
          return { importControllers: rest };
        });
      }
    }

    const projects = await projectRepository.list();
    set({ projects });
    await get().refreshDatasets();

    if (imported.length > 0) set({ activeDatasetId: imported[imported.length - 1].id });
    return imported;
  },

  cancelImport(datasetId) {
    get().importControllers[datasetId]?.abort();
  },

  async deleteDataset(datasetId) {
    await datasetRepository.delete(datasetId);
    await get().refreshDatasets();
    const projects = await projectRepository.list();
    set({ projects });
  },

  clearError() {
    set({ error: null });
  },
}));

/* ------------------------------- selectors -------------------------------- */

export const selectActiveProject = (state: ProjectStoreState): Project | null =>
  state.projects.find((project) => project.id === state.activeProjectId) ?? null;

export const selectActiveDataset = (state: ProjectStoreState): Dataset | null =>
  state.datasets.find((dataset) => dataset.id === state.activeDatasetId) ?? null;

export const selectActiveConfig = (state: ProjectStoreState): AnalysisConfig =>
  selectActiveProject(state)?.config ?? DEFAULT_CONFIG;

export interface ProjectTotals {
  datasets: number;
  sequences: number;
  residues: number;
  bytes: number;
}

/**
 * Totals across every dataset in the active project.
 *
 * This builds a new object, so it must be subscribed through `useShallow`;
 * `useProjectTotals` below does that. Subscribing to it directly would compare
 * the fresh object by reference and re-render without end.
 */
export const selectProjectTotals = (state: ProjectStoreState): ProjectTotals => {
  let sequences = 0;
  let residues = 0;
  let bytes = 0;
  for (const dataset of state.datasets) {
    sequences += dataset.sequenceCount;
    residues += dataset.totalResidues;
    bytes += dataset.fileSize;
  }
  return { datasets: state.datasets.length, sequences, residues, bytes };
};

/** Subscribes to the project totals with shallow comparison. */
export const useProjectTotals = (): ProjectTotals =>
  useProjectStore(useShallow(selectProjectTotals));
