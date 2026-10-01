import { create } from 'zustand';

interface SelectionStoreState {
  /** Selected sequence indices per dataset, for alignment and export. */
  selections: Record<string, number[]>;
  /** Sequence currently open in the detail panel, per dataset. */
  focused: Record<string, number | null>;

  toggle: (datasetId: string, index: number) => void;
  setSelection: (datasetId: string, indices: number[]) => void;
  selectRange: (datasetId: string, from: number, to: number) => void;
  clear: (datasetId: string) => void;
  focus: (datasetId: string, index: number | null) => void;
}

/** Upper bound on a selection, matching the alignment sequence cap. */
export const MAX_SELECTION = 200;

/**
 * Cross-page sequence selection.
 *
 * Selecting sequences in the explorer and then aligning them is a two-page
 * workflow, so the selection has to outlive either page's component tree.
 * Indices are held per dataset so switching datasets and returning does not
 * lose the selection.
 */
export const useSelectionStore = create<SelectionStoreState>()((set) => ({
  selections: {},
  focused: {},

  toggle: (datasetId, index) =>
    set((state) => {
      const current = state.selections[datasetId] ?? [];
      const next = current.includes(index)
        ? current.filter((existing) => existing !== index)
        : current.length >= MAX_SELECTION
          ? current
          : [...current, index].sort((a, b) => a - b);
      return { selections: { ...state.selections, [datasetId]: next } };
    }),

  setSelection: (datasetId, indices) =>
    set((state) => ({
      selections: {
        ...state.selections,
        [datasetId]: [...new Set(indices)].sort((a, b) => a - b).slice(0, MAX_SELECTION),
      },
    })),

  selectRange: (datasetId, from, to) =>
    set((state) => {
      const low = Math.min(from, to);
      const high = Math.max(from, to);
      const range: number[] = [];
      for (let i = low; i <= high && range.length < MAX_SELECTION; i += 1) range.push(i);
      const merged = [...new Set([...(state.selections[datasetId] ?? []), ...range])]
        .sort((a, b) => a - b)
        .slice(0, MAX_SELECTION);
      return { selections: { ...state.selections, [datasetId]: merged } };
    }),

  clear: (datasetId) =>
    set((state) => ({ selections: { ...state.selections, [datasetId]: [] } })),

  focus: (datasetId, index) =>
    set((state) => ({ focused: { ...state.focused, [datasetId]: index } })),
}));

/**
 * Shared empty array.
 *
 * Selectors are compared by reference, so returning a fresh `[]` for a dataset
 * with no selection would make every render look like a state change and loop
 * forever. One frozen instance keeps the identity stable.
 */
const NO_SELECTION: readonly number[] = Object.freeze([]);

export const selectSelection = (
  state: SelectionStoreState,
  datasetId: string | null,
): readonly number[] => (datasetId ? (state.selections[datasetId] ?? NO_SELECTION) : NO_SELECTION);

export const selectFocused = (
  state: SelectionStoreState,
  datasetId: string | null,
): number | null => (datasetId ? (state.focused[datasetId] ?? null) : null);
