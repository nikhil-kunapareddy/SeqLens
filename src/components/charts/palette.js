/**
 * Chart colour tokens, as TypeScript constants.
 *
 * These mirror the CSS custom properties in `index.css`. Duplication is
 * deliberate and necessary: Recharts needs literal colour values in props, and
 * the HTML report generator produces SVG strings outside any document, where
 * `var(--color-chart-1)` would resolve to nothing. Both consumers need the hex.
 *
 * The categorical order is fixed and validated. Slots are assigned by series
 * identity, never by rank, so filtering a chart never repaints the survivors.
 */
/** Categorical series, in fixed assignment order. */
export const SERIES = [
    '#2a78d6', // 1 blue
    '#eb6834', // 2 orange
    '#1baf7a', // 3 aqua
    '#eda100', // 4 yellow
    '#e87ba4', // 5 magenta
    '#008300', // 6 green
    '#4a3aa7', // 7 violet
    '#e34948', // 8 red
];
/** Neutral for the folded tail. A ninth series is never a generated hue. */
export const SERIES_OTHER = '#898781';
/**
 * Slots safe when any two marks can sit adjacent (scatter, bubble, matrix).
 *
 * The full eight cannot clear the separation floors under all-pairs comparison;
 * these four can. Past four categories, the embedding explorer adds marker
 * shape as a second channel rather than a fifth hue.
 */
export const SERIES_ALL_PAIRS = ['#2a78d6', '#eb6834', '#1baf7a', '#4a3aa7'];
/** Marker shapes used as the second channel past four categories. */
export const MARKER_SHAPES = ['circle', 'triangle', 'square', 'diamond'];
/** Sequential ramp: one hue, light to dark. Magnitude only, never identity. */
export const SEQUENTIAL = [
    '#cde2fb',
    '#b7d3f6',
    '#9ec5f4',
    '#86b6ef',
    '#6da7ec',
    '#5598e7',
    '#3987e5',
    '#2a78d6',
    '#256abf',
    '#1c5cab',
    '#184f95',
    '#104281',
    '#0d366b',
];
/**
 * Diverging pair for signed values such as GC skew.
 * Warm and cool poles with a neutral grey midpoint, so zero reads as "nothing".
 */
export const DIVERGING = {
    negative: ['#0d366b', '#1c5cab', '#3987e5', '#86b6ef', '#cde2fb'],
    midpoint: '#f0efec',
    positive: ['#fbdcdc', '#f0a3a3', '#e34948', '#c02f2f', '#8f2020'],
};
/** Status colours. Fixed, never reused for a data series. */
export const STATUS = {
    pass: '#0ca30c',
    warning: '#fab219',
    review: '#d03b3b',
    neutral: '#898781',
};
/** Chart chrome. */
export const CHROME = {
    surface: '#ffffff',
    plane: '#f7f8f9',
    ink: '#101317',
    inkSecondary: '#4d5257',
    muted: '#6b7280',
    grid: '#e8eaed',
    axis: '#c4c8cc',
    border: '#e2e5e8',
};
/** Nucleotide colours, matching genome-browser convention. */
export const BASE_COLORS = {
    A: '#008300',
    C: '#2a78d6',
    G: '#eda100',
    T: '#e34948',
    U: '#e34948',
    N: '#898781',
    other: '#898781',
};
export const AMINO_CLASS = {
    A: 'hydrophobic', V: 'hydrophobic', L: 'hydrophobic', I: 'hydrophobic',
    M: 'hydrophobic', C: 'hydrophobic', P: 'hydrophobic',
    S: 'polar', T: 'polar', N: 'polar', Q: 'polar', G: 'polar',
    D: 'acidic', E: 'acidic',
    K: 'basic', R: 'basic', H: 'basic',
    F: 'aromatic', W: 'aromatic', Y: 'aromatic',
    X: 'special', B: 'special', Z: 'special', J: 'special',
    U: 'special', O: 'special', '*': 'special', '-': 'special', '.': 'special',
};
/** Light washes for residue backgrounds in the sequence viewer. */
export const AMINO_CLASS_WASH = {
    hydrophobic: '#e6effa',
    polar: '#e4f4ee',
    acidic: '#fdeaea',
    basic: '#eae6f7',
    aromatic: '#fdf3e0',
    special: '#f2f3f4',
};
export const AMINO_CLASS_LABEL = {
    hydrophobic: 'Hydrophobic (AVLIMCP)',
    polar: 'Polar (STNQG)',
    acidic: 'Acidic (DE)',
    basic: 'Basic (KRH)',
    aromatic: 'Aromatic (FWY)',
    special: 'Other / ambiguous',
};
/** Light washes for nucleotide backgrounds in the sequence viewer. */
export const BASE_WASH = {
    A: '#e3f3e3',
    C: '#e4eefa',
    G: '#fdf3e0',
    T: '#fdeaea',
    U: '#fdeaea',
    N: '#f2f3f4',
};
/**
 * Maps a 0..1 value onto the sequential ramp.
 * Values outside the range are clamped rather than wrapped, so an out-of-range
 * input cannot alias onto the opposite end of the scale.
 */
export function sequentialColor(t) {
    if (!Number.isFinite(t))
        return SEQUENTIAL[0];
    const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return SEQUENTIAL[Math.min(SEQUENTIAL.length - 1, Math.round(clamped * (SEQUENTIAL.length - 1)))];
}
/** Maps a -1..1 value onto the diverging scale. */
export function divergingColor(t) {
    if (!Number.isFinite(t) || Math.abs(t) < 0.02)
        return DIVERGING.midpoint;
    const magnitude = Math.min(1, Math.abs(t));
    const arm = t < 0 ? DIVERGING.negative : DIVERGING.positive;
    const index = Math.min(arm.length - 1, Math.floor(magnitude * arm.length));
    return t < 0 ? arm[arm.length - 1 - index] : arm[index];
}
/** Series colour for a given index, folding the tail into the neutral. */
export const seriesColor = (index) => index < SERIES.length ? SERIES[index] : SERIES_OTHER;
/** Colour and shape for an all-pairs form, cycling shape after four hues. */
export function markerFor(index) {
    const hue = index % SERIES_ALL_PAIRS.length;
    const shape = Math.floor(index / SERIES_ALL_PAIRS.length) % MARKER_SHAPES.length;
    return { color: SERIES_ALL_PAIRS[hue], shape: MARKER_SHAPES[shape] };
}
/** Maximum distinguishable clusters in an all-pairs form. */
export const MAX_ALL_PAIRS_CATEGORIES = SERIES_ALL_PAIRS.length * MARKER_SHAPES.length;
