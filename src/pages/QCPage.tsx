import { Copy, Download, Settings2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { METRIC_DOCS } from '@/bio/defaults';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { BASE_COLORS, SERIES, STATUS } from '@/components/charts/palette';
import {
  BarList,
  ChartLegend,
  Histogram,
  LineSeriesChart,
  QUALITY_BANDS,
  StackedAreaChart,
} from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import {
  Alert,
  Badge,
  MetricList,
  SectionHeading,
  StatusBadge,
  statusLabel,
} from '@/components/ui/display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { ThresholdPanel } from '@/features/qc/ThresholdPanel';
import type { QCResult, SequenceFlagKind } from '@/types';
import { MIME, copyToClipboard, recordsToCsv, saveFile, toJson } from '@/utils/export';
import {
  formatDecimal,
  formatInteger,
  formatPercent,
  slugify,
} from '@/utils/format';

const FLAG_LABELS: Record<SequenceFlagKind, string> = {
  'invalid-characters': 'Invalid characters',
  empty: 'Empty',
  'too-short': 'Extremely short',
  'too-long': 'Extremely long',
  ambiguous: 'High ambiguity',
  homopolymer: 'Homopolymer run',
  'low-complexity': 'Low complexity',
  duplicate: 'Duplicate',
};

/**
 * Quality control dashboard.
 *
 * FastQC-inspired in layout, but with two deliberate departures. Verdicts are
 * PASS / WARNING / REVIEW rather than PASS / WARN / FAIL, because SeqLens
 * cannot know whether a given deviation is a problem for a given experiment -
 * "review" asks the reader to look, where "fail" asserts a conclusion. And
 * every check states the threshold that produced its verdict, so the reader can
 * see which configured number drove the result rather than trusting the colour.
 */
export function QCPage() {
  return (
    <AnalysisGate<QCResult>
      kind="qc"
      title="Quality control"
      description="Dataset-level statistics and eleven per-sequence checks, computed from the compact index built at import plus one streaming pass over the residues. Thresholds are configurable and every verdict names the one that produced it."
      configPanel={<ThresholdPanel />}
      actions={<ExportActions />}
    >
      {(result, dataset) => (
        <QCResults result={result} isProtein={dataset.sequenceType === 'protein'} fileName={dataset.fileName} />
      )}
    </AnalysisGate>
  );
}

function ExportActions() {
  return (
    <Button size="sm" variant="outline" asChild>
      <Link to="/reports">
        <Download />
        Export report
      </Link>
    </Button>
  );
}

function QCResults({
  result,
  isProtein,
  fileName,
}: {
  result: QCResult;
  isProtein: boolean;
  fileName: string;
}) {
  const [copiedSummary, setCopiedSummary] = useState(false);

  const severityOrder = useMemo(() => {
    const rank = { review: 0, warning: 1, pass: 2, 'not-applicable': 3 } as const;
    return [...result.checks].sort((a, b) => rank[a.status] - rank[b.status]);
  }, [result.checks]);

  const lengthBins = useMemo(
    () =>
      result.lengthHistogram.map((bin) => ({
        label: formatInteger(bin.from),
        from: bin.from,
        to: bin.to,
        count: bin.count,
      })),
    [result.lengthHistogram],
  );

  const copySummary = async () => {
    const lines = [
      `SeqLens QC summary - ${fileName}`,
      `Overall: ${statusLabel(result.overallStatus).toUpperCase()}`,
      '',
      ...result.checks.map(
        (check) => `${statusLabel(check.status).toUpperCase().padEnd(8)} ${check.label}: ${check.value}`,
      ),
    ];
    const ok = await copyToClipboard(lines.join('\n'));
    if (ok) {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 1600);
    }
  };

  return (
    <div className="space-y-5">
      {/* Overall verdict and headline statistics */}
      <Card>
        <CardHeaderRow
          title={
            <span className="flex items-center gap-2">
              Overall verdict
              <StatusBadge status={result.overallStatus} />
            </span>
          }
          description={`The most severe of ${result.checks.length} checks. "Review" means a number is far from the configured expectation, not that the data is unusable.`}
          actions={
            <Button size="sm" variant="outline" onClick={() => void copySummary()}>
              <Copy />
              {copiedSummary ? 'Copied' : 'Copy summary'}
            </Button>
          }
        />
        <div className="grid gap-x-6 gap-y-0 px-4 pb-4 lg:grid-cols-2">
          <MetricList
            rows={[
              { label: 'Sequences', value: formatInteger(result.stats.sequenceCount) },
              {
                label: isProtein ? 'Total residues' : 'Total bases',
                value: formatInteger(result.stats.totalResidues),
              },
              {
                label: 'Length range',
                value: `${formatInteger(result.stats.minLength)} – ${formatInteger(result.stats.maxLength)}`,
              },
              { label: 'Mean length', value: formatDecimal(result.stats.meanLength, 1) },
              { label: 'Median length', value: formatInteger(result.stats.medianLength) },
              {
                label: 'Unique sequences',
                value: formatPercent(result.stats.uniquePercent, 2),
                hint: METRIC_DOCS.duplicates.what,
              },
            ]}
          />
          <MetricList
            rows={[
              { label: 'N50', value: formatInteger(result.stats.n50), hint: METRIC_DOCS.n50.what },
              { label: 'N90', value: formatInteger(result.stats.n90), hint: METRIC_DOCS.n90.what },
              { label: 'L50', value: formatInteger(result.stats.l50), hint: METRIC_DOCS.l50.what },
              ...(isProtein
                ? []
                : [
                    {
                      label: 'GC content',
                      value: formatPercent(result.stats.gcPercent, 2),
                      hint: METRIC_DOCS.gc.what,
                    },
                  ]),
              {
                label: 'Ambiguous residues',
                value: formatPercent(result.stats.ambiguousPercent, 3),
                hint: METRIC_DOCS.ambiguous.what,
              },
              {
                label: 'Mean read quality',
                value:
                  result.stats.meanQuality === null
                    ? 'N/A (FASTA)'
                    : `Q${formatDecimal(result.stats.meanQuality, 1)}`,
              },
            ]}
          />
        </div>
      </Card>

      {/* Quality summary cards */}
      <div className="space-y-2">
        <SectionHeading
          title="Checks"
          description="Each card shows the measurement, what it means, and the configured threshold that produced its verdict. Cards are ordered most severe first."
        />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {severityOrder.map((check) => (
            <Card key={check.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2 px-3.5 pt-3 pb-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{check.label}</p>
                  <p className="tabular mt-0.5 text-sm font-semibold text-foreground">
                    {check.value}
                  </p>
                </div>
                <StatusBadge status={check.status} />
              </div>
              <div className="flex-1 space-y-1.5 px-3.5 pb-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {check.explanation}
                </p>
                <p className="border-t border-border pt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Threshold:</span>{' '}
                  {check.thresholdNote}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <AnalysisNotes notes={result.notes} />

      {/* Distributions */}
      <Tabs defaultValue="distributions">
        <TabsList>
          <TabsTrigger value="distributions">Distributions</TabsTrigger>
          <TabsTrigger value="composition">Composition</TabsTrigger>
          {result.perPositionQuality.length > 0 ? (
            <TabsTrigger value="quality">Quality</TabsTrigger>
          ) : null}
          <TabsTrigger value="duplicates">Duplicates</TabsTrigger>
          <TabsTrigger value="flagged">Flagged sequences</TabsTrigger>
        </TabsList>

        <TabsContent value="distributions" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title="Sequence length distribution"
              description="Counts of sequences by length."
              data={lengthBins}
              columns={[
                { key: 'from', header: 'From', numeric: true },
                { key: 'to', header: 'To (exclusive)', numeric: true },
                { key: 'count', header: 'Sequences', numeric: true },
              ]}
              exportName={`${fileName}-length-distribution`}
            >
              <Histogram
                data={lengthBins}
                xKey="label"
                yKey="count"
                xLabel={isProtein ? 'Residues' : 'Length (bp)'}
                yLabel="Sequences"
                yTickFormatter={formatInteger}
                tooltipLabel={(row) =>
                  `${formatInteger(Number(row.from))} – ${formatInteger(Number(row.to) - 1)}`
                }
                tooltipValue={(row) => `${formatInteger(Number(row.count))} sequences`}
              />
            </ChartFrame>

            {isProtein ? null : (
              <ChartFrame
                title="GC content distribution"
                description="Per-sequence GC percentage, binned to whole percentage points."
                help={`${METRIC_DOCS.gc.what} ${METRIC_DOCS.gc.caveat}`}
                data={result.gcHistogram as unknown as Record<string, unknown>[]}
                columns={[
                  { key: 'gc', header: 'GC %', numeric: true },
                  { key: 'count', header: 'Sequences', numeric: true },
                ]}
                exportName={`${fileName}-gc-distribution`}
                footnote="A single mode is expected for one organism. Two clear modes in a read set usually indicate contamination or a mixed library."
              >
                <Histogram
                  data={result.gcHistogram as unknown as Record<string, unknown>[]}
                  xKey="gc"
                  yKey="count"
                  xLabel="GC content (%)"
                  yLabel="Sequences"
                  yTickFormatter={formatInteger}
                  tooltipLabel={(row) => `GC ${row.gc}%`}
                  tooltipValue={(row) => `${formatInteger(Number(row.count))} sequences`}
                />
              </ChartFrame>
            )}

            <ChartFrame
              title="Ambiguous-residue distribution"
              description="How many sequences fall into each ambiguity band."
              help={`${METRIC_DOCS.ambiguous.what} ${METRIC_DOCS.ambiguous.caveat}`}
              data={result.ambiguousHistogram as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'bucket', header: 'Ambiguous fraction' },
                { key: 'count', header: 'Sequences', numeric: true },
              ]}
              exportName={`${fileName}-ambiguity-distribution`}
            >
              <Histogram
                data={result.ambiguousHistogram as unknown as Record<string, unknown>[]}
                xKey="bucket"
                yKey="count"
                xLabel="Ambiguous residues per sequence"
                yLabel="Sequences"
                yTickFormatter={formatInteger}
                tooltipValue={(row) => `${formatInteger(Number(row.count))} sequences`}
              />
            </ChartFrame>

            <ChartFrame
              title="Most frequent exact lengths"
              description="The twelve lengths that occur most often, which reveals fixed-length read sets and length-filtered datasets."
              data={result.topLengths as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'length', header: 'Length', numeric: true },
                { key: 'count', header: 'Sequences', numeric: true },
              ]}
              exportName={`${fileName}-top-lengths`}
            >
              <BarList
                items={result.topLengths.map((entry) => ({
                  label: `${formatInteger(entry.length)} ${isProtein ? 'aa' : 'bp'}`,
                  value: entry.count,
                  secondary: formatPercent((entry.count / result.stats.sequenceCount) * 100, 1),
                }))}
                valueFormatter={formatInteger}
                maxItems={12}
              />
            </ChartFrame>
          </div>
        </TabsContent>

        <TabsContent value="composition" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title={isProtein ? 'Residue composition' : 'Nucleotide composition'}
              description="Total counts across every residue in the dataset."
              data={result.nucleotideComposition as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'residue', header: 'Residue' },
                { key: 'count', header: 'Count', numeric: true },
                {
                  key: 'percent',
                  header: 'Percent',
                  numeric: true,
                  format: (value) => formatPercent(Number(value), 3),
                },
              ]}
              exportName={`${fileName}-residue-composition`}
            >
              <BarList
                items={result.nucleotideComposition.map((entry) => ({
                  label: entry.residue,
                  value: entry.count,
                  secondary: formatPercent(entry.percent, 2),
                }))}
                valueFormatter={formatInteger}
                maxItems={26}
              />
            </ChartFrame>

            {result.positionalComposition.length > 0 ? (
              <ChartFrame
                title="Per-position base composition"
                description="Composition at each position along the sequence, as a percentage of the sequences covering that position."
                data={result.positionalComposition as unknown as Record<string, unknown>[]}
                columns={[
                  { key: 'position', header: 'Position', numeric: true },
                  { key: 'A', header: 'A %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                  { key: 'C', header: 'C %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                  { key: 'G', header: 'G %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                  { key: 'T', header: 'T %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                  { key: 'N', header: 'Other %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                ]}
                exportName={`${fileName}-positional-composition`}
                footnote="Positions are capped at 500. Beyond that the coverage falls to the few longest sequences and the percentages stop being representative. A strong positional bias in the first 10-15 bases of a read set is the normal signature of random-priming, not an error."
              >
                <>
                  <StackedAreaChart
                    data={result.positionalComposition as unknown as Record<string, unknown>[]}
                    xKey="position"
                    xLabel="Position"
                    yLabel="Composition (%)"
                    yTickFormatter={(value) => `${value}`}
                    valueFormatter={(value) =>
                      typeof value === 'number' ? `${formatDecimal(value, 2)}%` : String(value ?? '')
                    }
                    series={[
                      { key: 'A', label: 'A', color: BASE_COLORS.A },
                      { key: 'C', label: 'C', color: BASE_COLORS.C },
                      { key: 'G', label: 'G', color: BASE_COLORS.G },
                      { key: 'T', label: isProtein ? 'T' : 'T / U', color: BASE_COLORS.T },
                      { key: 'N', label: 'Other', color: BASE_COLORS.N },
                    ]}
                  />
                  <ChartLegend
                    items={[
                      { label: 'A', color: BASE_COLORS.A },
                      { label: 'C', color: BASE_COLORS.C },
                      { label: 'G', color: BASE_COLORS.G },
                      { label: isProtein ? 'T' : 'T / U', color: BASE_COLORS.T },
                      { label: 'Other', color: BASE_COLORS.N },
                    ]}
                  />
                </>
              </ChartFrame>
            ) : null}
          </div>
        </TabsContent>

        {result.perPositionQuality.length > 0 ? (
          <TabsContent value="quality" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartFrame
                title="Per-position quality"
                description="Mean Phred score at each position along the read."
                help={`${METRIC_DOCS.perBaseQuality.what} ${METRIC_DOCS.perBaseQuality.caveat}`}
                data={result.perPositionQuality as unknown as Record<string, unknown>[]}
                columns={[
                  { key: 'position', header: 'Position', numeric: true },
                  { key: 'mean', header: 'Mean Phred', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                  { key: 'coverage', header: 'Reads covering', numeric: true },
                ]}
                exportName={`${fileName}-per-position-quality`}
                footnote="Bands mark Q28 and above, Q20 to Q28, and below Q20. A decline toward the 3′ end is normal for every current sequencing chemistry."
              >
                <>
                  <LineSeriesChart
                    data={result.perPositionQuality as unknown as Record<string, unknown>[]}
                    xKey="position"
                    xLabel="Position in read"
                    yLabel="Mean Phred score"
                    yDomain={[0, 45]}
                    bands={QUALITY_BANDS}
                    valueFormatter={(value) =>
                      typeof value === 'number' ? `Q${formatDecimal(value, 1)}` : String(value ?? '')
                    }
                    series={[{ key: 'mean', label: 'Mean Phred', color: SERIES[0] }]}
                  />
                  <ChartLegend
                    items={[
                      { label: 'Q28 and above', color: STATUS.pass },
                      { label: 'Q20 to Q28', color: STATUS.warning },
                      { label: 'Below Q20', color: STATUS.review },
                    ]}
                  />
                </>
              </ChartFrame>

              <ChartFrame
                title="Per-read mean quality"
                description="Distribution of the mean Phred score of each read."
                data={result.readQualityHistogram as unknown as Record<string, unknown>[]}
                columns={[
                  { key: 'score', header: 'Mean Phred', numeric: true },
                  { key: 'count', header: 'Reads', numeric: true },
                ]}
                exportName={`${fileName}-read-quality-distribution`}
                footnote="A distinct low-quality subpopulation here, rather than a single mode, usually means a subset of clusters or pores failed rather than a uniform quality problem."
              >
                <Histogram
                  data={result.readQualityHistogram as unknown as Record<string, unknown>[]}
                  xKey="score"
                  yKey="count"
                  xLabel="Mean Phred score"
                  yLabel="Reads"
                  yTickFormatter={formatInteger}
                  tooltipLabel={(row) => `Q${row.score}`}
                  tooltipValue={(row) => `${formatInteger(Number(row.count))} reads`}
                />
              </ChartFrame>
            </div>
          </TabsContent>
        ) : null}

        <TabsContent value="duplicates" className="space-y-4">
          <StatGrid columns={4}>
            <StatTile
              label="Duplicate sequences"
              value={formatInteger(result.stats.duplicateSequences)}
              detail={`${formatPercent((result.stats.duplicateSequences / Math.max(1, result.stats.sequenceCount)) * 100, 2)} of the dataset`}
            />
            <StatTile
              label="Duplicate groups"
              value={formatInteger(result.stats.duplicateGroups)}
              detail="Distinct sequences with more than one copy"
            />
            <StatTile
              label="Unique"
              value={formatPercent(result.stats.uniquePercent, 2)}
              detail="Counting the first occurrence of each group as unique"
            />
            <StatTile
              label="Largest group"
              value={formatInteger(result.duplicateGroups[0]?.count ?? 0)}
              detail={
                result.duplicateGroups[0]
                  ? `${formatInteger(result.duplicateGroups[0].length)} residues`
                  : 'No duplicates found'
              }
            />
          </StatGrid>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title="Duplicate group sizes"
              description="How many groups exist at each copy count."
              data={result.duplicateHistogram as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'copies', header: 'Copies', numeric: true },
                { key: 'groups', header: 'Groups', numeric: true },
                { key: 'sequences', header: 'Sequences', numeric: true },
              ]}
              exportName={`${fileName}-duplicate-distribution`}
            >
              <Histogram
                data={result.duplicateHistogram as unknown as Record<string, unknown>[]}
                xKey="copies"
                yKey="groups"
                xLabel="Copies per group"
                yLabel="Groups"
                yTickFormatter={formatInteger}
                tooltipLabel={(row) => `${row.copies} copies`}
                tooltipValue={(row) =>
                  `${formatInteger(Number(row.groups))} groups, ${formatInteger(Number(row.sequences))} sequences`
                }
              />
            </ChartFrame>

            <Card>
              <CardHeaderRow
                title="Largest duplicate groups"
                description="Verified by comparing residues, so these are exact matches rather than hash collisions."
              />
              <div className="max-h-72 overflow-y-auto border-t border-border">
                {result.duplicateGroups.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No exact duplicates were found.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {result.duplicateGroups.slice(0, 40).map((group) => (
                      <li key={group.hash} className="space-y-1 px-4 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="default">{formatInteger(group.count)} copies</Badge>
                          <span className="tabular text-[11px] text-muted-foreground">
                            {formatInteger(group.length)} residues
                          </span>
                        </div>
                        <p className="font-mono text-[10px] leading-relaxed break-all text-muted-foreground">
                          {group.ids.join(', ')}
                          {group.count > group.ids.length
                            ? ` and ${formatInteger(group.count - group.ids.length)} more`
                            : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="flagged" className="space-y-4">
          <StatGrid columns={4}>
            {(Object.entries(result.flagCounts) as [SequenceFlagKind, number][])
              .filter(([, count]) => count > 0)
              .sort((a, b) => b[1] - a[1])
              .map(([flag, count]) => (
                <StatTile
                  key={flag}
                  label={FLAG_LABELS[flag]}
                  value={formatInteger(count)}
                  detail={formatPercent((count / Math.max(1, result.stats.sequenceCount)) * 100, 2)}
                />
              ))}
          </StatGrid>

          <Card>
            <CardHeaderRow
              title="Flagged sequences"
              description={`Up to 500 sequences that triggered at least one check, ordered by how many they triggered. Open the sequence explorer to inspect any of them.`}
              actions={
                <>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/explorer">Open explorer</Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void saveFile(
                        recordsToCsv(
                          result.flaggedSequences.map((flag) => ({
                            index: flag.index + 1,
                            id: flag.id,
                            length: flag.length,
                            flags: flag.flags.map((f) => FLAG_LABELS[f]).join('; '),
                            longestRun: flag.longestRun ?? '',
                            runResidue: flag.runResidue ?? '',
                            entropy: flag.entropy === undefined ? '' : flag.entropy.toFixed(4),
                            ambiguousFraction:
                              flag.ambiguousFraction === undefined
                                ? ''
                                : flag.ambiguousFraction.toFixed(4),
                            invalidCharacters: flag.invalidCharacters?.join('') ?? '',
                          })),
                        ),
                        {
                          suggestedName: `${slugify(fileName)}-flagged-sequences.csv`,
                          mimeType: MIME.csv,
                          description: 'CSV table',
                          extensions: ['.csv'],
                        },
                      )
                    }
                  >
                    <Download />
                    CSV
                  </Button>
                </>
              }
            />
            <div className="max-h-96 overflow-auto border-t border-border">
              {result.flaggedSequences.length === 0 ? (
                <Alert variant="success" className="m-4" title="No sequences were flagged">
                  Every sequence passed all per-sequence checks at the current thresholds.
                </Alert>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className="px-4 py-1.5 text-right font-medium">#</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Identifier</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Length</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Flags</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.flaggedSequences.map((flag) => (
                      <tr key={flag.index} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                        <td className="tabular px-4 py-1 text-right text-muted-foreground">
                          {formatInteger(flag.index + 1)}
                        </td>
                        <td className="px-3 py-1 font-mono text-foreground">{flag.id}</td>
                        <td className="tabular px-3 py-1 text-right">{formatInteger(flag.length)}</td>
                        <td className="px-3 py-1">
                          <span className="flex flex-wrap gap-1">
                            {flag.flags.map((kind) => (
                              <Badge
                                key={kind}
                                variant={
                                  kind === 'empty' || kind === 'invalid-characters'
                                    ? 'review'
                                    : 'warning'
                                }
                                size="sm"
                              >
                                {FLAG_LABELS[kind]}
                              </Badge>
                            ))}
                          </span>
                        </td>
                        <td className="px-3 py-1 text-[11px] text-muted-foreground">
                          {[
                            flag.longestRun
                              ? `${flag.runResidue}×${flag.longestRun}`
                              : null,
                            flag.entropy !== undefined
                              ? `${formatDecimal(flag.entropy, 2)} bits`
                              : null,
                            flag.ambiguousFraction !== undefined
                              ? `${formatPercent(flag.ambiguousFraction * 100, 1)} ambiguous`
                              : null,
                            flag.invalidCharacters?.length
                              ? `invalid: ${flag.invalidCharacters.join('')}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void saveFile(toJson(result), {
              suggestedName: `${slugify(fileName)}-qc.json`,
              mimeType: MIME.json,
              description: 'JSON result',
              extensions: ['.json'],
            })
          }
        >
          <Download />
          Export full QC result (JSON)
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to="/settings#qc">
            <Settings2 />
            Adjust thresholds
          </Link>
        </Button>
      </div>
    </div>
  );
}
