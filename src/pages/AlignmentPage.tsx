import { Download, Info, Trash2 } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { SERIES } from '@/components/charts/palette';
import { LineSeriesChart } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { SequenceTable } from '@/components/sequence/SequenceTable';
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
  Slider,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/primitives';
import { AlignmentViewer } from '@/features/alignment/AlignmentViewer';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
import { MAX_SELECTION, selectSelection, useSelectionStore } from '@/state/selectionStore';
import { datasetRepository } from '@/storage/repositories';
import type { AlignmentResult } from '@/types';
import { MIME, copyToClipboard, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, slugify } from '@/utils/format';
import { useKeyedAsync } from '@/utils/useKeyedAsync';

/**
 * Pairwise and multiple sequence alignment.
 *
 * Alignment is the one module that needs an explicit sequence selection rather
 * than operating on the whole dataset, because its cost is quadratic in length
 * and it produces something a reader inspects rather than summarises. Two
 * sequences get an exact optimal alignment; more get a center-star progressive
 * alignment, and the page says which was used.
 */
export function AlignmentPage() {
  const dataset = useProjectStore(selectActiveDataset);
  const selection = useSelectionStore((state) => selectSelection(state, dataset?.id ?? null));

  return (
    <AnalysisGate<AlignmentResult>
      kind="alignment"
      title="Alignment"
      description="Exact Gotoh alignment with affine gap costs for a pair, or center-star progressive alignment for a set. Select sequences below, then run. Both paths produce a consensus, per-column conservation, and a variant table."
      sequenceIndices={[...selection]}
      configPanel={<AlignmentSetup />}
      unavailable={
        selection.length < 2
          ? {
              reason: `Alignment needs at least two sequences and ${selection.length === 0 ? 'none are' : 'one is'} selected.`,
              suggestion: (
                <p>
                  Pick sequences in the table below. The Similarity module&rsquo;s top-pairs table
                  also has a button that selects a pair and brings you here.
                </p>
              ),
            }
          : null
      }
    >
      {(result, activeDataset) => (
        <AlignmentResults
          result={result}
          fileName={activeDataset.fileName}
          isProtein={activeDataset.sequenceType === 'protein'}
        />
      )}
    </AnalysisGate>
  );
}

/* -------------------------------------------------------------------------- */
/* Selection and configuration                                               */
/* -------------------------------------------------------------------------- */

