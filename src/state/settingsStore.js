import { create } from 'zustand';
import { blockCache, settingsRepository } from '@/storage';
export const DEFAULT_SETTINGS = {
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
const STORAGE_KEY = 'appSettings';
/**
 * Interface preferences, persisted locally.
 *
 * Distinct from `AnalysisConfig`: these affect only how results are displayed,
 * so changing one never invalidates a cached analysis. Analysis thresholds live
 * on the project, because they change what the numbers mean and must travel
 * with the results for reproducibility.
 */
export const useSettingsStore = create()((set, get) => ({
    ...DEFAULT_SETTINGS,
    loaded: false,
    async load() {
        const stored = await settingsRepository.get(STORAGE_KEY, {});
        const merged = { ...DEFAULT_SETTINGS, ...stored };
        set({ ...merged, loaded: true });
        blockCache.setBudget(merged.cacheBudgetMb * 1_000_000);
    },
    async update(key, value) {
        set({ [key]: value });
        if (key === 'cacheBudgetMb')
            blockCache.setBudget(value * 1_000_000);
        const current = get();
        const snapshot = {
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
