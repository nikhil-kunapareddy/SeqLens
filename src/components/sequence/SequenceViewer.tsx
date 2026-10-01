import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Copy, Download, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AMINO_CLASS, AMINO_CLASS_WASH, BASE_WASH } from '@/components/charts/palette';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/display';
import { Input, Switch, Label } from '@/components/ui/primitives';
import { useSettingsStore } from '@/state/settingsStore';
import type { Sequence, SequenceType } from '@/types';
import { cn } from '@/utils/cn';
import { MIME, copyToClipboard, saveFile } from '@/utils/export';
import { formatDecimal, formatInteger, slugify } from '@/utils/format';
import { formatFastaRecord, formatFastqRecord } from '@/bio/parsers/writer';
import { gcContent } from '@/bio/statistics/composition';
import { useDebouncedValue } from '@/utils/debounce';

export interface Annotation {
  /** 1-based inclusive start. */
  start: number;
  /** 1-based inclusive end. */
  end: number;
  label: string;
  color: string;
  /** Shown in the annotation's tooltip. */
  detail?: string;
}

export interface SequenceViewerProps {
  sequence: Sequence;
  sequenceType: SequenceType;
  /** Phred offset, for rendering the quality track. */
  qualityOffset?: number;
  /** Feature spans to shade, such as ORFs or low-complexity regions. */
  annotations?: Annotation[];
  /** Extra metadata rows shown in the header. */
  metadata?: { label: string; value: string }[];
  /** Hides the built-in header, for embedding inside another panel. */
  hideHeader?: boolean;
  className?: string;
  /** Viewport height in pixels. */
  height?: number;
}

interface MatchSpan {
  start: number;
  end: number;
}

/** Stable empty list, so a line with no annotations keeps a fixed identity. */
const EMPTY_ANNOTATIONS: readonly Annotation[] = Object.freeze([]);

/**
 * Virtualised residue viewer.
 *
 * A 250 Mbp chromosome is 4.2 million wrapped lines. Rendering one span per
 * residue would be 250 million DOM nodes; rendering one div per line would
 * still be 4.2 million. Only the lines inside the viewport plus a small
 * overscan are mounted, so the node count is a function of the window height
 * rather than the sequence length, and scrolling a chromosome costs the same as
 * scrolling a read.
 *
 * Residue colouring is the one place where per-residue spans are unavoidable.
 * It is therefore opt-in and applied only to the mounted lines - at the default
 * 60 residues per line and a 560-pixel viewport that is about 2,400 spans, not
 * 250 million.
 */