function AlignmentSetup() {
  const project = useProjectStore(selectActiveProject);
  const dataset = useProjectStore(selectActiveDataset);
  const config = useProjectStore(selectActiveConfig);
  const updateConfig = useProjectStore((state) => state.updateConfig);

  const selection = useSelectionStore((state) => selectSelection(state, dataset?.id ?? null));
  const toggle = useSelectionStore((state) => state.toggle);
  const clear = useSelectionStore((state) => state.clear);

  const { data: index } = useKeyedAsync(dataset?.id ?? null, (datasetId) =>
    datasetRepository.getIndex(datasetId).then((value) => value ?? null),
  );

  if (project === null || dataset === null) return null;

  const isProtein = dataset.sequenceType === 'protein';
  const alignment = config.alignment;
  const setAlignment = (changes: Partial<typeof alignment>) => {
    void updateConfig(project.id, { ...config, alignment: { ...alignment, ...changes } });
  };

  const selectedLengths = index
    ? selection.map((sequenceIndex) => index.lengths[sequenceIndex] ?? 0)
    : [];
  const longest = selectedLengths.length > 0 ? Math.max(...selectedLengths) : 0;
  const tracebackMb =
    selection.length === 2 && selectedLengths.length === 2
      ? (selectedLengths[0] + 1) * (selectedLengths[1] + 1) / (1024 * 1024)
      : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeaderRow
          title="Alignment settings"
          description={
            selection.length === 2
              ? 'Two sequences selected, so an exact optimal alignment will be computed with full traceback.'
              : selection.length > 2
                ? `${formatInteger(selection.length)} sequences selected, so a center-star progressive alignment will be used: ${formatInteger(selection.length - 1)} pairwise alignments against a central sequence, merged into one layout.`
                : 'Select sequences in the table below to align them.'
          }
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void updateConfig(project.id, {
                  ...config,
                  alignment: { ...DEFAULT_CONFIG.alignment },
                })
              }
            >
              Restore defaults
            </Button>
          }
        />
        <div className="grid gap-4 border-t border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor="align-mode">Mode</Label>
            <Select
              value={alignment.mode}
              onValueChange={(value) => setAlignment({ mode: value as 'global' | 'local' })}
            >
              <SelectTrigger id="align-mode" className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (Needleman-Wunsch)</SelectItem>
                <SelectItem value="local">Local (Smith-Waterman)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Global aligns the sequences end to end, which is right for homologous sequences of
              similar length. Local finds the best-scoring sub-region and discards the flanks,
              which is right when only part of the sequences is related.
            </p>
          </div>

          {isProtein ? (
            <div className="space-y-1">
              <Label htmlFor="align-matrix">Substitution matrix</Label>
              <Select
                value={alignment.matrix}
                onValueChange={(value) =>
                  setAlignment({ matrix: value as typeof alignment.matrix })
                }
              >
                <SelectTrigger id="align-matrix" className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blosum62">BLOSUM62</SelectItem>
                  <SelectItem value="pam250">PAM250</SelectItem>
                  <SelectItem value="identity">Identity</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                BLOSUM62 is the standard for proteins at moderate divergence. PAM250 scores distant
                homologues better. Identity ignores chemical similarity entirely and is only useful
                as a baseline.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              <Label>Match / mismatch</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  value={alignment.match}
                  min={1}
                  max={20}
                  onChange={(event) =>
                    setAlignment({ match: Math.max(1, Number(event.target.value) || 2) })
                  }
                  className="h-7 max-w-16 text-xs"
                  aria-label="Match score"
                />
                <span className="text-[11px] text-muted-foreground">/</span>
                <Input
                  type="number"
                  value={alignment.mismatch}
                  min={-20}
                  max={0}
                  onChange={(event) =>
                    setAlignment({ mismatch: Math.min(0, Number(event.target.value) || -1) })
                  }
                  className="h-7 max-w-16 text-xs"
                  aria-label="Mismatch score"
                />
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The ratio matters more than the values. A high match relative to mismatch tolerates
                divergence; a harsh mismatch produces short, high-identity alignments.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <Label>Gap open / extend</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                value={alignment.gapOpen}
                min={0}
                max={50}
                onChange={(event) =>
                  setAlignment({ gapOpen: Math.max(0, Number(event.target.value) || 5) })
                }
                className="h-7 max-w-16 text-xs"
                aria-label="Gap open cost"
              />
              <span className="text-[11px] text-muted-foreground">/</span>
              <Input
                type="number"
                value={alignment.gapExtend}
                min={0}
                max={50}
                onChange={(event) =>
                  setAlignment({ gapExtend: Math.max(0, Number(event.target.value) || 2) })
                }
                className="h-7 max-w-16 text-xs"
                aria-label="Gap extend cost"
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A gap of length L costs open + L &times; extend. A high open relative to extend
              produces few long gaps, which matches how indels actually arise; equal values reduce
              to a linear penalty and scatter single-base gaps.
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="consensus-threshold">Consensus threshold</Label>
              <span className="tabular text-[11px] font-medium text-foreground">
                {formatPercent(alignment.consensusThreshold * 100, 0)}
              </span>
            </div>
            <Slider
              id="consensus-threshold"
              min={0.25}
              max={1}
              step={0.05}
              value={[alignment.consensusThreshold]}
              onValueChange={([value]) => setAlignment({ consensusThreshold: value })}
              className="py-2"
            />
            <div className="flex items-baseline justify-between">
              <Label htmlFor="conserved-threshold">Conserved threshold</Label>
              <span className="tabular text-[11px] font-medium text-foreground">
                {formatPercent(alignment.conservedThreshold * 100, 0)}
              </span>
            </div>
            <Slider
              id="conserved-threshold"
              min={0.5}
              max={1}
              step={0.05}
              value={[alignment.conservedThreshold]}
              onValueChange={([value]) => setAlignment({ conservedThreshold: value })}
              className="py-2"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A column whose top residue does not reach the consensus threshold is called as
              {isProtein ? ' X' : ' N'} rather than reported as settled.
            </p>
          </div>
        </div>

        {tracebackMb !== null ? (
          <div className="border-t border-border px-4 py-3">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
              An exact alignment of these two sequences needs a{' '}
              <span className="font-medium text-foreground">
                {formatDecimal(tracebackMb, 1)} MB
              </span>{' '}
              traceback matrix, one byte per cell of the full{' '}
              {formatInteger(selectedLengths[0])} &times; {formatInteger(selectedLengths[1])} grid.
              There is no way around that for an optimal result; the limit is 128 MB.
            </p>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeaderRow
          title="Select sequences"
          description={
            <>
              Click the checkbox to include a sequence. Up to {MAX_SELECTION} can be selected, and
              the alignment itself is capped at {alignment.maxSequences} sequences and{' '}
              {formatInteger(alignment.maxLength)} residues &mdash; adjustable in{' '}
              <Link to="/settings" className="text-primary hover:underline">
                Settings
              </Link>
              .
            </>
          }
          actions={
            selection.length > 0 ? (
              <>
                <Badge variant="primary">
                  {formatInteger(selection.length)} selected
                  {longest > 0 ? `, longest ${formatInteger(longest)}` : ''}
                </Badge>
                <Button size="sm" variant="ghost" onClick={() => clear(dataset.id)}>
                  <Trash2 />
                  Clear
                </Button>
              </>
            ) : null
          }
        />
        <div className="border-t border-border">
          {index ? (
            <SequenceTable
              dataset={dataset}
              index={index}
              selected={[...selection]}
              onToggle={(sequenceIndex) => toggle(dataset.id, sequenceIndex)}
              height={300}
              className="rounded-none border-0"
            />
          ) : (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              Loading the sequence index&hellip;
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Results                                                                    */
/* -------------------------------------------------------------------------- */

function AlignmentResults({
  result,
  fileName,
  isProtein,
}: {
  result: AlignmentResult;
  fileName: string;
  isProtein: boolean;
}) {
  const conservationSeries = useMemo(
    () =>
      result.columns.map((column) => ({
        position: column.position,
        conservation: column.conservation * 100,
        gaps: column.gapFraction * 100,
      })),
    [result.columns],
  );

  const exportAlignment = async (format: 'fasta' | 'clustal') => {
    if (format === 'fasta') {
      const fasta = result.rows
        .map((row) => `>${row.id}\n${row.aligned}\n`)
        .join('');
      await saveFile(fasta, {
        suggestedName: `${slugify(fileName)}-alignment.afa`,
        mimeType: MIME.fasta,
        description: 'Aligned FASTA',
        extensions: ['.afa', '.fasta'],
      });
      return;
    }

    // CLUSTAL format: 60-column blocks with a conservation line, which is what
    // most downstream alignment viewers expect to read.
    const width = 60;
    const nameWidth = Math.max(16, ...result.rows.map((row) => row.id.length)) + 2;
    const lines: string[] = ['CLUSTAL W (produced by SeqLens, center-star or Gotoh)', '', ''];
    for (let from = 0; from < result.stats.alignmentLength; from += width) {
      for (const row of result.rows) {
        lines.push(`${row.id.padEnd(nameWidth)}${row.aligned.slice(from, from + width)}`);
      }
      const marks = result.columns
        .slice(from, from + width)
        .map((column) =>
          column.conservation >= 1 ? '*' : column.conservation >= 0.8 ? ':' : column.conservation >= 0.5 ? '.' : ' ',
        )
        .join('');
      lines.push(`${''.padEnd(nameWidth)}${marks}`, '');
    }
    await saveFile(lines.join('\n'), {
      suggestedName: `${slugify(fileName)}-alignment.aln`,
      mimeType: MIME.text,
      description: 'CLUSTAL alignment',
      extensions: ['.aln'],
    });
  };

  return (
    <div className="space-y-5">
      <StatGrid columns={5}>
        <StatTile
          label="Method"
          value={result.method === 'pairwise-gotoh' ? 'Exact' : 'Center-star'}
          detail={
            result.method === 'pairwise-gotoh'
              ? `Optimal ${result.configSnapshot.mode} alignment, Gotoh affine gaps`
              : `${formatInteger(result.stats.sequences - 1)} pairwise alignments merged`
          }
          badge={
            result.method === 'pairwise-gotoh' ? (
              <Badge variant="pass">Optimal</Badge>
            ) : (
              <Badge variant="warning">Heuristic</Badge>
            )
          }
        />
        <StatTile
          label="Alignment length"
          value={formatInteger(result.stats.alignmentLength)}
          detail={`${formatInteger(result.stats.sequences)} sequences`}
        />
        <StatTile
          label="Mean identity"
          value={formatPercent(result.stats.meanPairwiseIdentity * 100, 1)}
          detail="Over all pairs of rows, ignoring gap-gap columns"
        />
        <StatTile
          label="Gap fraction"
          value={formatPercent(result.stats.gapFraction * 100, 1)}
          detail="Of all cells in the alignment grid"
        />
        <StatTile
          label="Variants"
          value={formatInteger(
            result.stats.substitutions + result.stats.insertions + result.stats.deletions,
          )}
          detail={`${formatInteger(result.stats.substitutions)} substitutions, ${formatInteger(result.stats.insertions)} insertions, ${formatInteger(result.stats.deletions)} deletions`}
        />
      </StatGrid>

      <AnalysisNotes notes={result.notes} />

      <Tabs defaultValue="alignment">
        <TabsList>
          <TabsTrigger value="alignment">Alignment</TabsTrigger>
          <TabsTrigger value="conservation">Conservation</TabsTrigger>
          <TabsTrigger value="regions">Regions</TabsTrigger>
          <TabsTrigger value="variants">Variants</TabsTrigger>
          <TabsTrigger value="consensus">Consensus</TabsTrigger>
        </TabsList>

        <TabsContent value="alignment" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void exportAlignment('fasta')}>
              <Download />
              Aligned FASTA
            </Button>
            <Button size="sm" variant="outline" onClick={() => void exportAlignment('clustal')}>
              <Download />
              CLUSTAL
            </Button>
          </div>
          <AlignmentViewer
            rows={result.rows}
            consensus={result.consensus}
            columns={result.columns}
            isProtein={isProtein}
            conservedThreshold={result.configSnapshot.conservedThreshold}
            height={520}
          />
        </TabsContent>

        <TabsContent value="conservation" className="space-y-4">
          <ChartFrame
            title="Per-column conservation and gaps"
            description="Conservation is the frequency of the most common non-gap residue among the non-gap residues in a column. The gap fraction is plotted separately, because a column with two residues and forty-eight gaps can be 100% conserved and still tell you almost nothing."
            data={conservationSeries}
            columns={[
              { key: 'position', header: 'Column', numeric: true },
              {
                key: 'conservation',
                header: 'Conservation %',
                numeric: true,
                format: (value) => formatDecimal(Number(value), 1),
              },
              {
                key: 'gaps',
                header: 'Gap %',
                numeric: true,
                format: (value) => formatDecimal(Number(value), 1),
              },
            ]}
            exportName={`${fileName}-alignment-conservation`}
            height={300}
          >
            <LineSeriesChart
              data={conservationSeries}
              xKey="position"
              xLabel="Alignment column"
              yLabel="Percent"
              yDomain={[0, 100]}
              valueFormatter={(value) =>
                typeof value === 'number' ? `${formatDecimal(value, 1)}%` : String(value ?? '')
              }
              series={[
                { key: 'conservation', label: 'Conservation', color: SERIES[0] },
                { key: 'gaps', label: 'Gaps', color: SERIES[1] },
              ]}
            />
          </ChartFrame>
        </TabsContent>

        <TabsContent value="regions" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-2">
            <RegionTable
              title="Conserved regions"
              description={`Runs of at least three consecutive columns at or above ${formatPercent(result.configSnapshot.conservedThreshold * 100, 0)} conservation.`}
              regions={result.conservedRegions}
              emptyLabel="No region reaches the conserved threshold across three or more consecutive columns."
              fileName={`${slugify(fileName)}-conserved-regions`}
            />
            <RegionTable
              title="Variable regions"
              description="Runs of at least three consecutive columns below the conserved threshold. In a real alignment these are where the informative differences are."
              regions={result.variableRegions}
              emptyLabel="Every column reaches the conserved threshold."
              fileName={`${slugify(fileName)}-variable-regions`}
            />
          </div>
        </TabsContent>

        <TabsContent value="variants" className="space-y-4">
          <Card>
            <CardHeaderRow
              title="Variants relative to the reference row"
              description={`Per-column differences from "${result.rows[0]?.id ?? 'the reference'}". Consecutive columns are not merged into multi-base events, so a three-base deletion appears as three rows: this is a tabulation, not a VCF.`}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void saveFile(
                      recordsToCsv(
                        result.variants.map((variant) => ({
                          column: variant.column,
                          kind: variant.kind,
                          reference: variant.reference,
                          observed: variant.observed,
                          count: variant.count,
                          sequenceIds: variant.sequenceIds.join('; '),
                        })),
                      ),
                      {
                        suggestedName: `${slugify(fileName)}-variants.csv`,
                        mimeType: MIME.csv,
                        extensions: ['.csv'],
                      },
                    )
                  }
                  disabled={result.variants.length === 0}
                >
                  <Download />
                  CSV
                </Button>
              }
            />
            <div className="max-h-[32rem] overflow-auto border-t border-border">
              {result.variants.length === 0 ? (
                <Alert variant="success" className="m-4" title="No variants">
                  Every aligned sequence matches the reference row at every column.
                </Alert>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className="px-4 py-1.5 text-right font-medium">Column</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Type</th>
                      <th scope="col" className="px-3 py-1.5 text-center font-medium">Change</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Sequences</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Carried by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.variants.slice(0, 1000).map((variant, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                        <td className="tabular px-4 py-1 text-right">
                          {formatInteger(variant.column)}
                        </td>
                        <td className="px-3 py-1">
                          <Badge
                            variant={
                              variant.kind === 'substitution'
                                ? 'default'
                                : variant.kind === 'insertion'
                                  ? 'primary'
                                  : 'warning'
                            }
                            size="sm"
                          >
                            {variant.kind}
                          </Badge>
                        </td>
                        <td className="px-3 py-1 text-center font-mono">
                          {variant.reference} &rarr; {variant.observed}
                        </td>
                        <td className="tabular px-3 py-1 text-right">
                          {formatInteger(variant.count)}
                        </td>
                        <td className="px-3 py-1 font-mono text-[10px] break-all text-muted-foreground">
                          {variant.sequenceIds.join(', ')}
                          {variant.count > variant.sequenceIds.length
                            ? ` and ${formatInteger(variant.count - variant.sequenceIds.length)} more`
                            : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="consensus" className="space-y-4">
          <Card>
            <CardHeaderRow
              title="Consensus sequence"
              description={`Positions where the top residue reaches ${formatPercent(result.configSnapshot.consensusThreshold * 100, 0)} of the non-gap residues; other positions are called ${isProtein ? 'X' : 'N'}. Gap columns remain as dashes.`}
              actions={
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void copyToClipboard(result.consensus)}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void saveFile(
                        `>consensus ${result.rows.length} sequences, ${result.stats.alignmentLength} columns\n${result.consensus.replace(/-/g, '')}\n`,
                        {
                          suggestedName: `${slugify(fileName)}-consensus.fasta`,
                          mimeType: MIME.fasta,
                          extensions: ['.fasta'],
                        },
                      )
                    }
                  >
                    <Download />
                    FASTA (ungapped)
                  </Button>
                </>
              }
            />
            <div className="space-y-3 border-t border-border px-4 py-3">
              <MetricList
                columns={2}
                rows={[
                  {
                    label: 'Length with gaps',
                    value: formatInteger(result.consensus.length),
                  },
                  {
                    label: 'Length without gaps',
                    value: formatInteger(result.consensus.replace(/-/g, '').length),
                  },
                  {
                    label: `Ambiguous (${isProtein ? 'X' : 'N'}) positions`,
                    value: formatInteger(
                      (result.consensus.match(isProtein ? /X/g : /N/g) ?? []).length,
                    ),
                  },
                  {
                    label: 'Conserved columns',
                    value: formatInteger(
                      result.columns.filter(
                        (column) => column.conservation >= result.configSnapshot.conservedThreshold,
                      ).length,
                    ),
                  },
                ]}
              />
              <div className="residues max-h-64 overflow-auto rounded border border-border bg-subtle p-2 text-[11px] break-all">
                {result.consensus}
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          void saveFile(toJson(result), {
            suggestedName: `${slugify(fileName)}-alignment.json`,
            mimeType: MIME.json,
            extensions: ['.json'],
          })
        }
      >
        <Download />
        Export full alignment result (JSON)
      </Button>
    </div>
  );
}

function RegionTable({
  title,
  description,
  regions,
  emptyLabel,
  fileName,
}: {
  title: string;
  description: string;
  regions: { start: number; end: number; meanConservation: number }[];
  emptyLabel: string;
  fileName: string;
}) {
  return (
    <Card>
      <CardHeaderRow
        title={`${title} (${formatInteger(regions.length)})`}
        description={description}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void saveFile(
                recordsToCsv(
                  regions.map((region) => ({
                    start: region.start,
                    end: region.end,
                    length: region.end - region.start + 1,
                    meanConservation: region.meanConservation.toFixed(4),
                  })),
                ),
                { suggestedName: `${fileName}.csv`, mimeType: MIME.csv, extensions: ['.csv'] },
              )
            }
            disabled={regions.length === 0}
          >
            <Download />
            CSV
          </Button>
        }
      />
      <div className="max-h-72 overflow-auto border-t border-border">
        {regions.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">{emptyLabel}</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className="px-4 py-1.5 text-right font-medium">Start</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">End</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Length</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Mean conservation</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((region, i) => (
                <tr key={i} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                  <td className="tabular px-4 py-1 text-right">{formatInteger(region.start)}</td>
                  <td className="tabular px-3 py-1 text-right">{formatInteger(region.end)}</td>
                  <td className="tabular px-3 py-1 text-right">
                    {formatInteger(region.end - region.start + 1)}
                  </td>
                  <td className="tabular px-3 py-1 text-right">
                    {formatPercent(region.meanConservation * 100, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}
