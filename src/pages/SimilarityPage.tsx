import { Download, GitCompare } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { METRIC_DOCS } from '@/bio/defaults';
import { leafOrder } from '@/bio/similarity/clustering';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { Dendrogram } from '@/components/charts/Dendrogram';
import { Heatmap, HeatmapScale } from '@/components/charts/Heatmap';
import { Histogram } from '@/components/charts/primitives';
import { StatGrid, StatTile } from '@/components/charts/StatTile';
import { Button } from '@/components/ui/button';
import { Card, CardHeaderRow } from '@/components/ui/card';
import { Alert, Badge, MetricList } from '@/components/ui/display';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { AnalysisGate, AnalysisNotes } from '@/features/common/AnalysisGate';
import { SimilarityConfigPanel } from '@/features/similarity/SimilarityConfigPanel';
import { useSelectionStore } from '@/state/selectionStore';
import { selectActiveConfig, useProjectStore } from '@/state/projectStore';
import type { SimilarityResult } from '@/types';
import { MIME, recordsToCsv, saveFile, toJson } from '@/utils/export';
import { formatDecimal, formatInteger, formatPercent, pluralize, slugify } from '@/utils/format';

/**
 * Similarity, redundancy, and clustering.
 *
 * The page is explicit about the difference between an exact result and an
 * estimate, because they are computed differently and mean different things
 * here. Exact duplicate detection covers every sequence in the dataset. The
 * similarity matrix is built from MinHash sketches over a possibly sampled
 * subset, and its Jaccard values carry sampling error. Where alignment
 * refinement ran, the identity column is a real measurement.
 */
export function SimilarityPage() {
  return (
    <AnalysisGate<SimilarityResult>
      kind="similarity"
      title="Similarity & redundancy"
      description="Exact duplicate detection across the whole dataset, plus a sketch-based similarity matrix, hierarchical clustering, and representative selection. An exhaustive all-pairs alignment is not attempted: at a thousand sequences that is half a million alignments."
      configPanel={<SimilarityConfigPanel />}
    >
      {(result, dataset) => <SimilarityResults result={result} fileName={dataset.fileName} />}
    </AnalysisGate>
  );
}