export function SequenceViewer({
  sequence,
  sequenceType,
  qualityOffset = 33,
  annotations,
  metadata,
  hideHeader = false,
  className,
  height = 420,
}: SequenceViewerProps) {
  const lineWidth = useSettingsStore((state) => state.sequenceLineWidth);
  const colorResidues = useSettingsStore((state) => state.colorResidues);
  const showRuler = useSettingsStore((state) => state.showRuler);
  const fontSize = useSettingsStore((state) => state.sequenceFontSize);
  const updateSetting = useSettingsStore((state) => state.update);

  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);
  const debouncedQuery = useDebouncedValue(query, 220);

  const residues = sequence.residues;
  const isProtein = sequenceType === 'protein';
  const perLine = Math.max(10, lineWidth || 60);
  const lineCount = Math.max(1, Math.ceil(residues.length / perLine));

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: lineCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (sequence.quality ? fontSize * 2.9 : fontSize * 1.85),
    overscan: 8,
  });

  const gc = useMemo(() => (isProtein ? null : gcContent(residues)), [residues, isProtein]);

  /**
   * Finds every occurrence of the query.
   *
   * Searching is case-insensitive and treats the query as a literal residue
   * string, not a regular expression: a scientist typing `ATG[CG]` means those
   * six characters, and silently interpreting brackets would return nothing
   * with no explanation. IUPAC ambiguity in the *query* is matched against the
   * bases it stands for, which is what makes `ATGN` find `ATGA` and `ATGC`.
   */
  const matches = useMemo<MatchSpan[]>(() => {
    const needle = debouncedQuery.trim().toUpperCase();
    if (needle.length === 0) return [];
    const found: MatchSpan[] = [];
    const haystack = residues.toUpperCase();

    if (/^[ACGTU]+$/.test(needle) || isProtein) {
      // Exact literal search, the fast path.
      let from = 0;
      while (found.length < 5000) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        found.push({ start: at, end: at + needle.length });
        from = at + 1;
      }
      return found;
    }

    // Ambiguity-aware scan for queries containing IUPAC codes.
    const expansions: Record<string, string> = {
      R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
      B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGTU',
    };
    const matchesAt = (offset: number): boolean => {
      for (let i = 0; i < needle.length; i += 1) {
        const expected = needle[i];
        const actual = haystack[offset + i];
        if (actual === undefined) return false;
        if (expected === actual) continue;
        const allowed = expansions[expected];
        if (allowed === undefined || !allowed.includes(actual)) return false;
      }
      return true;
    };
    for (let offset = 0; offset + needle.length <= haystack.length && found.length < 5000; offset += 1) {
      if (matchesAt(offset)) found.push({ start: offset, end: offset + needle.length });
    }
    return found;
  }, [debouncedQuery, residues, isProtein]);

  useEffect(() => {
    setActiveMatch(0);
  }, [debouncedQuery]);

  /** Scrolls the viewport to a given 0-based residue offset. */
  const scrollToOffset = useCallback(
    (offset: number) => {
      virtualizer.scrollToIndex(Math.floor(offset / perLine), { align: 'center' });
    },
    [virtualizer, perLine],
  );

  const goToMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    const next = (activeMatch + direction + matches.length) % matches.length;
    setActiveMatch(next);
    scrollToOffset(matches[next].start);
  };

  const copy = async () => {
    const ok = await copyToClipboard(residues);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  };

  const exportSequence = async () => {
    const asFastq = sequence.quality !== undefined;
    const contents = asFastq
      ? formatFastqRecord(sequence.id, sequence.description, residues, sequence.quality ?? '')
      : formatFastaRecord(sequence.id, sequence.description, residues, { lineWidth: perLine });
    await saveFile(contents, {
      suggestedName: `${slugify(sequence.id)}.${asFastq ? 'fastq' : 'fasta'}`,
      mimeType: asFastq ? MIME.fastq : MIME.fasta,
      description: asFastq ? 'FASTQ sequence' : 'FASTA sequence',
      extensions: [asFastq ? '.fastq' : '.fasta'],
    });
  };

  // Character width of the monospace font, needed to position the annotation
  // track and the ruler against the residue columns.
  const charWidth = fontSize * 0.6;

  return (
    <div className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-card', className)}>
      {hideHeader ? null : (
        <div className="space-y-2 border-b border-border px-3 py-2.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs font-semibold text-foreground" title={sequence.id}>
                {sequence.id}
              </p>
              {sequence.description ? (
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sequence.description}>
                  {sequence.description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="icon-sm" onClick={() => void copy()} title="Copy residues" aria-label="Copy residues">
                {copied ? <Check className="text-[#067506]" /> : <Copy />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void exportSequence()}
                title={`Export as ${sequence.quality ? 'FASTQ' : 'FASTA'}`}
                aria-label="Export sequence"
              >
                <Download />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{isProtein ? 'Protein' : sequenceType === 'rna' ? 'RNA' : 'DNA'}</Badge>
            <Badge variant="default">{formatInteger(residues.length)} {isProtein ? 'aa' : 'bp'}</Badge>
            {gc ? <Badge variant="default">GC {formatDecimal(gc.percent, 1)}%</Badge> : null}
            {sequence.quality ? <Badge variant="default">Has quality</Badge> : null}
            <Badge variant="default">#{formatInteger(sequence.index + 1)}</Badge>
            {metadata?.map((row) => (
              <Badge key={row.label} variant="default" title={row.label}>
                {row.label} {row.value}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Controls row: search plus display toggles, above the residues. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-subtle px-3 py-2">
        <div className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                goToMatch(event.shiftKey ? -1 : 1);
              }
            }}
            placeholder={isProtein ? 'Find motif, e.g. GXGXXG' : 'Find motif, e.g. ATG or GGNRA'}
            className="h-7 pr-16 pl-7 font-mono text-xs"
            aria-label="Search within this sequence"
          />
          {query ? (
            <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-0.5">
              <span className="tabular px-1 text-[10px] text-muted-foreground">
                {matches.length === 0 ? '0' : `${activeMatch + 1}/${formatInteger(matches.length)}`}
              </span>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : null}
        </div>

        {matches.length > 0 ? (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => goToMatch(-1)} className="h-7 px-2">
              Prev
            </Button>
            <Button variant="outline" size="sm" onClick={() => goToMatch(1)} className="h-7 px-2">
              Next
            </Button>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Switch
              id="viewer-color"
              checked={colorResidues}
              onCheckedChange={(checked) => void updateSetting('colorResidues', checked)}
            />
            <Label htmlFor="viewer-color" className="cursor-pointer text-[11px]">
              Colour
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="viewer-ruler"
              checked={showRuler}
              onCheckedChange={(checked) => void updateSetting('showRuler', checked)}
            />
            <Label htmlFor="viewer-ruler" className="cursor-pointer text-[11px]">
              Ruler
            </Label>
          </div>
          <select
            value={perLine}
            onChange={(event) => void updateSetting('sequenceLineWidth', Number(event.target.value))}
            className="h-7 rounded-md border border-input bg-card px-1.5 text-[11px] text-foreground"
            aria-label="Residues per line"
          >
            {[30, 60, 80, 100, 120, 150].map((option) => (
              <option key={option} value={option}>
                {option} / line
              </option>
            ))}
          </select>
        </div>
      </div>

      {annotations && annotations.length > 0 ? (
        <AnnotationTrack
          annotations={annotations}
          length={residues.length}
          onSelect={(annotation) => scrollToOffset(annotation.start - 1)}
        />
      ) : null}

      <div ref={scrollRef} className="overflow-auto" style={{ height }}>
        {residues.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            This record has a header but no residues.
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const lineStart = item.index * perLine;
              const lineEnd = Math.min(residues.length, lineStart + perLine);
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  className="absolute top-0 left-0 w-full px-3"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <SequenceLine
                    residues={residues}
                    quality={sequence.quality}
                    qualityOffset={qualityOffset}
                    start={lineStart}
                    end={lineEnd}
                    perLine={perLine}
                    fontSize={fontSize}
                    charWidth={charWidth}
                    colorResidues={colorResidues}
                    showRuler={showRuler}
                    isProtein={isProtein}
                    matches={matches}
                    activeMatch={matches[activeMatch]}
                    annotations={annotations}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {colorResidues ? (
        <ResidueLegend isProtein={isProtein} className="border-t border-border bg-subtle px-3 py-1.5" />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One wrapped line                                                           */
/* -------------------------------------------------------------------------- */

interface SequenceLineProps {
  residues: string;
  quality?: string;
  qualityOffset: number;
  start: number;
  end: number;
  perLine: number;
  fontSize: number;
  charWidth: number;
  colorResidues: boolean;
  showRuler: boolean;
  isProtein: boolean;
  matches: MatchSpan[];
  activeMatch?: MatchSpan;
  annotations?: Annotation[];
}

function SequenceLine({
  residues,
  quality,
  qualityOffset,
  start,
  end,
  fontSize,
  charWidth,
  colorResidues,
  showRuler,
  isProtein,
  matches,
  activeMatch,
  annotations,
}: SequenceLineProps) {
  const text = residues.slice(start, end);
  const lineMatches = useMemo(
    () => matches.filter((match) => match.start < end && match.end > start),
    [matches, start, end],
  );
  // Memoised on its own rather than inline: an inline fallback array would be a
  // new reference each render and would invalidate the memos that depend on it.
  const lineAnnotations = useMemo(
    () => annotations?.filter((a) => a.start - 1 < end && a.end > start) ?? EMPTY_ANNOTATIONS,
    [annotations, start, end],
  );

  /** Highlight state per position in this line. */
  const highlight = useMemo(() => {
    if (lineMatches.length === 0 && lineAnnotations.length === 0) return null;
    const flags = new Uint8Array(text.length);
    for (const match of lineMatches) {
      const from = Math.max(0, match.start - start);
      const to = Math.min(text.length, match.end - start);
      const isActive =
        activeMatch !== undefined &&
        match.start === activeMatch.start &&
        match.end === activeMatch.end;
      for (let i = from; i < to; i += 1) flags[i] = isActive ? 2 : 1;
    }
    return flags;
  }, [lineMatches, lineAnnotations, text.length, start, activeMatch]);

  const annotationColor = useMemo(() => {
    if (lineAnnotations.length === 0) return null;
    const colors: (string | null)[] = new Array(text.length).fill(null);
    for (const annotation of lineAnnotations) {
      const from = Math.max(0, annotation.start - 1 - start);
      const to = Math.min(text.length, annotation.end - start);
      for (let i = from; i < to; i += 1) colors[i] = annotation.color;
    }
    return colors;
  }, [lineAnnotations, text.length, start]);

  return (
    <div className="border-b border-border/60 py-1">
      {showRuler ? (
        <div className="flex">
          {/* Matches the coordinate gutter so ruler ticks line up with residues. */}
          <span className="shrink-0 pr-3" style={{ width: 84 }} aria-hidden />
          <Ruler start={start} length={text.length} charWidth={charWidth} fontSize={fontSize - 2} />
        </div>
      ) : null}

      <div className="flex items-baseline">
        <span
          className="residues shrink-0 pr-3 text-right text-muted-foreground select-none"
          style={{ width: 84, fontSize: fontSize - 1 }}
        >
          {formatInteger(start + 1)}
        </span>

        <span className="residues" style={{ fontSize }}>
          {colorResidues || highlight !== null || annotationColor !== null ? (
            [...text].map((residue, offset) => {
              const state = highlight?.[offset] ?? 0;
              const annotation = annotationColor?.[offset] ?? null;
              const background =
                state === 2
                  ? '#fde68a'
                  : state === 1
                    ? '#fef3c7'
                    : annotation !== null
                      ? `${annotation}22`
                      : colorResidues
                        ? washFor(residue, isProtein)
                        : undefined;
              return (
                <span
                  key={offset}
                  style={{
                    backgroundColor: background,
                    borderBottom:
                      annotation !== null && state === 0 ? `2px solid ${annotation}` : undefined,
                  }}
                >
                  {residue}
                </span>
              );
            })
          ) : (
            text
          )}
        </span>

        <span
          className="residues ml-3 shrink-0 text-muted-foreground select-none"
          style={{ fontSize: fontSize - 1 }}
        >
          {formatInteger(end)}
        </span>
      </div>

      {quality ? (
        <QualityTrack
          quality={quality.slice(start, end)}
          offset={qualityOffset}
          fontSize={fontSize}
          charWidth={charWidth}
        />
      ) : null}
    </div>
  );
}

/** Position ruler: a tick every ten residues. */
function Ruler({
  start,
  length,
  charWidth,
  fontSize,
}: {
  start: number;
  length: number;
  charWidth: number;
  fontSize: number;
}) {
  const ticks: { offset: number; label: string }[] = [];
  const firstTick = Math.ceil((start + 1) / 10) * 10;
  for (let position = firstTick; position <= start + length; position += 10) {
    ticks.push({ offset: position - start - 1, label: formatInteger(position) });
  }

  return (
    <div className="relative" style={{ height: fontSize + 2, width: length * charWidth }}>
      {ticks.map((tick) => (
        <span
          key={tick.offset}
          className="residues absolute text-muted-foreground select-none"
          style={{
            left: tick.offset * charWidth,
            fontSize,
            transform: 'translateX(-50%)',
          }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Per-base quality, as a small bar track under the residues.
 *
 * Bars rather than the raw ASCII quality string: the encoded characters are
 * unreadable, and the shape of the decline across a read is the thing worth
 * seeing. Colour uses the status palette because the value means good or bad.
 */
function QualityTrack({
  quality,
  offset,
  fontSize,
  charWidth,
}: {
  quality: string;
  offset: number;
  fontSize: number;
  charWidth: number;
}) {
  const height = Math.max(8, fontSize * 0.8);
  return (
    <div className="flex items-end">
      <span className="shrink-0 pr-3" style={{ width: 84 }} aria-hidden />
      <div className="flex items-end gap-0" style={{ height }} title="Per-base Phred quality">
        {[...quality].map((character, index) => {
          const score = Math.max(0, Math.min(45, character.charCodeAt(0) - offset));
          const fraction = score / 45;
          const color = score >= 28 ? '#0ca30c' : score >= 20 ? '#fab219' : '#d03b3b';
          return (
            <span
              key={index}
              style={{
                width: charWidth,
                height: Math.max(1, fraction * height),
                backgroundColor: color,
                opacity: 0.55,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Annotation overview track                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whole-sequence feature map.
 *
 * Gives the reader the shape of the sequence before they start scrolling: where
 * the ORFs are, how much of the sequence they cover, and whether they overlap.
 * Rows are packed greedily so overlapping features stack rather than occlude.
 */
export function AnnotationTrack({
  annotations,
  length,
  onSelect,
  className,
}: {
  annotations: Annotation[];
  length: number;
  onSelect?: (annotation: Annotation) => void;
  className?: string;
}) {
  const rows = useMemo(() => {
    const sorted = [...annotations].sort((a, b) => a.start - b.start);
    const packed: Annotation[][] = [];
    for (const annotation of sorted) {
      const row = packed.find(
        (candidate) => candidate[candidate.length - 1].end < annotation.start - length * 0.01,
      );
      if (row) row.push(annotation);
      else packed.push([annotation]);
    }
    return packed.slice(0, 6);
  }, [annotations, length]);

  if (length === 0) return null;

  return (
    <div className={cn('space-y-1 border-b border-border bg-subtle px-3 py-2', className)}>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          Features
        </span>
        <span className="tabular text-[10px] text-muted-foreground">
          1&ndash;{formatInteger(length)}
        </span>
      </div>
      {/* The sequence axis itself. */}
      <div className="relative h-px w-full bg-border" />
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="relative h-3 w-full">
          {row.map((annotation) => {
            const left = ((annotation.start - 1) / length) * 100;
            const width = Math.max(0.4, ((annotation.end - annotation.start + 1) / length) * 100);
            return (
              <button
                key={`${annotation.start}-${annotation.end}-${annotation.label}`}
                type="button"
                onClick={() => onSelect?.(annotation)}
                title={`${annotation.label} (${formatInteger(annotation.start)}–${formatInteger(annotation.end)})${annotation.detail ? ` — ${annotation.detail}` : ''}`}
                className="absolute top-0 h-3 rounded-sm transition-opacity hover:opacity-80"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: annotation.color,
                  opacity: 0.75,
                }}
                aria-label={`${annotation.label}, positions ${annotation.start} to ${annotation.end}`}
              />
            );
          })}
        </div>
      ))}
      {annotations.length > rows.flat().length ? (
        <p className="text-[10px] text-muted-foreground">
          Showing {formatInteger(rows.flat().length)} of {formatInteger(annotations.length)}{' '}
          features; the rest are in the table.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Legend                                                                     */
/* -------------------------------------------------------------------------- */

const washFor = (residue: string, isProtein: boolean): string | undefined => {
  if (isProtein) {
    const aminoClass = AMINO_CLASS[residue.toUpperCase()];
    return aminoClass ? AMINO_CLASS_WASH[aminoClass] : AMINO_CLASS_WASH.special;
  }
  return BASE_WASH[residue.toUpperCase()] ?? BASE_WASH.N;
};

function ResidueLegend({ isProtein, className }: { isProtein: boolean; className?: string }) {
  const items = isProtein
    ? [
        { label: 'Hydrophobic', color: AMINO_CLASS_WASH.hydrophobic },
        { label: 'Polar', color: AMINO_CLASS_WASH.polar },
        { label: 'Acidic', color: AMINO_CLASS_WASH.acidic },
        { label: 'Basic', color: AMINO_CLASS_WASH.basic },
        { label: 'Aromatic', color: AMINO_CLASS_WASH.aromatic },
        { label: 'Other', color: AMINO_CLASS_WASH.special },
      ]
    : [
        { label: 'A', color: BASE_WASH.A },
        { label: 'C', color: BASE_WASH.C },
        { label: 'G', color: BASE_WASH.G },
        { label: 'T / U', color: BASE_WASH.T },
        { label: 'Ambiguous', color: BASE_WASH.N },
      ];

  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span
            className="size-2.5 rounded-[2px] border border-border"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
