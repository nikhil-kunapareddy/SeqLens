import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/display';
import {
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
} from '@/components/ui/primitives';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
import { cn } from '@/utils/cn';
import { formatDecimal, formatInteger } from '@/utils/format';

/**
 * Similarity configuration.
 *
 * The estimated pair count and standard error are shown live, because both are
 * non-obvious consequences of the settings: doubling the matrix cap quadruples
 * the comparisons, and the sketch size sets the precision of every Jaccard
 * value on the page.
 */
export function SimilarityConfigPanel({ className }: { className?: string }) {
  const project = useProjectStore(selectActiveProject);
  const dataset = useProjectStore(selectActiveDataset);
  const config = useProjectStore(selectActiveConfig);
  const updateConfig = useProjectStore((state) => state.updateConfig);
  const [open, setOpen] = useState(false);

  if (project === null) return null;

  const similarity = config.similarity;
  const setSimilarity = (changes: Partial<typeof similarity>) => {
    void updateConfig(project.id, {
      ...config,
      similarity: { ...similarity, ...changes },
    });
  };

  const sequenceCount = dataset?.sequenceCount ?? 0;
  const matrixSize = Math.min(
    sequenceCount,
    sequenceCount > similarity.exactMaxSequences ? similarity.sampleSize : sequenceCount,
    1200,
  );
  const pairCount = (matrixSize * (matrixSize - 1)) / 2;
  const standardError = Math.sqrt(0.25 / Math.max(1, similarity.sketchSize));
  const willSample = sequenceCount > similarity.exactMaxSequences;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-semibold tracking-tight text-foreground">
            Similarity configuration
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {formatInteger(matrixSize)} sequences &rarr; {formatInteger(pairCount)} pairs &middot;{' '}
            {similarity.sketchSize}-hash sketches of {similarity.sketchK}-mers &middot;{' '}
            {similarity.linkage} linkage at {formatDecimal(similarity.clusterThreshold, 2)}
            {willSample ? ' · will sample' : ''}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="space-y-4 border-t border-border px-4 py-4">
          <Alert variant="note" title="What these settings cost">
            An exhaustive comparison is quadratic in sequence count, so a matrix of{' '}
            {formatInteger(matrixSize)} sequences means {formatInteger(pairCount)} comparisons and
            the clustering that follows is cubic. At the current sketch size the Jaccard estimates
            carry a standard error of about {formatDecimal(standardError, 3)} at a true similarity
            of 0.5, so differences smaller than that between pairs are not meaningful.
          </Alert>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="sketch-k">Sketch k-mer size</Label>
              <Input
                id="sketch-k"
                type="number"
                min={2}
                max={15}
                value={similarity.sketchK}
                onChange={(event) =>
                  setSimilarity({ sketchK: Math.max(2, Math.min(15, Number(event.target.value) || 8)) })
                }
                className="h-7 max-w-24 text-xs"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Larger k makes the measure stricter: a single substitution destroys k k-mers, so at
                k = 16 sequences 5% divergent already share few k-mers. Smaller k finds remote
                similarity but also spurious matches between unrelated sequences.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="sketch-size">Sketch size</Label>
              <Select
                value={String(similarity.sketchSize)}
                onValueChange={(value) => setSimilarity({ sketchSize: Number(value) })}
              >
                <SelectTrigger id="sketch-size" className="h-7 max-w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[64, 128, 256, 512, 1024, 2048].map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} hashes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Number of hashes retained per sequence. The estimate&rsquo;s standard error falls as
                the square root of this, so quadrupling it halves the error; comparison time rises
                linearly.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="linkage">Linkage</Label>
              <Select
                value={similarity.linkage}
                onValueChange={(value) =>
                  setSimilarity({ linkage: value as typeof similarity.linkage })
                }
              >
                <SelectTrigger id="linkage" className="h-7 max-w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="average">Average (UPGMA)</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                  <SelectItem value="single">Single</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Single linkage follows chains of related sequences and can join two groups through
                one intermediate; complete linkage produces compact clusters but splits elongated
                families; average is the least surprising of the three on sequence data.
              </p>
            </div>

            <div className="space-y-1 md:col-span-2 xl:col-span-1">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="cluster-threshold">Cluster threshold</Label>
                <span className="tabular text-[11px] font-medium text-foreground">
                  {formatDecimal(similarity.clusterThreshold, 2)}
                </span>
              </div>
              <Slider
                id="cluster-threshold"
                min={0}
                max={0.99}
                step={0.01}
                value={[similarity.clusterThreshold]}
                onValueChange={([value]) => setSimilarity({ clusterThreshold: value })}
                className="py-2"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Jaccard similarity at which two sequences join the same cluster. This is a k-mer
                set overlap, not a percent identity: two sequences at 95% nucleotide identity share
                far less than 95% of their k-mers.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="exact-max">Matrix size limit</Label>
              <Input
                id="exact-max"
                type="number"
                min={10}
                max={1200}
                step={10}
                value={similarity.exactMaxSequences}
                onChange={(event) =>
                  setSimilarity({
                    exactMaxSequences: Math.max(10, Math.min(1200, Number(event.target.value) || 400)),
                  })
                }
                className="h-7 max-w-28 text-xs"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Above this many sequences the matrix is built from a deterministic length-stratified
                sample instead. Capped at 1,200 regardless, because the clustering step is cubic.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="sample-size">Sample size</Label>
              <Input
                id="sample-size"
                type="number"
                min={10}
                max={1200}
                step={10}
                value={similarity.sampleSize}
                onChange={(event) =>
                  setSimilarity({
                    sampleSize: Math.max(10, Math.min(1200, Number(event.target.value) || 300)),
                  })
                }
                className="h-7 max-w-28 text-xs"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                How many sequences to sample when the dataset exceeds the limit. The sample is
                stratified by length so the full length range is represented, and seeded so the
                same dataset always yields the same set.
              </p>
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Switch
                id="refine"
                checked={similarity.refineWithAlignment}
                onCheckedChange={(checked) => setSimilarity({ refineWithAlignment: checked })}
              />
              <Label htmlFor="refine" className="cursor-pointer">
                Refine top pairs with alignment
              </Label>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Converts the sketch estimate into a real percent identity for the highest-scoring
              pairs by running a linear-memory global alignment on each. This is the only place in
              this module where an exact identity is produced, and it is limited to the top{' '}
              {formatInteger(similarity.maxRefinedPairs)} pairs because each alignment is quadratic
              in sequence length.
            </p>
            {similarity.refineWithAlignment ? (
              <div className="max-w-40 space-y-1">
                <Label htmlFor="max-refined">Pairs to refine</Label>
                <Input
                  id="max-refined"
                  type="number"
                  min={0}
                  max={2000}
                  step={10}
                  value={similarity.maxRefinedPairs}
                  onChange={(event) =>
                    setSimilarity({
                      maxRefinedPairs: Math.max(0, Math.min(2000, Number(event.target.value) || 200)),
                    })
                  }
                  className="h-7 text-xs"
                />
              </div>
            ) : null}
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void updateConfig(project.id, {
                  ...config,
                  similarity: { ...DEFAULT_CONFIG.similarity },
                })
              }
            >
              Restore defaults
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
