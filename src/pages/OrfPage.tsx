import { Copy, Download, Eye } from 'lucide-react';
import { useMemo, useState } from 'react';
import { GENETIC_CODES, getGeneticCode } from '@/bio/translation/geneticCode';
import { formatFastaRecord } from '@/bio/parsers/writer';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { SERIES } from '@/components/charts/palette';
import { BarList, Histogram } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { SequenceViewer, type Annotation } from '@/components/sequence/SequenceViewer';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { OrfMap } from '@/features/orf/OrfMap';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
import { getSequence } from '@/storage/sequenceStore';
import { runJob } from '@/workers/client';
import type { Orf, OrfResult } from '@/types';
import { cn } from '@/utils/cn';
import { MIME, copyToClipboard, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, pluralize, slugify } from '@/utils/format';
import { useKeyedAsync } from '@/utils/useKeyedAsync';

/**
 * ORF detection and six-frame translation.
 *
 * Two views on the same data: a dataset-level summary of every ORF found, and a
 * per-sequence inspector showing all six translated frames plus the ORF map
 * drawn against the sequence axis. The inspector runs its own single-sequence
 * job, so opening a 5 Mbp contig does not go through the whole-dataset path.
 */
export function OrfPage() {
  const dataset = useProjectStore(selectActiveDataset);
  const isProtein = dataset?.sequenceType === 'protein';

  return (
    <AnalysisGate<OrfResult>
      kind="orf"
      title="ORF & translation"
      description="Open reading frames in all six frames, under a choice of NCBI genetic code, with six-frame translation for any individual sequence. One ORF is reported per stop codon, starting at the first initiation codon after the previous stop."
      configPanel={<OrfConfigPanel />}
      unavailable={
        isProtein
          ? {
              reason:
                'This dataset was detected as protein, and open reading frames are a property of nucleotide sequence. There is nothing to translate.',
              suggestion: (
                <p>
                  Select a DNA or RNA dataset from the header. If this file really is nucleotide
                  data that was misdetected, re-import it with the sequence type set manually on
                  the Import page.
                </p>
              ),
            }
          : null
      }
    >
      {(result, activeDataset) => (
        <OrfResults result={result} fileName={activeDataset.fileName} datasetId={activeDataset.id} />
      )}
    </AnalysisGate>
  );
}

