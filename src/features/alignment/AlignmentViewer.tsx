import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import {
  AMINO_CLASS,
  AMINO_CLASS_WASH,
  BASE_WASH,
  STATUS,
} from '@/components/charts/palette';
import { Switch, Label } from '@/components/ui/primitives';
import type { AlignmentColumn } from '@/types';
import { cn } from '@/utils/cn';
import { formatDecimal, formatInteger } from '@/utils/format';

export interface AlignmentViewerProps {
  rows: { id: string; index: number; aligned: string }[];
  consensus: string;
  columns: AlignmentColumn[];
  isProtein: boolean;
  /** Column conservation at or above this is drawn as conserved. */
  conservedThreshold: number;
  /** Row index used as the reference for difference highlighting. */
  referenceRow?: number;
  height?: number;
  className?: string;
}

const LABEL_WIDTH = 150;
const BLOCK_WIDTH = 60;

/**
 * Multiple alignment viewer.
 *
 * Alignments are laid out in blocks of 60 columns, the convention every
 * alignment tool uses, because a 6,000-column alignment cannot be read on one
 * line. Blocks are virtualised: only the blocks in view are mounted, so a
 * 60-sequence by 6,000-column alignment - 360,000 residues - renders as a few
 * thousand DOM nodes rather than all of them.
 *
 * The default colouring is difference-from-consensus rather than
 * residue-identity, because that is what an alignment is read for: a wall of
 * uniformly coloured residues hides exactly the columns worth seeing.
 */
