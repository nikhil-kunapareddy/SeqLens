import { useMemo } from 'react';
import { SERIES } from '@/components/charts/palette';
import { CHROME } from '@/components/charts/palette';
import { cn } from '@/utils/cn';
import { formatInteger } from '@/utils/format';
import type { Orf } from '@/types';

/**
 * Six-frame ORF map.
 *
 * One lane per reading frame, with the sequence axis running left to right and
 * each ORF drawn as a bar with a directional point at its 3' end. This is the
 * layout the request asked for, and the reason it is worth the space is that
 * frame membership is the thing you cannot see in a table: a real gene shows one
 * long ORF in one frame while the other five are peppered with short ones.
 *
 * Coordinates are forward-strand for every frame, so a minus-strand ORF sits
 * under the region of the sequence it actually covers rather than being mirrored.
 */
export function OrfMap({
  orfs,
  sequenceLength,
  width = 760,
  onSelect,
  selectedOrf,
  className,
}: {
  orfs: Orf[];
  sequenceLength: number;
  width?: number;
  onSelect?: (orf: Orf) => void;
  selectedOrf?: Orf | null;
  className?: string;
}) {
  const lanes = useMemo(() => {
    const byFrame = new Map<string, Orf[]>();
    for (const strand of ['+', '-'] as const) {
      for (const frame of [1, 2, 3] as const) {
        byFrame.set(`${strand}${frame}`, []);
      }
    }
    for (const orf of orfs) {
      byFrame.get(`${orf.strand}${orf.frame}`)?.push(orf);
    }
    return [...byFrame.entries()];
  }, [orfs]);

  if (sequenceLength === 0) return null;

  const labelWidth = 34;
  const plotWidth = Math.max(80, width - labelWidth - 8);
  const laneHeight = 18;
  const laneGap = 3;
  const axisHeight = 22;
  const height = axisHeight + lanes.length * (laneHeight + laneGap) + 8;

  const xFor = (position: number) => ((position - 1) / sequenceLength) * plotWidth;

  // Ticks at a round interval that yields five or six labels.
  const tickStep = niceStep(sequenceLength / 5);
  const ticks: number[] = [];
  for (let position = 0; position <= sequenceLength; position += tickStep) {
    ticks.push(position);
  }

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Open reading frame map across six frames of a ${sequenceLength} base sequence, showing ${orfs.length} ORFs. Coordinates are listed in the table beneath.`}
      >
        {/* Sequence axis */}
        <g transform={`translate(${labelWidth}, 0)`}>
          <line x1={0} y1={axisHeight - 6} x2={plotWidth} y2={axisHeight - 6} stroke={CHROME.axis} strokeWidth={1} />
          {ticks.map((position) => (
            <g key={position}>
              <line
                x1={xFor(position + 1)}
                y1={axisHeight - 10}
                x2={xFor(position + 1)}
                y2={axisHeight - 6}
                stroke={CHROME.axis}
                strokeWidth={1}
              />
              <text
                x={xFor(position + 1)}
                y={axisHeight - 13}
                textAnchor="middle"
                fontSize={9}
                fill={CHROME.muted}
              >
                {formatInteger(position)}
              </text>
            </g>
          ))}
        </g>

        {lanes.map(([frameKey, frameOrfs], laneIndex) => {
          const y = axisHeight + laneIndex * (laneHeight + laneGap);
          const isReverse = frameKey.startsWith('-');
          return (
            <g key={frameKey}>
              <text
                x={labelWidth - 6}
                y={y + laneHeight / 2 + 3}
                textAnchor="end"
                fontSize={9.5}
                fill={CHROME.inkSecondary}
                fontFamily="ui-monospace, monospace"
              >
                {frameKey}
              </text>

              <g transform={`translate(${labelWidth}, 0)`}>
                {/* Lane baseline */}
                <line
                  x1={0}
                  y1={y + laneHeight / 2}
                  x2={plotWidth}
                  y2={y + laneHeight / 2}
                  stroke={CHROME.grid}
                  strokeWidth={1}
                />

                {frameOrfs.map((orf) => {
                  const x1 = xFor(orf.start);
                  const x2 = xFor(orf.end + 1);
                  const barWidth = Math.max(2, x2 - x1);
                  const selected =
                    selectedOrf !== null &&
                    selectedOrf !== undefined &&
                    selectedOrf.start === orf.start &&
                    selectedOrf.end === orf.end &&
                    selectedOrf.strand === orf.strand;
                  const color = isReverse ? SERIES[1] : SERIES[0];
                  const point = Math.min(6, barWidth * 0.3);

                  // Arrow pointing in the direction of translation: right for
                  // the plus strand, left for the minus strand.
                  const path = isReverse
                    ? `M ${x1 + point} ${y + 3} L ${x1 + barWidth} ${y + 3} L ${x1 + barWidth} ${y + laneHeight - 3} L ${x1 + point} ${y + laneHeight - 3} L ${x1} ${y + laneHeight / 2} Z`
                    : `M ${x1} ${y + 3} L ${x1 + barWidth - point} ${y + 3} L ${x1 + barWidth} ${y + laneHeight / 2} L ${x1 + barWidth - point} ${y + laneHeight - 3} L ${x1} ${y + laneHeight - 3} Z`;

                  return (
                    <g
                      key={`${orf.start}-${orf.end}-${orf.strand}-${orf.frame}`}
                      className={onSelect ? 'cursor-pointer' : undefined}
                      onClick={() => onSelect?.(orf)}
                    >
                      <title>
                        {`${orf.strand}${orf.frame} ${formatInteger(orf.start)}-${formatInteger(orf.end)} (${formatInteger(orf.aminoAcidLength)} aa, ${orf.startCodon}${orf.stopCodon ? ` to ${orf.stopCodon}` : ', partial'})`}
                      </title>
                      <path
                        d={path}
                        fill={color}
                        fillOpacity={selected ? 1 : 0.72}
                        stroke={selected ? CHROME.ink : CHROME.surface}
                        strokeWidth={selected ? 1.5 : 1}
                      />
                      {/* Label inside the bar only when it fits with padding. */}
                      {barWidth > 54 ? (
                        <text
                          x={x1 + barWidth / 2}
                          y={y + laneHeight / 2 + 3}
                          textAnchor="middle"
                          fontSize={8.5}
                          fill="#ffffff"
                          fontFamily="ui-monospace, monospace"
                          pointerEvents="none"
                        >
                          {formatInteger(orf.aminoAcidLength)} aa
                        </text>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </g>
          );
        })}
      </svg>

      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1">
        <li className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <svg width="16" height="9" viewBox="0 0 16 9" aria-hidden>
            <path d="M0 0 L11 0 L16 4.5 L11 9 L0 9 Z" fill={SERIES[0]} fillOpacity={0.72} />
          </svg>
          Forward strand
        </li>
        <li className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <svg width="16" height="9" viewBox="0 0 16 9" aria-hidden>
            <path d="M5 0 L16 0 L16 9 L5 9 L0 4.5 Z" fill={SERIES[1]} fillOpacity={0.72} />
          </svg>
          Reverse strand
        </li>
        <li className="text-[11px] text-muted-foreground">
          The point marks the 3&prime; end. Coordinates are on the forward strand for both strands.
        </li>
      </ul>
    </div>
  );
}

/** Rounds a tick interval up to 1, 2, or 5 times a power of ten. */
function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return Math.max(1, step * magnitude);
}
