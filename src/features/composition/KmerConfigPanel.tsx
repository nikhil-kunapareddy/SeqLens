import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { MAX_DENSE_K, MAX_PACKED_K } from '@/bio/kmer/counter';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/display';
import { Input, Label, Switch } from '@/components/ui/primitives';
import {
  selectActiveConfig,
  selectActiveDataset,
  selectActiveProject,
  useProjectStore,
} from '@/state/projectStore';
import { cn } from '@/utils/cn';
import { formatBytes, formatInteger } from '@/utils/format';

const SELECTABLE_K = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/**
 * k-mer and composition configuration.
 *
 * The memory estimate is the point of this panel. k = 11 needs a 16 MB counting
 * table and k = 12 needs 64 MB, so the cost of raising k by one is not obvious
 * from the number itself. Showing the figure before the run is cheaper than
 * an out-of-memory failure during it.
 */
export function KmerConfigPanel({ className }: { className?: string }) {
  const project = useProjectStore(selectActiveProject);
  const dataset = useProjectStore(selectActiveDataset);
  const config = useProjectStore(selectActiveConfig);
  const updateConfig = useProjectStore((state) => state.updateConfig);
  const [open, setOpen] = useState(false);

  if (project === null) return null;

  const isProtein = dataset?.sequenceType === 'protein';
  const maxK = isProtein ? 5 : MAX_PACKED_K;
  const selected = config.composition.kValues;

  const setComposition = (changes: Partial<typeof config.composition>) => {
    void updateConfig(project.id, {
      ...config,
      composition: { ...config.composition, ...changes },
    });
  };

  const toggleK = (k: number) => {
    const next = selected.includes(k)
      ? selected.filter((value) => value !== k)
      : [...selected, k].sort((a, b) => a - b);
    if (next.length === 0) return; // at least one k must remain
    setComposition({ kValues: next });
  };

  /** Dense counting-table bytes for a given k, or null when a map is used. */
  const tableBytes = (k: number): number | null => {
    if (isProtein) return null;
    if (k > MAX_DENSE_K) return null;
    return 4 ** k * 4;
  };

  const totalBytes = selected.reduce((sum, k) => sum + (tableBytes(k) ?? 0), 0);
  const heaviestK = Math.max(...selected);

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
            k-mer configuration
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            k = {selected.join(', ')} &middot; top {formatInteger(config.composition.topKmers)} per k
            &middot; rare at or below {formatInteger(config.composition.rareKmerMaxCount)}
            {config.composition.canonicalKmers ? ' · canonical' : ''}
            {totalBytes > 0 ? ` · ${formatBytes(totalBytes)} of counting tables` : ''}
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
          <div className="space-y-2">
            <Label>k values</Label>
            <div className="flex flex-wrap gap-1.5">
              {SELECTABLE_K.filter((k) => k <= maxK).map((k) => {
                const active = selected.includes(k);
                const bytes = tableBytes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => toggleK(k)}
                    title={
                      bytes === null
                        ? `k = ${k} uses a sparse hash map, so memory scales with the number of distinct k-mers observed rather than with 4^k.`
                        : `k = ${k} uses an exact ${formatBytes(bytes)} counting table (4^${k} slots).`
                    }
                    className={cn(
                      'flex h-8 min-w-9 items-center justify-center rounded-md border px-2 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    aria-pressed={active}
                  >
                    {k}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {isProtein
                ? `Protein k-mers use substring keys over the 20-letter alphabet, so k is capped at ${maxK}: at k = 6 the space is 64 million and a single dataset populates almost none of it.`
                : `Nucleotide k-mers are packed into 2-bit codes. Up to k = ${MAX_DENSE_K} SeqLens uses an exact dense table; above that it switches to a hash map, which is slower per k-mer but scales with what is actually observed.`}
            </p>
            {!isProtein && heaviestK >= MAX_DENSE_K ? (
              <Alert variant="warning" title={`k = ${heaviestK} is memory-intensive`}>
                The dense counting table for k = {heaviestK} is{' '}
                {formatBytes(tableBytes(heaviestK) ?? 0)}. A browser tab is typically limited to
                2-4 GB regardless of machine RAM, so combining several large k values in one run
                can exhaust it. Run them one at a time if the analysis fails.
              </Alert>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="top-kmers">Top k-mers retained</Label>
              <Input
                id="top-kmers"
                type="number"
                min={5}
                max={2000}
                step={5}
                value={config.composition.topKmers}
                onChange={(event) =>
                  setComposition({
                    topKmers: Math.max(5, Math.min(2000, Number(event.target.value) || 50)),
                  })
                }
                className="h-7 max-w-28 text-xs"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                How many of the highest-count k-mers are returned for display and export. The
                spectrum statistics always describe every k-mer, not just these.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="rare-threshold">Rare k-mer threshold</Label>
              <Input
                id="rare-threshold"
                type="number"
                min={0}
                max={100}
                step={1}
                value={config.composition.rareKmerMaxCount}
                onChange={(event) =>
                  setComposition({
                    rareKmerMaxCount: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                  })
                }
                className="h-7 max-w-28 text-xs"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                k-mers at or below this count are reported as rare. In a random sequence most
                k-mers are rare at large k, so this is only informative relative to the sequence
                length.
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Switch
                  id="canonical"
                  checked={config.composition.canonicalKmers}
                  onCheckedChange={(checked) => setComposition({ canonicalKmers: checked })}
                  disabled={isProtein}
                />
                <Label htmlFor="canonical" className="cursor-pointer">
                  Canonical k-mers
                </Label>
                {isProtein ? <Badge variant="neutral">DNA only</Badge> : null}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Merges each k-mer with its reverse complement into one count. Correct for
                double-stranded DNA where strand orientation is arbitrary; wrong for strand-specific
                RNA-seq, where the strand carries information.
              </p>
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-3">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void updateConfig(project.id, {
                  ...config,
                  composition: { ...DEFAULT_CONFIG.composition },
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
