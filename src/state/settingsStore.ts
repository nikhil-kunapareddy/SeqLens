import { create } from 'zustand';
import { blockCache, settingsRepository } from '@/storage';

export interface AppSettings {
  /** Residues per line in the sequence viewer. 0 means fit to width. */
  sequenceLineWidth: number;
  /** Colour residues by base or amino acid class. */
  colorResidues: boolean;
  /** Show the position ruler in the sequence viewer. */
  showRuler: boolean;
  /** Monospace font size in the sequence viewer, in pixels. */
  sequenceFontSize: number;
  /** Rows rendered per screen in virtualised tables. */
  tablePageSize: number;
  /** Residue budget for the block read cache, in megabytes. */
  cacheBudgetMb: number;
  /** Ask the browser to make stored data exempt from eviction. */
  requestPersistence: boolean;
  /** Warn before importing a file larger than this, in megabytes. */
  largeFileWarnMb: number;
  /** Numeric locale for formatting. Empty string uses the browser default. */
  numberLocale: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  sequenceLineWidth: 60,
  colorResidues: true,
  showRuler: true,
  sequenceFontSize: 12,
  tablePageSize: 60,
  cacheBudgetMb: 24,
  requestPersistence: true,
  largeFileWarnMb: 500,
  numberLocale: '',
};

interface SettingsStoreState extends AppSettings {
  loaded: boolean;
  load: () => Promise<void>;
  update: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  reset: () => Promise<void>;
}

const STORAGE_KEY = 'appSettings';

/**
 * Interface preferences, persisted locally.
 *
 * Distinct from `AnalysisConfig`: these affect only how results are displayed,
 * so changing one never invalidates a cached analysis. Analysis thresholds live
 * on the project, because they change what the numbers mean and must travel
 * with the results for reproducibility.
 */
export const useSettingsStore = create<SettingsStoreState>()((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  async load() {
    const stored = await settingsRepository.get<Partial<AppSettings>>(STORAGE_KEY, {});
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    set({ ...merged, loaded: true });
    blockCache.setBudget(merged.cacheBudgetMb * 1_000_000);
  },

  async update(key, value) {
    set({ [key]: value } as Partial<SettingsStoreState>);
    if (key === 'cacheBudgetMb') blockCache.setBudget((value as number) * 1_000_000);

    const current = get();
    const snapshot: AppSettings = {
      sequenceLineWidth: current.sequenceLineWidth,
      colorResidues: current.colorResidues,
      showRuler: current.showRuler,
      sequenceFontSize: current.sequenceFontSize,
      tablePageSize: current.tablePageSize,
      cacheBudgetMb: current.cacheBudgetMb,
      requestPersistence: current.requestPersistence,
      largeFileWarnMb: current.largeFileWarnMb,
      numberLocale: current.numberLocale,
      [key]: value,
    };
    await settingsRepository.set(STORAGE_KEY, snapshot);
  },

  async reset() {
    set({ ...DEFAULT_SETTINGS });
    blockCache.setBudget(DEFAULT_SETTINGS.cacheBudgetMb * 1_000_000);
    await settingsRepository.set(STORAGE_KEY, DEFAULT_SETTINGS);
  },
}));
