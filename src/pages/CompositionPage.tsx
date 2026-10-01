import { Download, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { METRIC_DOCS } from '@/bio/defaults';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { BASE_COLORS, SERIES, divergingColor } from '@/components/charts/palette';
import {
  BarList,
  ChartLegend,
  Histogram,
  StackedAreaChart,
} from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import { Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { KmerConfigPanel } from '@/features/composition/KmerConfigPanel';
import type { CompositionResult, KmerSpectrum } from '@/types';
import { useDebouncedValue } from '@/utils/debounce';
import { MIME, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, pluralize, slugify } from '@/utils/format';

/**
 * Composition and k-mer analysis.
 *
 * Nucleotide and protein datasets show different panels, because almost nothing
 * transfers between them: GC skew is meaningless for a protein and an
 * isoelectric point is meaningless for DNA. The page reads the dataset's
 * detected molecule type and shows only what applies.
 */
export function CompositionPage() {
  return (
    <AnalysisGate<CompositionResult>
      kind="composition"
      title="Composition"
      description="Residue composition, strand skew, CpG statistics, entropy, positional composition, and exact k-mer spectra. Every metric comes from one streaming pass over the dataset, so requesting four k values costs one read rather than four."
      configPanel={<KmerConfigPanel />}
    >
      {(result, dataset) => <CompositionResults result={result} fileName={dataset.fileName} />}
    </AnalysisGate>
  );
}

function CompositionResults({
  result,
  fileName,
}: {
  result: CompositionResult;
  fileName: string;
}) {
  const isProtein = result.sequenceType === 'protein';

  return (
    <div className="space-y-5">
      {isProtein ? (
        <ProteinSummary result={result} />
      ) : (
        <NucleotideSummary result={result} />
      )}

      <AnalysisNotes notes={result.notes} />

      <Tabs defaultValue="residues">
        <TabsList>
          <TabsTrigger value="residues">Residues</TabsTrigger>
          <TabsTrigger value="positional">Positional</TabsTrigger>
          <TabsTrigger value="kmers">k-mer spectra</TabsTrigger>
          {isProtein ? <TabsTrigger value="properties">Protein properties</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="residues" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title={isProtein ? 'Amino acid composition' : 'Nucleotide composition'}
              description={`Total counts over ${formatInteger(result.sequencesAnalyzed)} sequences.`}
              data={result.residueComposition as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'residue', header: 'Residue' },
                { key: 'count', header: 'Count', numeric: true },
                {
                  key: 'percent',
                  header: 'Percent',
                  numeric: true,
                  format: (value) => formatDecimal(Number(value), 4),
                },
              ]}
              exportName={`${fileName}-residue-composition`}
              height={isProtein ? 420 : 240}
            >
              <BarList
                items={result.residueComposition.map((entry) => ({
                  label: entry.residue,
                  value: entry.count,
                  secondary: formatPercent(entry.percent, 2),
                }))}
                valueFormatter={formatInteger}
                maxItems={30}
                color={
                  isProtein ? SERIES[0] : (BASE_COLORS[result.residueComposition[0]?.residue] ?? SERIES[0])
                }
              />
            </ChartFrame>

            {isProtein && result.protein ? (
              <ChartFrame
                title="Net charge at pH 7"
                description="Distribution of per-sequence net charge, from the Henderson-Hasselbalch curve."
                help={`${METRIC_DOCS.isoelectricPoint.what} ${METRIC_DOCS.isoelectricPoint.caveat}`}
                data={result.protein.chargeDistribution as unknown as Record<string, unknown>[]}
                columns={[
                  { key: 'bucket', header: 'Net charge' },
                  { key: 'count', header: 'Sequences', numeric: true },
                ]}
                exportName={`${fileName}-charge-distribution`}
              >
                <Histogram
                  data={result.protein.chargeDistribution as unknown as Record<string, unknown>[]}
                  xKey="bucket"
                  yKey="count"
                  xLabel="Net charge at pH 7"
                  yLabel="Sequences"
                  yTickFormatter={formatInteger}
                  tooltipValue={(row) => `${formatInteger(Number(row.count))} sequences`}
                />
              </ChartFrame>
            ) : (
              <Card>
                <CardHeaderRow
                  title="Strand and dinucleotide statistics"
                  description="Skew and CpG measures, which describe strand asymmetry and methylation-driven depletion respectively."
                />
                <div className="px-4 pb-4">
                  {result.nucleotide ? (
                    <MetricList
                      rows={[
                        {
                          label: 'GC skew (G−C)/(G+C)',
                          value: (
                            <span
                              style={{ color: divergingColor(result.nucleotide.gcSkew) }}
                              className="font-medium"
                            >
                              {formatDecimal(result.nucleotide.gcSkew, 4)}
                            </span>
                          ),
                          hint: 'Flips sign at the replication origin in most bacterial chromosomes; averages to zero for reads from both strands.',
                        },
                        {
                          label: 'AT skew (A−T)/(A+T)',
                          value: (
                            <span
                              style={{ color: divergingColor(result.nucleotide.atSkew) }}
                              className="font-medium"
                            >
                              {formatDecimal(result.nucleotide.atSkew, 4)}
                            </span>
                          ),
                        },
                        {
                          label: 'CpG dinucleotides',
                          value: formatInteger(result.nucleotide.cpgCount),
                        },
                        {
                          label: 'CpG observed / expected',
                          value: formatDecimal(result.nucleotide.cpgObservedExpected, 3),
                          hint: 'Vertebrate genomes show a marked deficit near 0.2; CpG islands rise above 0.6. Bacteria and plants have no such deficit.',
                        },
                        {
                          label: 'Entropy',
                          value: `${formatDecimal(result.nucleotide.entropyBitsPerBase, 4)} bits/base`,
                          hint: `${METRIC_DOCS.entropy.what} Maximum is 2 bits for four equally frequent bases.`,
                        },
                        {
                          label: 'Ambiguous residues',
                          value: formatPercent(result.nucleotide.ambiguousPercent, 3),
                        },
                      ]}
                    />
                  ) : null}
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="positional" className="space-y-4">
          {result.positionalComposition.length === 0 ? (
            <Alert variant="info" title="No positional profile is available">
              Positional composition needs at least one sequence long enough to cover the tracked
              positions.
            </Alert>
          ) : (
            <ChartFrame
              title="Per-position composition"
              description="Residue composition at each position, as a percentage of the sequences covering that position."
              data={result.positionalComposition as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'position', header: 'Position', numeric: true },
                { key: 'A', header: 'A %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                { key: 'C', header: 'C %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                { key: 'G', header: 'G %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                { key: 'T', header: 'T %', numeric: true, format: (v) => formatDecimal(Number(v), 2) },
                {
                  key: isProtein ? 'other' : 'N',
                  header: 'Other %',
                  numeric: true,
                  format: (v) => formatDecimal(Number(v), 2),
                },
              ]}
              exportName={`${fileName}-positional-composition`}
              height={300}
              footnote={
                isProtein
                  ? 'For protein datasets these five rows group residues by the first letter of the nucleotide alphabet and are not biologically meaningful; the amino acid composition table above is the correct view.'
                  : 'Capped at 500 positions. A pronounced bias across the first 10-15 bases of a read set is the normal signature of random-priming rather than a defect.'
              }
            >
              <>
                <StackedAreaChart
                  data={result.positionalComposition as unknown as Record<string, unknown>[]}
                  xKey="position"
                  xLabel="Position"
                  yLabel="Composition (%)"
                  valueFormatter={(value) =>
                    typeof value === 'number' ? `${formatDecimal(value, 2)}%` : String(value ?? '')
                  }
                  series={[
                    { key: 'A', label: 'A', color: BASE_COLORS.A },
                    { key: 'C', label: 'C', color: BASE_COLORS.C },
                    { key: 'G', label: 'G', color: BASE_COLORS.G },
                    { key: 'T', label: 'T / U', color: BASE_COLORS.T },
                    { key: isProtein ? 'other' : 'N', label: 'Other', color: BASE_COLORS.N },
                  ]}
                />
                <ChartLegend
                  items={[
                    { label: 'A', color: BASE_COLORS.A },
                    { label: 'C', color: BASE_COLORS.C },
                    { label: 'G', color: BASE_COLORS.G },
                    { label: 'T / U', color: BASE_COLORS.T },
                    { label: 'Other', color: BASE_COLORS.N },
                  ]}
                />
              </>
            </ChartFrame>
          )}
        </TabsContent>

        <TabsContent value="kmers" className="space-y-4">
          <KmerPanels spectra={result.kmerSpectra} fileName={fileName} />
        </TabsContent>

        {isProtein && result.protein ? (
          <TabsContent value="properties" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <ChartFrame
                title="Hydrophobicity (GRAVY)"
                description="Distribution of per-sequence grand average of hydropathy."
                help={`${METRIC_DOCS.gravy.what} ${METRIC_DOCS.gravy.caveat}`}
                data={result.protein.hydrophobicityDistribution as unknown as Record<string, unknown>[]}
                columns={[
                  { key: 'bucket', header: 'GRAVY' },
                  { key: 'count', header: 'Sequences', numeric: true },
                ]}
                exportName={`${fileName}-gravy-distribution`}
              >
                <Histogram
                  data={result.protein.hydrophobicityDistribution as unknown as Record<string, unknown>[]}
                  xKey="bucket"
                  yKey="count"
                  xLabel="GRAVY score"
                  yLabel="Sequences"
                  yTickFormatter={formatInteger}
                  tooltipValue={(row) => `${formatInteger(Number(row.count))} sequences`}
                />
              </ChartFrame>

              <ChartFrame
                title="Molecular weight"
                description="Distribution of estimated molecular weight of the unmodified chain."
                help={`${METRIC_DOCS.molecularWeight.what} ${METRIC_DOCS.molecularWeight.caveat}`}
                data={result.protein.molecularWeightDistribution as unknown as Record<string, unknown>[]}
                columns={[
                  { key: 'bucket', header: 'Molecular weight' },
                  { key: 'count', header: 'Sequences', numeric: true },
                ]}
                exportName={`${fileName}-mw-distribution`}
              >
                <Histogram
                  data={result.protein.molecularWeightDistribution as unknown as Record<string, unknown>[]}
                  xKey="bucket"
                  yKey="count"
                  xLabel="Molecular weight"
                  yLabel="Sequences"
                  yTickFormatter={formatInteger}
                  tooltipValue={(row) => `${formatInteger(Number(row.count))} sequences`}
                />
              </ChartFrame>
            </div>

            <Card>
              <CardHeaderRow
                title="Low-complexity regions"
                description="Windows whose residue entropy falls below the low-complexity threshold, merged into maximal regions. These are common and functional in real disordered proteins, not defects."
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void saveFile(
                        recordsToCsv(
                          result.protein!.lowComplexityRegions.map((region) => ({
                            sequenceIndex: region.sequenceIndex + 1,
                            sequenceId: region.sequenceId,
                            start: region.start,
                            end: region.end,
                            length: region.end - region.start + 1,
                            entropyBits: region.entropy.toFixed(4),
                            dominantResidue: region.dominantResidue,
                          })),
                        ),
                        {
                          suggestedName: `${slugify(fileName)}-low-complexity.csv`,
                          mimeType: MIME.csv,
                          extensions: ['.csv'],
                        },
                      )
                    }
                    disabled={result.protein.lowComplexityRegions.length === 0}
                  >
                    <Download />
                    CSV
                  </Button>
                }
              />
              <div className="max-h-72 overflow-auto border-t border-border">
                {result.protein.lowComplexityRegions.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                    No low-complexity regions were found at the current threshold.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-muted-foreground">
                        <th scope="col" className="px-4 py-1.5 text-left font-medium">Sequence</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium">Start</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium">End</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium">Length</th>
                        <th scope="col" className="px-3 py-1.5 text-right font-medium">Entropy</th>
                        <th scope="col" className="px-3 py-1.5 text-left font-medium">Dominant</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.protein.lowComplexityRegions.slice(0, 200).map((region, i) => (
                        <tr key={i} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                          <td className="px-4 py-1 font-mono text-foreground">{region.sequenceId}</td>
                          <td className="tabular px-3 py-1 text-right">{formatInteger(region.start)}</td>
                          <td className="tabular px-3 py-1 text-right">{formatInteger(region.end)}</td>
                          <td className="tabular px-3 py-1 text-right">
                            {formatInteger(region.end - region.start + 1)}
                          </td>
                          <td className="tabular px-3 py-1 text-right">
                            {formatDecimal(region.entropy, 2)}
                          </td>
                          <td className="px-3 py-1 font-mono">{region.dominantResidue}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card>
              <CardHeaderRow
                title="Per-sequence properties"
                description={`Physicochemical estimates for the first ${formatInteger(result.protein.perSequenceSample.length)} sequences.`}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void saveFile(
                        recordsToCsv(
                          result.protein!.perSequenceSample.map((entry) => ({
                            index: entry.index + 1,
                            id: entry.id,
                            length: entry.length,
                            molecularWeightDa: entry.molecularWeight.toFixed(2),
                            isoelectricPoint: entry.isoelectricPoint.toFixed(3),
                            netChargeAtPh7: entry.netChargeAtPh7.toFixed(3),
                            gravy: entry.gravy.toFixed(4),
                            hydrophobicFraction: entry.hydrophobicFraction.toFixed(4),
                            positiveResidues: entry.positiveResidues,
                            negativeResidues: entry.negativeResidues,
                            aromaticResidues: entry.aromaticResidues,
                            extinction280: entry.extinctionCoefficient,
                          })),
                        ),
                        {
                          suggestedName: `${slugify(fileName)}-protein-properties.csv`,
                          mimeType: MIME.csv,
                          extensions: ['.csv'],
                        },
                      )
                    }
                  >
                    <Download />
                    CSV
                  </Button>
                }
              />
              <div className="max-h-96 overflow-auto border-t border-border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className="px-4 py-1.5 text-left font-medium">Identifier</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Length</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">MW (kDa)</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">pI</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Charge pH7</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">GRAVY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.protein.perSequenceSample.slice(0, 300).map((entry) => (
                      <tr key={entry.index} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                        <td className="px-4 py-1 font-mono text-foreground">{entry.id}</td>
                        <td className="tabular px-3 py-1 text-right">{formatInteger(entry.length)}</td>
                        <td className="tabular px-3 py-1 text-right">
                          {formatDecimal(entry.molecularWeight / 1000, 2)}
                        </td>
                        <td className="tabular px-3 py-1 text-right">
                          {formatDecimal(entry.isoelectricPoint, 2)}
                        </td>
                        <td className="tabular px-3 py-1 text-right">
                          {formatDecimal(entry.netChargeAtPh7, 2)}
                        </td>
                        <td className="tabular px-3 py-1 text-right">
                          {formatDecimal(entry.gravy, 3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>

      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void saveFile(toJson(result), {
            suggestedName: `${slugify(fileName)}-composition.json`,
            mimeType: MIME.json,
            extensions: ['.json'],
          })
        }
      >
        <Download />
        Export full composition result (JSON)
      </Button>
    </div>
  );
}

function NucleotideSummary({ result }: { result: CompositionResult }) {
  if (!result.nucleotide) return null;
  const { nucleotide } = result;
  return (
    <StatGrid columns={5}>
      <StatTile
        label="GC content"
        value={formatPercent(nucleotide.gcPercent, 2)}
        detail={`AT ${formatPercent(nucleotide.atPercent, 2)}`}
        help={`${METRIC_DOCS.gc.what} ${METRIC_DOCS.gc.caveat}`}
      />
      <StatTile
        label="GC skew"
        value={formatDecimal(nucleotide.gcSkew, 4)}
        detail="(G − C) / (G + C)"
        help="Strand asymmetry in G versus C. Informative for single-stranded assemblies; averages to zero for reads sampled from both strands."
      />
      <StatTile
        label="CpG obs/exp"
        value={formatDecimal(nucleotide.cpgObservedExpected, 3)}
        detail={`${formatInteger(nucleotide.cpgCount)} CpG dinucleotides`}
        help="Observed CpG count divided by the count expected if C and G were independent. Vertebrates show a deficit near 0.2; bacteria and plants do not."
      />
      <StatTile
        label="Entropy"
        value={`${formatDecimal(nucleotide.entropyBitsPerBase, 3)} bits`}
        detail="Maximum is 2 bits per base"
        help={`${METRIC_DOCS.entropy.what} ${METRIC_DOCS.entropy.caveat}`}
      />
      <StatTile
        label="Sequences analysed"
        value={formatInteger(result.sequencesAnalyzed)}
        detail={`${formatPercent(nucleotide.ambiguousPercent, 3)} ambiguous residues`}
      />
    </StatGrid>
  );
}

function ProteinSummary({ result }: { result: CompositionResult }) {
  if (!result.protein) return null;
  const { aggregate } = result.protein;
  return (
    <StatGrid columns={5}>
      <StatTile
        label="Mean GRAVY"
        value={formatDecimal(aggregate.gravy, 3)}
        detail={`${formatPercent(aggregate.hydrophobicFraction * 100, 1)} hydrophobic residues`}
        help={`${METRIC_DOCS.gravy.what} ${METRIC_DOCS.gravy.caveat}`}
      />
      <StatTile
        label="Aggregate pI"
        value={formatDecimal(aggregate.isoelectricPoint, 2)}
        detail="Over the pooled residue composition"
        help={`${METRIC_DOCS.isoelectricPoint.what} ${METRIC_DOCS.isoelectricPoint.caveat}`}
      />
      <StatTile
        label="Charged residues"
        value={formatInteger(aggregate.positiveResidues + aggregate.negativeResidues)}
        detail={`${formatInteger(aggregate.positiveResidues)} basic, ${formatInteger(aggregate.negativeResidues)} acidic`}
      />
      <StatTile
        label="Aromatic residues"
        value={formatInteger(aggregate.aromaticResidues)}
        detail="F, W, and Y"
      />
      <StatTile
        label="Sequences analysed"
        value={formatInteger(result.sequencesAnalyzed)}
        detail={`${pluralize(result.protein.lowComplexityRegions.length, 'low-complexity region')} found`}
      />
    </StatGrid>
  );
}

/* -------------------------------------------------------------------------- */
/* k-mer panels                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One panel per requested k, with search and a rare-k-mer view.
 *
 * Search is over the retained top and rare lists rather than the whole table:
 * at k = 11 the full table has four million entries and is not transferred out
 * of the worker. The spectrum's summary statistics describe all of them.
 */
function KmerPanels({ spectra, fileName }: { spectra: KmerSpectrum[]; fileName: string }) {
  const [activeK, setActiveK] = useState(() => spectra[0]?.k ?? 3);
  const spectrum = spectra.find((candidate) => candidate.k === activeK) ?? spectra[0];

  if (!spectrum) {
    return (
      <Alert variant="info" title="No k-mer spectra were computed">
        Choose at least one k value in the configuration panel and re-run the analysis.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">k =</span>
        {spectra.map((candidate) => (
          <Button
            key={candidate.k}
            size="sm"
            variant={candidate.k === activeK ? 'default' : 'outline'}
            onClick={() => setActiveK(candidate.k)}
          >
            {candidate.k}
          </Button>
        ))}
      </div>

      <StatGrid columns={5}>
        <StatTile
          label="Distinct k-mers"
          value={formatInteger(spectrum.distinct)}
          detail={`of ${formatInteger(spectrum.possible)} possible (${formatPercent((spectrum.distinct / Math.max(1, spectrum.possible)) * 100, 2)})`}
        />
        <StatTile
          label="Total counted"
          value={formatInteger(spectrum.total)}
          detail="k-mer positions, excluding windows with ambiguous residues"
        />
        <StatTile
          label="Entropy"
          value={`${formatDecimal(spectrum.entropy, 3)} bits`}
          detail={`normalised ${formatDecimal(spectrum.normalizedEntropy, 3)} of 1.0`}
          help={`${METRIC_DOCS.kmerEntropy.what} ${METRIC_DOCS.kmerEntropy.caveat}`}
        />
        <StatTile
          label="Rare k-mers"
          value={formatInteger(spectrum.rareCount)}
          detail="At or below the configured rare threshold"
        />
        <StatTile
          label="Counting method"
          value={spectrum.exact ? 'Exact table' : 'Hash map'}
          detail={
            spectrum.canonical
              ? 'Reverse-complement pairs merged'
              : 'Forward strand only'
          }
          badge={spectrum.exact ? <Badge variant="pass">Exact</Badge> : <Badge variant="default">Sparse</Badge>}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-2">
        <KmerList
          title={`Most frequent ${spectrum.k}-mers`}
          description={`The ${formatInteger(spectrum.top.length)} highest-count ${spectrum.k}-mers, with their share of all counted k-mers.`}
          entries={spectrum.top}
          fileName={`${fileName}-top-${spectrum.k}mers`}
          total={spectrum.total}
        />
        <KmerList
          title={`Rare ${spectrum.k}-mers`}
          description={`A sample of the ${formatInteger(spectrum.rareCount)} ${spectrum.k}-mers at or below the rare-count threshold. In a random sequence of this size, rare k-mers are expected; a k-mer that is absent entirely can indicate a restriction site or a methylation-sensitive motif.`}
          entries={spectrum.rare}
          fileName={`${fileName}-rare-${spectrum.k}mers`}
          total={spectrum.total}
          emptyLabel="No k-mers fall at or below the rare threshold."
        />
      </div>
    </div>
  );
}

function KmerList({
  title,
  description,
  entries,
  fileName,
  total,
  emptyLabel,
}: {
  title: string;
  description: string;
  entries: { kmer: string; count: number; frequency: number }[];
  fileName: string;
  total: number;
  emptyLabel?: string;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 180);

  const filtered = useMemo(() => {
    const needle = debounced.trim().toUpperCase();
    if (needle.length === 0) return entries;
    return entries.filter((entry) => entry.kmer.includes(needle));
  }, [entries, debounced]);

  return (
    <ChartFrame
      title={title}
      description={description}
      data={filtered as unknown as Record<string, unknown>[]}
      columns={[
        { key: 'kmer', header: 'k-mer' },
        { key: 'count', header: 'Count', numeric: true },
        {
          key: 'frequency',
          header: 'Frequency',
          numeric: true,
          format: (value) => Number(value).toExponential(3),
        },
      ]}
      exportName={fileName}
      height={340}
      actions={
        <div className="relative w-36">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter"
            className="h-7 pr-6 pl-6 font-mono text-[11px]"
            aria-label={`Filter ${title}`}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </div>
      }
      footnote={
        total > 0 && filtered.length !== entries.length
          ? `${formatInteger(filtered.length)} of ${formatInteger(entries.length)} shown by the filter.`
          : undefined
      }
    >
      <BarList
        items={filtered.map((entry) => ({
          label: entry.kmer,
          value: entry.count,
          secondary: formatPercent(entry.frequency * 100, 3),
        }))}
        valueFormatter={formatInteger}
        maxItems={60}
        emptyLabel={emptyLabel ?? 'No k-mers match the filter.'}
      />
    </ChartFrame>
  );
}
