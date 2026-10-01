/**
 * Display formatting.
 *
 * Every number a scientist reads goes through here, so the rules are in one
 * place: thousands separators on counts, adaptive precision on ratios, and
 * binary units on file sizes.
 */

const numberFormatters = new Map<string, Intl.NumberFormat>();

function formatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cacheKey = JSON.stringify(options);
  let instance = numberFormatters.get(cacheKey);
  if (!instance) {
    instance = new Intl.NumberFormat(undefined, options);
    numberFormatters.set(cacheKey, instance);
  }
  return instance;
}

/** Integer with thousands separators. */
export const formatInteger = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  return formatter({ maximumFractionDigits: 0 }).format(value);
};

/** Fixed-precision decimal. */
export const formatDecimal = (value: number, digits = 2): string => {
  if (!Number.isFinite(value)) return '-';
  return formatter({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
};

/**
 * Percentage with precision scaled to magnitude.
 *
 * A duplicate rate of 0.003% and one of 24% both need to be readable: two fixed
 * decimals would render the first as "0.00%" and the second with noise.
 */
export const formatPercent = (value: number, digits?: number): string => {
  if (!Number.isFinite(value)) return '-';
  if (digits !== undefined) return `${formatDecimal(value, digits)}%`;
  if (value === 0) return '0%';
  const magnitude = Math.abs(value);
  const precision = magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : magnitude >= 0.01 ? 3 : 4;
  return `${formatDecimal(value, precision)}%`;
};

/** Compact count: 1.2M, 45.6k, 892. */
export const formatCompact = (value: number): string => {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) < 1000) return formatInteger(value);
  return formatter({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
};

/** File size in binary units. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatDecimal(value, value < 10 ? 1 : 0)} ${units[unit]}`;
};

/** Base or residue count with an appropriate unit. */
export const formatResidues = (count: number, isProtein = false): string => {
  const unit = isProtein ? 'aa' : 'bp';
  if (!Number.isFinite(count)) return '-';
  if (count < 1000) return `${formatInteger(count)} ${unit}`;
  if (count < 1_000_000) return `${formatDecimal(count / 1000, 1)} k${unit}`;
  if (count < 1_000_000_000) return `${formatDecimal(count / 1_000_000, 2)} M${unit}`;
  return `${formatDecimal(count / 1_000_000_000, 2)} G${unit}`;
};

/** Wall-clock duration from milliseconds. */
export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${formatDecimal(ms / 1000, 1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
};

/** Absolute timestamp, for reports and metadata. */
export const formatTimestamp = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** ISO 8601 timestamp, for filenames and machine-readable exports. */
export const formatIsoTimestamp = (ms: number): string => new Date(ms).toISOString();

/** Relative time: "3 minutes ago". Falls back to a date beyond a week. */
export const formatRelativeTime = (ms: number): string => {
  const delta = Date.now() - ms;
  if (delta < 0) return formatTimestamp(ms);
  const seconds = Math.floor(delta / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return formatTimestamp(ms);
};

/**
 * Count with a correctly pluralised noun.
 *
 * Used wherever a count can genuinely be one - discovered features such as
 * duplicate groups, clusters, ORFs, and low-complexity regions. "1 regions"
 * in an otherwise careful interface reads as carelessness.
 */
export const pluralize = (count: number, singular: string, plural?: string): string =>
  `${formatInteger(count)} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;

/** Human-readable label for a molecule type. */
export const formatSequenceType = (type: string): string => {
  switch (type) {
    case 'dna':
      return 'DNA';
    case 'rna':
      return 'RNA';
    case 'protein':
      return 'Protein';
    default:
      return 'Unknown';
  }
};

export const formatFileFormat = (format: string): string => {
  switch (format) {
    case 'fasta':
      return 'FASTA';
    case 'fastq':
      return 'FASTQ';
    default:
      return 'Unknown';
  }
};

/** Truncates with a middle ellipsis, keeping both ends of an identifier legible. */
export const truncateMiddle = (text: string, maxLength = 32): string => {
  if (text.length <= maxLength) return text;
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
};

/** Genomic coordinate range, 1-based inclusive. */
export const formatRange = (start: number, end: number): string =>
  `${formatInteger(start)}–${formatInteger(end)}`;

/** Filesystem-safe filename component. */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'seqlens';