function SimilarityResults({
  result,
  fileName,
}: {
  result: SimilarityResult;
  fileName: string;
}) {
  const config = useProjectStore(selectActiveConfig);
  const setSelection = useSelectionStore((state) => state.setSelection);
  const navigate = useNavigate();
  const [highlighted, setHighlighted] = useState<Set<number>>(new Set());

  const order = useMemo(() => leafOrder(result.dendrogram), [result.dendrogram]);
  const labels = useMemo(() => result.members.map((member) => member.id), [result.members]);

  /** Distribution of pairwise Jaccard values, for the histogram. */
  const jaccardHistogram = useMemo(() => {
    const bins = new Array(21).fill(0) as number[];
    for (let i = 0; i < result.matrix.length; i += 1) {
      const value = result.matrix[i];
      bins[Math.min(20, Math.max(0, Math.round(value * 20)))] += 1;
    }
    return bins.map((count, index) => ({
      bucket: formatDecimal(index / 20, 2),
      jaccard: index / 20,
      count,
    }));
  }, [result.matrix]);

  const alignPair = (a: number, b: number) => {
    const datasetIndices = [result.members[a]?.index, result.members[b]?.index].filter(
      (value): value is number => value !== undefined,
    );
    if (datasetIndices.length !== 2) return;
    setSelection(result.datasetId, datasetIndices);
    navigate('/alignment');
  };

  return (
    <div className="space-y-5">
      {result.sampled ? (
        <Alert variant="warning" title="The similarity matrix covers a sample, not the whole dataset">
          {formatInteger(result.members.length)} of {formatInteger(result.totalSequences)} sequences
          were compared. The sample is deterministic and stratified by length, so re-running gives
          the same set, but a pair that is not in it was never examined. Exact duplicate detection
          below still covers every sequence.
        </Alert>
      ) : null}

      <StatGrid columns={5}>
        <StatTile
          label="Exact duplicates"
          value={formatInteger(
            result.exactDuplicateGroups.reduce((sum, group) => sum + group.count - 1, 0),
          )}
          detail={`${pluralize(result.exactDuplicateGroups.length, 'group')}, verified by residue comparison`}
          help={`${METRIC_DOCS.duplicates.what} ${METRIC_DOCS.duplicates.caveat}`}
        />
        <StatTile
          label="Clusters"
          value={formatInteger(result.clusters.length)}
          detail={`at Jaccard ${formatDecimal(result.configSnapshot.clusterThreshold, 2)}, ${result.configSnapshot.linkage} linkage`}
        />
        <StatTile
          label="Redundant fraction"
          value={formatPercent(result.stats.redundantFraction * 100, 1)}
          detail="Compared sequences that are non-representative cluster members"
        />
        <StatTile
          label="Mean Jaccard"
          value={formatDecimal(result.stats.meanJaccard, 4)}
          detail={`median ${formatDecimal(result.stats.medianJaccard, 4)}, max ${formatDecimal(result.stats.maxJaccard, 4)}`}
          help={`${METRIC_DOCS.jaccard.what} ${METRIC_DOCS.jaccard.caveat}`}
        />
        <StatTile
          label="Pairs compared"
          value={formatInteger(result.stats.pairsCompared)}
          detail={
            result.stats.pairsRefined > 0
              ? `${formatInteger(result.stats.pairsRefined)} refined by alignment`
              : 'Sketch estimates only'
          }
        />
      </StatGrid>

      <AnalysisNotes notes={result.notes} />

      <Tabs defaultValue="matrix">
        <TabsList>
          <TabsTrigger value="matrix">Matrix</TabsTrigger>
          <TabsTrigger value="tree">Dendrogram</TabsTrigger>
          <TabsTrigger value="clusters">Clusters</TabsTrigger>
          <TabsTrigger value="pairs">Top pairs</TabsTrigger>
          <TabsTrigger value="duplicates">Exact duplicates</TabsTrigger>
        </TabsList>

        <TabsContent value="matrix" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[auto_1fr]">
            <Card className="overflow-hidden">
              <CardHeaderRow
                title="Similarity matrix"
                description={`${formatInteger(result.matrixSize)} sequences, ordered by the clustering tree so related sequences sit adjacent. Click a cell to align that pair.`}
              />
              <div className="overflow-auto border-t border-border p-3">
                <Heatmap
                  matrix={result.matrix}
                  size={result.matrixSize}
                  labels={labels}
                  order={order.length === result.matrixSize ? order : undefined}
                  threshold={result.configSnapshot.clusterThreshold}
                  onSelectPair={alignPair}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border bg-subtle px-3 py-2">
                <HeatmapScale threshold={result.configSnapshot.clusterThreshold} />
                <span className="text-[11px] text-muted-foreground">
                  The vertical mark shows the cluster threshold.
                </span>
              </div>
            </Card>

            <ChartFrame
              title="Pairwise similarity distribution"
              description="How the pairwise Jaccard estimates are distributed. A mass at zero with a small tail near one is the signature of a mostly-unrelated set containing a few near-duplicate families."
              data={jaccardHistogram}
              columns={[
                { key: 'bucket', header: 'Jaccard' },
                { key: 'count', header: 'Pairs', numeric: true },
              ]}
              exportName={`${fileName}-jaccard-distribution`}
              height={300}
              footnote={`Sketch estimates from ${formatInteger(result.configSnapshot.sketchSize)} hashes of ${result.configSnapshot.sketchK}-mers, so the standard error at a true similarity of 0.5 is about ${formatDecimal(Math.sqrt(0.25 / result.configSnapshot.sketchSize), 3)}.`}
            >
              <Histogram
                data={jaccardHistogram}
                xKey="bucket"
                yKey="count"
                xLabel="Jaccard similarity"
                yLabel="Pairs"
                yTickFormatter={formatInteger}
                tooltipLabel={(row) => `Jaccard ${row.bucket}`}
                tooltipValue={(row) => `${formatInteger(Number(row.count))} pairs`}
                markers={[
                  {
                    value: result.configSnapshot.clusterThreshold,
                    label: 'cluster threshold',
                  },
                ]}
              />
            </ChartFrame>
          </div>
        </TabsContent>

        <TabsContent value="tree" className="space-y-4">
          <Card>
            <CardHeaderRow
              title="Hierarchical clustering tree"
              description={`${result.configSnapshot.linkage} linkage on 1 minus the Jaccard estimate. The vertical rule marks the cut at Jaccard ${formatDecimal(result.configSnapshot.clusterThreshold, 2)}; branches below it are coloured by cluster and branches above are grey.`}
            />
            <div className="border-t border-border p-3">
              <Dendrogram
                root={result.dendrogram}
                threshold={result.configSnapshot.clusterThreshold}
                width={Math.max(560, 560)}
                leafHeight={result.matrixSize > 120 ? 9 : 14}
                onSelectLeaf={(memberIndex) =>
                  setHighlighted((previous) => {
                    const next = new Set(previous);
                    if (next.has(memberIndex)) next.delete(memberIndex);
                    else next.add(memberIndex);
                    return next;
                  })
                }
                highlightIndices={highlighted}
              />
            </div>
            <div className="border-t border-border bg-subtle px-3 py-2">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                The axis along the top is linkage distance, with the root on the left and leaves on
                the right. Cluster colours come from a four-hue set that stays distinguishable when
                any two leaves sit adjacent; a fifth hue would not, so clusters beyond the fourth
                reuse the hues and are identified by the cluster table below.
              </p>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="clusters" className="space-y-4">
          <Card>
            <CardHeaderRow
              title="Cluster assignments"
              description="One row per cluster, largest first. The representative is the longest member, which is what a redundancy-reduction step would keep."
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void saveFile(
                      recordsToCsv(
                        result.clusters.flatMap((cluster) =>
                          cluster.memberIndices.map((memberIndex) => ({
                            cluster: cluster.clusterId + 1,
                            clusterSize: cluster.memberIndices.length,
                            representativeId: cluster.representativeId,
                            isRepresentative: memberIndex === cluster.representativeIndex,
                            sequenceIndex: result.members[memberIndex].index + 1,
                            sequenceId: result.members[memberIndex].id,
                            length: result.members[memberIndex].length,
                            gcPercent: result.members[memberIndex].gcPercent.toFixed(3),
                            meanIntraClusterJaccard: cluster.meanSimilarity.toFixed(4),
                          })),
                        ),
                      ),
                      {
                        suggestedName: `${slugify(fileName)}-clusters.csv`,
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
            <div className="max-h-[32rem] overflow-auto border-t border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className="px-4 py-1.5 text-right font-medium">Cluster</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Members</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Representative</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Mean Jaccard</th>
                    <th scope="col" className="px-3 py-1.5 text-left font-medium">Members</th>
                  </tr>
                </thead>
                <tbody>
                  {result.clusters.map((cluster) => (
                    <tr
                      key={cluster.clusterId}
                      className="border-b border-border last:border-b-0 hover:bg-muted/60"
                    >
                      <td className="tabular px-4 py-1.5 text-right text-muted-foreground">
                        {cluster.clusterId + 1}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {cluster.memberIndices.length > 1 ? (
                          <Badge variant="primary">{cluster.memberIndices.length}</Badge>
                        ) : (
                          <span className="text-muted-foreground">1</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-foreground">
                        {cluster.representativeId}
                      </td>
                      <td className="tabular px-3 py-1.5 text-right">
                        {formatDecimal(cluster.meanSimilarity, 3)}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[10px] leading-relaxed break-all text-muted-foreground">
                        {cluster.memberIndices
                          .slice(0, 8)
                          .map((memberIndex) => result.members[memberIndex]?.id)
                          .join(', ')}
                        {cluster.memberIndices.length > 8
                          ? ` and ${formatInteger(cluster.memberIndices.length - 8)} more`
                          : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeaderRow
              title="Redundancy reduction"
              description="Keeping one representative per cluster is the CD-HIT-style reduction. These figures say what that would cost."
            />
            <div className="px-4 pb-4">
              <MetricList
                columns={2}
                rows={[
                  {
                    label: 'Sequences compared',
                    value: formatInteger(result.members.length),
                  },
                  {
                    label: 'Representatives retained',
                    value: formatInteger(result.clusters.length),
                  },
                  {
                    label: 'Sequences removed',
                    value: formatInteger(result.members.length - result.clusters.length),
                  },
                  {
                    label: 'Reduction',
                    value: formatPercent(result.stats.redundantFraction * 100, 1),
                  },
                  {
                    label: 'Residues in representatives',
                    value: formatInteger(
                      result.clusters.reduce(
                        (sum, cluster) => sum + (result.members[cluster.representativeIndex]?.length ?? 0),
                        0,
                      ),
                    ),
                  },
                  {
                    label: 'Residues in all compared',
                    value: formatInteger(
                      result.members.reduce((sum, member) => sum + member.length, 0),
                    ),
                  },
                ]}
              />
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() =>
                  void saveFile(
                    recordsToCsv(
                      result.clusters.map((cluster) => ({
                        clusterId: cluster.clusterId + 1,
                        representativeId: cluster.representativeId,
                        sequenceIndex: result.members[cluster.representativeIndex].index + 1,
                        length: result.members[cluster.representativeIndex].length,
                        clusterSize: cluster.memberIndices.length,
                      })),
                    ),
                    {
                      suggestedName: `${slugify(fileName)}-representatives.csv`,
                      mimeType: MIME.csv,
                      extensions: ['.csv'],
                    },
                  )
                }
              >
                <Download />
                Export representative list
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="pairs" className="space-y-4">
          <Card>
            <CardHeaderRow
              title="Most similar pairs"
              description={
                result.stats.pairsRefined > 0
                  ? `The highest-scoring pairs by sketch estimate. The identity column is present only where a real alignment ran, which is the ${formatInteger(result.stats.pairsRefined)} top pairs.`
                  : 'The highest-scoring pairs by sketch estimate. Alignment refinement was disabled, so no exact identity is available.'
              }
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void saveFile(
                      recordsToCsv(
                        result.topPairs.map((pair) => ({
                          sequenceA: result.members[pair.a]?.id ?? '',
                          sequenceB: result.members[pair.b]?.id ?? '',
                          lengthA: result.members[pair.a]?.length ?? '',
                          lengthB: result.members[pair.b]?.length ?? '',
                          jaccardEstimate: pair.jaccard.toFixed(4),
                          alignmentIdentity:
                            pair.identity === undefined ? '' : pair.identity.toFixed(4),
                          alignedLength: pair.alignedLength ?? '',
                        })),
                      ),
                      {
                        suggestedName: `${slugify(fileName)}-top-pairs.csv`,
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
            <div className="max-h-[32rem] overflow-auto border-t border-border">
              {result.topPairs.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                  No pairs share any k-mers, so every sequence in the compared set is distinct at
                  this k.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className="px-4 py-1.5 text-left font-medium">Sequence A</th>
                      <th scope="col" className="px-3 py-1.5 text-left font-medium">Sequence B</th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">
                        Jaccard (est.)
                      </th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">
                        Identity (aligned)
                      </th>
                      <th scope="col" className="px-3 py-1.5 text-right font-medium">Align</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.topPairs.map((pair, i) => (
                      <tr key={i} className="border-b border-border last:border-b-0 hover:bg-muted/60">
                        <td className="px-4 py-1 font-mono text-foreground">
                          {result.members[pair.a]?.id}
                        </td>
                        <td className="px-3 py-1 font-mono text-foreground">
                          {result.members[pair.b]?.id}
                        </td>
                        <td className="tabular px-3 py-1 text-right">
                          {formatDecimal(pair.jaccard, 3)}
                        </td>
                        <td className="tabular px-3 py-1 text-right">
                          {pair.identity === undefined ? (
                            <span className="text-muted-foreground">not aligned</span>
                          ) : (
                            <>
                              {formatPercent(pair.identity * 100, 1)}
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                over {formatInteger(pair.alignedLength ?? 0)}
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-3 py-1 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5"
                            onClick={() => alignPair(pair.a, pair.b)}
                            title="Align this pair"
                          >
                            <GitCompare className="size-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="duplicates" className="space-y-4">
          <Card>
            <CardHeaderRow
              title="Exact duplicate groups"
              description="Byte-identical residue strings, grouped by a 64-bit hash and then confirmed by direct comparison. This covers every sequence in the dataset, including any excluded from the similarity matrix by sampling."
            />
            <div className="max-h-[32rem] overflow-auto border-t border-border">
              {result.exactDuplicateGroups.length === 0 ? (
                <Alert variant="success" className="m-4" title="No exact duplicates">
                  Every sequence in this dataset has a distinct residue string.
                </Alert>
              ) : (
                <ul className="divide-y divide-border">
                  {result.exactDuplicateGroups.map((group) => (
                    <li key={group.hash} className="space-y-1 px-4 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="default">{formatInteger(group.count)} copies</Badge>
                        <span className="tabular text-[11px] text-muted-foreground">
                          {formatInteger(group.length)} residues &middot; hash{' '}
                          <span className="font-mono">{group.hash.slice(0, 12)}</span>
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
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void saveFile(toJson({ ...result, matrix: undefined }), {
              suggestedName: `${slugify(fileName)}-similarity.json`,
              mimeType: MIME.json,
              extensions: ['.json'],
            })
          }
        >
          <Download />
          Export result (JSON, without matrix)
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            // Long-form matrix rather than a square grid: a square CSV of a
            // 400-sequence matrix has 400 columns, which no spreadsheet or
            // downstream script handles gracefully.
            const rows: Record<string, unknown>[] = [];
            for (let i = 0; i < result.matrixSize; i += 1) {
              for (let j = i + 1; j < result.matrixSize; j += 1) {
                rows.push({
                  sequenceA: result.members[i].id,
                  sequenceB: result.members[j].id,
                  jaccard: result.matrix[
                    i * result.matrixSize - (i * (i + 1)) / 2 + j - i - 1
                  ].toFixed(5),
                });
              }
            }
            void saveFile(recordsToCsv(rows), {
              suggestedName: `${slugify(fileName)}-similarity-matrix.csv`,
              mimeType: MIME.csv,
              extensions: ['.csv'],
            });
          }}
        >
          <Download />
          Export matrix (long-form CSV)
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Sketch size {formatInteger(config.similarity.sketchSize)}, k = {config.similarity.sketchK}.
        Raising the sketch size reduces the estimate&rsquo;s error at linear cost in comparison
        time; raising k makes the measure stricter about divergence.
      </p>
    </div>
  );
}