export function AlignmentViewer({
  rows,
  consensus,
  columns,
  isProtein,
  conservedThreshold,
  referenceRow = 0,
  height = 460,
  className,
}: AlignmentViewerProps) {
  const [mode, setMode] = useState<'difference' | 'residue'>('difference');
  const [showConservation, setShowConservation] = useState(true);

  const alignmentLength = rows[0]?.aligned.length ?? 0;
  const blockCount = Math.max(1, Math.ceil(alignmentLength / BLOCK_WIDTH));
  const reference = rows[referenceRow]?.aligned ?? consensus;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: blockCount,
    getScrollElement: () => scrollRef.current,
    // Each block is: ruler + conservation track + one line per row + consensus.
    estimateSize: () => 26 + (showConservation ? 14 : 0) + (rows.length + 1) * 15 + 12,
    overscan: 3,
  });

  const maxConservation = useMemo(
    () => Math.max(...columns.map((column) => column.conservation), 1),
    [columns],
  );

  if (alignmentLength === 0) {
    return (
      <p className="py-8 text-center text-xs text-muted-foreground">
        The alignment is empty.
      </p>
    );
  }

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border bg-card', className)}>
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-subtle px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Switch
            id="alignment-mode"
            checked={mode === 'difference'}
            onCheckedChange={(checked) => setMode(checked ? 'difference' : 'residue')}
          />
          <Label htmlFor="alignment-mode" className="cursor-pointer text-[11px]">
            Highlight differences only
          </Label>
        </div>
        <div className="flex items-center gap-1.5">
          <Switch
            id="alignment-conservation"
            checked={showConservation}
            onCheckedChange={setShowConservation}
          />
          <Label htmlFor="alignment-conservation" className="cursor-pointer text-[11px]">
            Conservation track
          </Label>
        </div>
        <span className="tabular ml-auto text-[11px] text-muted-foreground">
          {formatInteger(rows.length)} sequences &times; {formatInteger(alignmentLength)} columns
        </span>
      </div>

      <div ref={scrollRef} className="overflow-auto" style={{ height }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const from = item.index * BLOCK_WIDTH;
            const to = Math.min(alignmentLength, from + BLOCK_WIDTH);
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full border-b border-border/70 px-3 py-2"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                {/* Column ruler */}
                <div className="flex">
                  <span className="shrink-0 pr-2" style={{ width: LABEL_WIDTH }} aria-hidden />
                  <span className="residues text-[9px] text-muted-foreground select-none">
                    {buildRuler(from, to)}
                  </span>
                </div>

                {showConservation ? (
                  <div className="flex items-end">
                    <span
                      className="shrink-0 pr-2 text-right text-[9px] text-muted-foreground select-none"
                      style={{ width: LABEL_WIDTH }}
                    >
                      conservation
                    </span>
                    <div className="flex h-3 items-end">
                      {columns.slice(from, to).map((column) => (
                        <span
                          key={column.position}
                          title={`Column ${column.position}: ${formatDecimal(column.conservation * 100, 0)}% conserved, ${formatDecimal(column.gapFraction * 100, 0)}% gaps`}
                          style={{
                            width: '1ch',
                            height: `${Math.max(1, (column.conservation / maxConservation) * 12)}px`,
                            backgroundColor:
                              column.conservation >= conservedThreshold
                                ? STATUS.pass
                                : column.conservation >= 0.5
                                  ? STATUS.warning
                                  : STATUS.review,
                            opacity: 0.55,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Sequence rows */}
                {rows.map((row, rowIndex) => (
                  <div key={row.index} className="flex items-baseline">
                    <span
                      className="shrink-0 truncate pr-2 text-right font-mono text-[10px] text-muted-foreground"
                      style={{ width: LABEL_WIDTH }}
                      title={row.id}
                    >
                      {rowIndex === referenceRow ? (
                        <span className="font-semibold text-foreground">{row.id}</span>
                      ) : (
                        row.id
                      )}
                    </span>
                    <span className="residues text-[11px]">
                      {[...row.aligned.slice(from, to)].map((residue, offset) => {
                        const column = from + offset;
                        const referenceResidue = reference[column];
                        const differs = residue !== referenceResidue;
                        const isGap = residue === '-';

                        let background: string | undefined;
                        if (mode === 'difference') {
                          if (isGap) background = '#f1f3f5';
                          else if (differs && rowIndex !== referenceRow) background = '#fde68a';
                        } else {
                          background = isGap
                            ? '#f1f3f5'
                            : isProtein
                              ? AMINO_CLASS_WASH[AMINO_CLASS[residue] ?? 'special']
                              : (BASE_WASH[residue] ?? BASE_WASH.N);
                        }

                        return (
                          <span
                            key={offset}
                            style={{ backgroundColor: background }}
                            className={isGap ? 'text-muted-foreground' : 'text-foreground'}
                          >
                            {residue}
                          </span>
                        );
                      })}
                    </span>
                    <span className="tabular pl-2 text-[9px] text-muted-foreground select-none">
                      {formatInteger(ungappedPosition(row.aligned, to))}
                    </span>
                  </div>
                ))}

                {/* Consensus */}
                <div className="mt-0.5 flex items-baseline border-t border-border pt-0.5">
                  <span
                    className="shrink-0 pr-2 text-right text-[10px] font-semibold text-foreground"
                    style={{ width: LABEL_WIDTH }}
                  >
                    consensus
                  </span>
                  <span className="residues text-[11px] font-semibold text-foreground">
                    {consensus.slice(from, to)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-subtle px-3 py-1.5">
        {mode === 'difference' ? (
          <>
            <LegendSwatch color="#fde68a" label="Differs from the reference row" />
            <LegendSwatch color="#f1f3f5" label="Gap" />
          </>
        ) : isProtein ? (
          <>
            <LegendSwatch color={AMINO_CLASS_WASH.hydrophobic} label="Hydrophobic" />
            <LegendSwatch color={AMINO_CLASS_WASH.polar} label="Polar" />
            <LegendSwatch color={AMINO_CLASS_WASH.acidic} label="Acidic" />
            <LegendSwatch color={AMINO_CLASS_WASH.basic} label="Basic" />
            <LegendSwatch color={AMINO_CLASS_WASH.aromatic} label="Aromatic" />
          </>
        ) : (
          <>
            <LegendSwatch color={BASE_WASH.A} label="A" />
            <LegendSwatch color={BASE_WASH.C} label="C" />
            <LegendSwatch color={BASE_WASH.G} label="G" />
            <LegendSwatch color={BASE_WASH.T} label="T / U" />
          </>
        )}
        {showConservation ? (
          <>
            <LegendSwatch
              color={STATUS.pass}
              label={`Conserved (at or above ${formatDecimal(conservedThreshold * 100, 0)}%)`}
            />
            <LegendSwatch color={STATUS.warning} label="50-90% conserved" />
            <LegendSwatch color={STATUS.review} label="Variable (below 50%)" />
          </>
        ) : null}
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <span
        className="size-2.5 rounded-[2px] border border-border"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

/**
 * Tick labels every ten columns, aligned to the residue grid.
 *
 * Each label is written right-aligned so its last digit sits directly over the
 * column it names, which is the only way a ruler above a monospace grid is
 * readable. Labels that would start before the block are clipped rather than
 * shifted, so no label ever points at the wrong column.
 */
function buildRuler(from: number, to: number): string {
  const width = to - from;
  const characters = new Array<string>(width).fill(' ');

  for (let column = from; column < to; column += 1) {
    const oneBased = column + 1;
    if (oneBased % 10 !== 0) continue;
    const label = String(oneBased);
    const end = column - from;
    for (let i = 0; i < label.length; i += 1) {
      const target = end - (label.length - 1) + i;
      if (target >= 0 && target < width) characters[target] = label[i];
    }
  }

  return characters.join('');
}

/** Ungapped position in the original sequence at an alignment column. */
function ungappedPosition(aligned: string, column: number): number {
  let count = 0;
  for (let i = 0; i < Math.min(column, aligned.length); i += 1) {
    if (aligned[i] !== '-' && aligned[i] !== '.') count += 1;
  }
  return count;
}