function OrfResults({
  result,
  fileName,
  datasetId,
}: {
  result: OrfResult;
  fileName: string;
  datasetId: string;
}) {
  const [inspecting, setInspecting] = useState<number | null>(null);
  const code = getGeneticCode(result.configSnapshot.geneticCode);

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

  const exportProteins = async () => {
    const fasta = result.orfs
      .map((orf) =>
        formatFastaRecord(
          `${orf.sequenceId}_orf_${orf.start}_${orf.end}_${orf.strand}${orf.frame}`,
          `${orf.aminoAcidLength} aa, ${orf.startCodon} start, ${orf.stopCodon ?? 'partial'} stop, genetic code ${result.configSnapshot.geneticCode}`,
          orf.protein,
        ),
      )
      .join('');
    await saveFile(fasta, {
      suggestedName: `${slugify(fileName)}-orf-proteins.faa`,
      mimeType: MIME.fasta,
      description: 'Protein FASTA',
      extensions: ['.faa'],
    });
  };

  return (
    <div className="space-y-5">
      <StatGrid columns={5}>
        <StatTile
          label="ORFs found"
          value={formatInteger(result.stats.orfCount)}
          detail={`in ${formatInteger(result.stats.sequencesWithOrf)} of ${formatInteger(result.stats.sequencesScanned)} sequences`}
        />
        <StatTile
          label="Longest ORF"
          value={`${formatInteger(result.stats.maxOrfLength)} aa`}
          detail={
            result.orfs[0]
              ? `${result.orfs[0].sequenceId} ${result.orfs[0].strand}${result.orfs[0].frame}`
              : 'None found'
          }
        />
        <StatTile
          label="Median length"
          value={`${formatInteger(result.stats.medianOrfLength)} aa`}
          detail={`mean ${formatDecimal(result.stats.meanOrfLength, 1)} aa`}
        />
        <StatTile
          label="Coding fraction"
          value={formatPercent(result.stats.codingFraction * 100, 1)}
          detail={`${formatInteger(result.stats.totalCodingBases)} bases inside an ORF`}
          help="Bases covered by a reported ORF divided by all bases scanned. ORFs in different frames can overlap, so this can exceed 100% on a dense sequence and is not a gene-density estimate."
        />
        <StatTile
          label="Genetic code"
          value={`Table ${result.configSnapshot.geneticCode}`}
          detail={code.name.length > 40 ? `${code.name.slice(0, 38)}…` : code.name}
          badge={
            result.configSnapshot.requireStartCodon ? (
              <Badge variant="default">Start required</Badge>
            ) : (
              <Badge variant="default">Stop to stop</Badge>
            )
          }
        />
      </StatGrid>

      <AnalysisNotes notes={result.notes} />

      <Tabs defaultValue="inspect">
        <TabsList>
          <TabsTrigger value="inspect">Inspect a sequence</TabsTrigger>
          <TabsTrigger value="table">All ORFs</TabsTrigger>
          <TabsTrigger value="distributions">Distributions</TabsTrigger>
          <TabsTrigger value="codons">Codon usage</TabsTrigger>
        </TabsList>

        <TabsContent value="inspect" className="space-y-4">
          <SequenceInspector
            datasetId={datasetId}
            orfs={result.orfs}
            initialIndex={result.orfs[0]?.sequenceIndex ?? 0}
            geneticCode={result.configSnapshot.geneticCode}
            selected={inspecting}
            onSelect={setInspecting}
          />
        </TabsContent>

        <TabsContent value="table" className="space-y-4">
          <Card>
            <CardHeaderRow
              title={pluralize(result.orfs.length, 'ORF')}
              description={
                result.orfs.length < result.stats.orfCount
                  ? `The ${formatInteger(result.orfs.length)} longest of ${formatInteger(result.stats.orfCount)} found. Summary statistics above cover all of them.`
                  : 'Every ORF found, longest first. Coordinates are 1-based, inclusive, and on the forward strand of the input sequence.'
              }
              actions={
                <>
                  <Button size="sm" variant="outline" onClick={() => void exportProteins()}>
                    <Download />
                    Proteins (FASTA)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void saveFile(
                        recordsToCsv(
                          result.orfs.map((orf) => ({
                            sequenceId: orf.sequenceId,
                            sequenceIndex: orf.sequenceIndex + 1,
                            strand: orf.strand,
                            frame: orf.frame,
                            start: orf.start,
                            end: orf.end,
                            nucleotideLength: orf.nucleotideLength,
                            aminoAcidLength: orf.aminoAcidLength,
                            startCodon: orf.startCodon,
                            stopCodon: orf.stopCodon ?? '',
                            partial: orf.partial,
                            protein: orf.protein,
                          })),
                        ),
                        {
                          suggestedName: `${slugify(fileName)}-orfs.csv`,
                          mimeType: MIME.csv,
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
            <div className="max-h-[36rem] overflow-auto border-t border-border">
              {result.orfs.length === 0 ? (
                <Alert variant="info" className="m-4" title="No ORFs met the criteria">
                  No open reading frame of at least{' '}
                  {formatInteger(result.configSnapshot.minAminoAcids)} amino acids was found under
                  genetic code {result.configSnapshot.geneticCode}
                  {result.configSnapshot.requireStartCodon
                    ? ' with an initiation codon required'
                    : ' scanning stop to stop'}
                  . Lowering the minimum length, clearing the start-codon requirement, or allowing
                  partial ORFs will find shorter and truncated frames.
                </Alert>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className="px-4 py-1.5 text-left font-medium">Sequence</th>
                      <th scope="col" className="px-2 py-1.5 text-center font-medium">Frame</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Start</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">End</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Length</th>
                      <th scope="col" className="px-2 py-1.5 text-center font-medium">Codons</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Protein</th>
                      <th scope="col" className="px-2 py-1.5 text-center font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.orfs.slice(0, 1000).map((orf, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                        <td className="px-4 py-1 font-mono text-foreground">{orf.sequenceId}</td>
                        <td className="px-2 py-1 text-center">
                          <span
                            className={cn(
                              'inline-block rounded px-1 font-mono text-[10px]',
                              orf.strand === '+'
                                ? 'bg-[#2a78d6]/12 text-[#1c5cab]'
                                : 'bg-[#eb6834]/12 text-[#a8431c]',
                            )}
                          >
                            {orf.strand}
                            {orf.frame}
                          </span>
                        </td>
                        <td className="tabular px-3 py-1 text-right">{formatInteger(orf.start)}</td>
                        <td className="tabular px-3 py-1 text-right">{formatInteger(orf.end)}</td>
                        <td className="tabular px-3 py-1 text-right">
                          {formatInteger(orf.aminoAcidLength)} aa
                        </td>
                        <td className="px-2 py-1 text-center font-mono text-[10px] text-muted-foreground">
                          {orf.startCodon}
                          {'→'}
                          {orf.stopCodon ?? '—'}
                          {orf.partial ? (
                            <Badge variant="warning" size="sm" className="ml-1">
                              partial
                            </Badge>
                          ) : null}
                        </td>
                        <td className="max-w-64 truncate px-3 py-1 font-mono text-[10px] text-muted-foreground">
                          {orf.protein.slice(0, 48)}
                          {orf.protein.length > 48 ? '…' : ''}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <span className="flex items-center gap-0.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              onClick={() => void copyToClipboard(orf.protein)}
                              title="Copy protein sequence"
                              aria-label="Copy protein sequence"
                            >
                              <Copy className="size-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-1"
                              onClick={() => setInspecting(orf.sequenceIndex)}
                              title="Inspect this sequence"
                              aria-label="Inspect this sequence"
                            >
                              <Eye className="size-3" />
                            </Button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {result.orfs.length > 1000 ? (
              <p className="border-t border-border bg-subtle px-4 py-1.5 text-[11px] text-muted-foreground">
                Showing the 1,000 longest. The CSV export contains all{' '}
                {formatInteger(result.orfs.length)} retained ORFs.
              </p>
            ) : null}
          </Card>
        </TabsContent>

        <TabsContent value="distributions" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title="ORF length distribution"
              description="ORF lengths in amino acids."
              data={lengthBins}
              columns={[
                { key: 'from', header: 'From (aa)', numeric: true },
                { key: 'to', header: 'To (aa)', numeric: true },
                { key: 'count', header: 'ORFs', numeric: true },
              ]}
              exportName={`${fileName}-orf-length-distribution`}
              footnote="In non-coding sequence, stop codons occur roughly every 21 codons by chance, so a long right tail is the signal that distinguishes real coding sequence from noise."
            >
              <Histogram
                data={lengthBins}
                xKey="label"
                yKey="count"
                xLabel="ORF length (amino acids)"
                yLabel="ORFs"
                yTickFormatter={formatInteger}
                tooltipLabel={(row) =>
                  `${formatInteger(Number(row.from))} – ${formatInteger(Number(row.to) - 1)} aa`
                }
                tooltipValue={(row) => `${formatInteger(Number(row.count))} ORFs`}
              />
            </ChartFrame>

            <ChartFrame
              title="ORFs per frame"
              description="How the ORFs distribute across the six reading frames. A real gene shows a strong imbalance; a random sequence does not."
              data={result.perFrameCounts as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'frame', header: 'Frame' },
                { key: 'count', header: 'ORFs', numeric: true },
              ]}
              exportName={`${fileName}-orfs-per-frame`}
            >
              <Histogram
                data={result.perFrameCounts as unknown as Record<string, unknown>[]}
                xKey="frame"
                yKey="count"
                xLabel="Strand and frame"
                yLabel="ORFs"
                yTickFormatter={formatInteger}
                colorFor={(row) => (String(row.frame).startsWith('+') ? SERIES[0] : SERIES[1])}
                tooltipValue={(row) => `${formatInteger(Number(row.count))} ORFs`}
              />
            </ChartFrame>
          </div>
        </TabsContent>

        <TabsContent value="codons" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartFrame
              title="Start codon usage"
              description={`Which initiation codons the reported ORFs begin with. Genetic code ${result.configSnapshot.geneticCode} permits ${code.startCodons.join(', ')}.`}
              data={result.startCodonUsage as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'codon', header: 'Codon' },
                { key: 'count', header: 'ORFs', numeric: true },
              ]}
              exportName={`${fileName}-start-codons`}
              height={200}
            >
              <BarList
                items={result.startCodonUsage.map((entry) => ({
                  label: entry.codon,
                  value: entry.count,
                  secondary: formatPercent(
                    (entry.count / Math.max(1, result.stats.orfCount)) * 100,
                    1,
                  ),
                }))}
                valueFormatter={formatInteger}
                maxItems={12}
              />
            </ChartFrame>

            <ChartFrame
              title="Stop codon usage"
              description={`Which termination codons the ORFs end with. Genetic code ${result.configSnapshot.geneticCode} uses ${code.stopCodons.join(', ')}.`}
              data={result.stopCodonUsage as unknown as Record<string, unknown>[]}
              columns={[
                { key: 'codon', header: 'Codon' },
                { key: 'count', header: 'ORFs', numeric: true },
              ]}
              exportName={`${fileName}-stop-codons`}
              height={200}
              footnote="Stop codon preference differs between organisms and is not uniform: TAA dominates in AT-rich genomes and TGA in GC-rich ones."
            >
              <BarList
                items={result.stopCodonUsage.map((entry) => ({
                  label: entry.codon,
                  value: entry.count,
                  secondary: formatPercent(
                    (entry.count / Math.max(1, result.stats.orfCount)) * 100,
                    1,
                  ),
                }))}
                valueFormatter={formatInteger}
                maxItems={12}
              />
            </ChartFrame>
          </div>
        </TabsContent>
      </Tabs>

      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void saveFile(toJson(result), {
            suggestedName: `${slugify(fileName)}-orf.json`,
            mimeType: MIME.json,
            extensions: ['.json'],
          })
        }
      >
        <Download />
        Export full ORF result (JSON)
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-sequence inspector                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Single-sequence six-frame view.
 *
 * Runs its own `translate` job rather than reusing the dataset result, because
 * the full six-frame translation of a long contig is six strings as long as the
 * sequence and is not something the dataset-level result should carry for every
 * record.
 */
function SequenceInspector({
  datasetId,
  orfs,
  initialIndex,
  geneticCode,
  selected,
  onSelect,
}: {
  datasetId: string;
  orfs: Orf[];
  initialIndex: number;
  geneticCode: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
}) {
  const config = useProjectStore(selectActiveConfig);
  const sequenceIndex = selected ?? initialIndex;

  // The highlighted ORF is stored with the translation key that produced it, so
  // switching sequence or genetic code drops the highlight by derivation rather
  // than by clearing it in an effect.
  const [highlight, setHighlight] = useState<{ key: string; orf: Orf } | null>(null);

  // Candidate sequences: those with ORFs, so the picker is useful rather than a
  // list of every record in the dataset.
  const candidates = useMemo(() => {
    const seen = new Map<number, { index: number; id: string; orfCount: number; longest: number }>();
    for (const orf of orfs) {
      const entry = seen.get(orf.sequenceIndex);
      if (entry) {
        entry.orfCount += 1;
        entry.longest = Math.max(entry.longest, orf.aminoAcidLength);
      } else {
        seen.set(orf.sequenceIndex, {
          index: orf.sequenceIndex,
          id: orf.sequenceId,
          orfCount: 1,
          longest: orf.aminoAcidLength,
        });
      }
    }
    return [...seen.values()].sort((a, b) => b.longest - a.longest).slice(0, 300);
  }, [orfs]);

  // Sequence and translation are loaded together and keyed on all three inputs,
  // so changing the selected sequence or the genetic code discards whichever
  // read is already in flight instead of racing it.
  const orfConfig = config.orf;
  const translationKey = `${datasetId}|${sequenceIndex}|${geneticCode}`;
  const { data: loaded, loading, error } = useKeyedAsync(
    translationKey,
    async () =>
      Promise.all([
        getSequence(datasetId, sequenceIndex),
        runJob({
          kind: 'translate',
          datasetId,
          sequenceIndex,
          config: { ...orfConfig, geneticCode },
        }),
      ]),
  );
  const sequence = loaded?.[0] ?? null;
  const translation = loaded?.[1] ?? null;
  const focusedOrf = highlight?.key === translationKey ? highlight.orf : null;
  const setFocusedOrf = (orf: Orf | null) =>
    setHighlight(orf === null ? null : { key: translationKey, orf });

  const annotations: Annotation[] = useMemo(() => {
    if (translation === null) return [];
    return translation.orfs.map((orf) => ({
      start: orf.start,
      end: orf.end,
      label: `ORF ${orf.strand}${orf.frame}`,
      color: orf.strand === '+' ? SERIES[0] : SERIES[1],
      detail: `${formatInteger(orf.aminoAcidLength)} aa, ${orf.startCodon} to ${orf.stopCodon ?? 'end'}`,
    }));
  }, [translation]);

  if (candidates.length === 0) {
    return (
      <Alert variant="info" title="No sequence has an ORF to inspect">
        Lower the minimum ORF length or clear the start-codon requirement in the configuration
        panel and re-run the analysis.
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="inspect-sequence" className="whitespace-nowrap">
          Sequence
        </Label>
        <Select
          value={String(sequenceIndex)}
          onValueChange={(value) => onSelect(Number(value))}
        >
          <SelectTrigger id="inspect-sequence" className="h-8 max-w-96 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((candidate) => (
              <SelectItem key={candidate.index} value={String(candidate.index)}>
                <span className="font-mono">{candidate.id}</span>
                <span className="ml-2 text-muted-foreground">
                  {candidate.orfCount} ORF{candidate.orfCount === 1 ? '' : 's'}, longest{' '}
                  {formatInteger(candidate.longest)} aa
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading ? <Badge variant="default">Translating&hellip;</Badge> : null}
      </div>

      {error ? (
        <Alert variant="error" title="This sequence could not be translated">
          {error.message}
        </Alert>
      ) : null}

      {translation && sequence ? (
        <>
          <Card>
            <CardHeaderRow
              title={`ORF map — ${translation.sequenceId}`}
              description={`${formatInteger(translation.length)} bases, ${pluralize(translation.orfs.length, 'ORF')} across six frames. Click an ORF to highlight it in the sequence below.`}
            />
            <div className="border-t border-border p-3">
              <OrfMap
                orfs={translation.orfs}
                sequenceLength={translation.length}
                onSelect={setFocusedOrf}
                selectedOrf={focusedOrf}
              />
            </div>
          </Card>

          {focusedOrf ? (
            <Card>
              <CardHeaderRow
                title={`ORF ${focusedOrf.strand}${focusedOrf.frame} at ${formatInteger(focusedOrf.start)}–${formatInteger(focusedOrf.end)}`}
                description={`${formatInteger(focusedOrf.aminoAcidLength)} amino acids, ${formatInteger(focusedOrf.nucleotideLength)} nucleotides including the stop codon.`}
                actions={
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copyToClipboard(focusedOrf.protein)}
                  >
                    <Copy />
                    Copy protein
                  </Button>
                }
              />
              <div className="space-y-2 border-t border-border px-4 py-3">
                <MetricList
                  columns={2}
                  rows={[
                    { label: 'Start codon', value: focusedOrf.startCodon, mono: true },
                    {
                      label: 'Stop codon',
                      value: focusedOrf.stopCodon ?? 'none (partial ORF)',
                      mono: true,
                    },
                    { label: 'Strand', value: focusedOrf.strand === '+' ? 'Forward' : 'Reverse' },
                    { label: 'Frame', value: String(focusedOrf.frame) },
                  ]}
                />
                <div className="residues max-h-40 overflow-auto rounded border border-border bg-subtle p-2 text-[11px] break-all">
                  {focusedOrf.protein}
                </div>
              </div>
            </Card>
          ) : null}

          <SequenceViewer
            sequence={sequence}
            sequenceType="dna"
            annotations={annotations}
            height={320}
            metadata={[{ label: 'ORFs', value: String(translation.orfs.length) }]}
          />

          <Card>
            <CardHeaderRow
              title="Six-frame translation"
              description="Each frame's full translation, with stop codons shown as asterisks. The longest stop-free stretch is the signal to look at: a coding frame has one long run while the other five are broken up."
            />
            <div className="divide-y divide-border border-t border-border">
              {translation.frames.map((frame) => (
                <div key={`${frame.strand}${frame.frame}`} className="space-y-1 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[11px] font-medium',
                        frame.strand === '+'
                          ? 'bg-[#2a78d6]/12 text-[#1c5cab]'
                          : 'bg-[#eb6834]/12 text-[#a8431c]',
                      )}
                    >
                      {frame.strand}
                      {frame.frame}
                    </span>
                    <span className="tabular text-[11px] text-muted-foreground">
                      {formatInteger(frame.protein.length)} residues &middot;{' '}
                      {formatInteger(frame.stopCount)} stops &middot; longest stop-free stretch{' '}
                      <span className="font-medium text-foreground">
                        {formatInteger(frame.longestStretch)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto h-6 px-1.5"
                      onClick={() => void copyToClipboard(frame.protein)}
                      title="Copy this frame"
                      aria-label="Copy this frame"
                    >
                      <Copy className="size-3" />
                    </Button>
                  </div>
                  <div className="residues max-h-24 overflow-auto rounded border border-border bg-subtle p-2 text-[10px] break-all">
                    {frame.protein.length === 0 ? (
                      <span className="text-muted-foreground">
                        Too short to translate in this frame.
                      </span>
                    ) : (
                      frame.protein
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

function OrfConfigPanel() {
  const project = useProjectStore(selectActiveProject);
  const config = useProjectStore(selectActiveConfig);
  const updateConfig = useProjectStore((state) => state.updateConfig);

  if (project === null) return null;
  const orf = config.orf;
  const code = getGeneticCode(orf.geneticCode);

  const setOrf = (changes: Partial<typeof orf>) => {
    void updateConfig(project.id, { ...config, orf: { ...orf, ...changes } });
  };

  return (
    <Card>
      <CardHeaderRow
        title="ORF detection settings"
        description={`Genetic code ${orf.geneticCode} (${code.name}). Start codons: ${code.startCodons.join(', ')}. Stop codons: ${code.stopCodons.join(', ')}.`}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void updateConfig(project.id, { ...config, orf: { ...DEFAULT_CONFIG.orf } })}
          >
            Restore defaults
          </Button>
        }
      />
      <div className="grid gap-4 border-t border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="genetic-code">Genetic code</Label>
          <Select
            value={String(orf.geneticCode)}
            onValueChange={(value) => setOrf({ geneticCode: Number(value) })}
          >
            <SelectTrigger id="genetic-code" className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GENETIC_CODES.map((table) => (
                <SelectItem key={table.id} value={String(table.id)}>
                  {table.shortName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {GENETIC_CODES.find((table) => table.id === orf.geneticCode)?.note}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="min-aa">Minimum length</Label>
          <Input
            id="min-aa"
            type="number"
            min={1}
            max={100_000}
            value={orf.minAminoAcids}
            onChange={(event) =>
              setOrf({ minAminoAcids: Math.max(1, Number(event.target.value) || 50) })
            }
            className="h-7 max-w-28 text-xs"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            In amino acids, excluding the stop codon. In non-coding sequence stop codons appear
            roughly every 21 codons, so 50 filters most chance ORFs while keeping short real genes.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id="require-start"
              checked={orf.requireStartCodon}
              onCheckedChange={(checked) => setOrf({ requireStartCodon: checked })}
            />
            <Label htmlFor="require-start" className="cursor-pointer">
              Require a start codon
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="reverse-strand"
              checked={orf.searchReverseStrand}
              onCheckedChange={(checked) => setOrf({ searchReverseStrand: checked })}
            />
            <Label htmlFor="reverse-strand" className="cursor-pointer">
              Search the reverse strand
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="partial-orfs"
              checked={orf.allowPartialOrfs}
              onCheckedChange={(checked) => setOrf({ allowPartialOrfs: checked })}
            />
            <Label htmlFor="partial-orfs" className="cursor-pointer">
              Report partial ORFs
            </Label>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Clearing the start requirement finds stop-to-stop stretches, which is what fragmentary
            assemblies need. Partial ORFs run off the end of the sequence with no stop codon.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="max-sequences">Sequences to scan</Label>
          <Input
            id="max-sequences"
            type="number"
            min={1}
            max={1_000_000}
            step={100}
            value={orf.maxSequences}
            onChange={(event) =>
              setOrf({ maxSequences: Math.max(1, Number(event.target.value) || 5000) })
            }
            className="h-7 max-w-28 text-xs"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Scanning is linear in total bases, but each sequence needs a reverse complement as long
            as itself, so a large read set is slower than the base count alone suggests.
          </p>
        </div>
      </div>
    </Card>
  );
}
