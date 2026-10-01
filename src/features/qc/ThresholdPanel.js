import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_CONFIG } from '@/bio/defaults';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert } from '@/components/ui/display';
import { Input, Label } from '@/components/ui/primitives';
import { selectActiveConfig, selectActiveProject, useProjectStore } from '@/state/projectStore';
import { cn } from '@/utils/cn';
const FIELDS = [
    {
        key: 'minLength',
        label: 'Short-sequence floor',
        description: 'Sequences at or below this length are flagged as extremely short. The right floor depends entirely on the assay: 50 is reasonable for assembled contigs and wrong for a 35 bp small-RNA library.',
        unit: 'residues',
        min: 0,
        max: 100_000,
        step: 1,
    },
    {
        key: 'maxLength',
        label: 'Long-sequence ceiling',
        description: 'Sequences at or above this length are flagged. Useful for catching concatenated records; leave high for assemblies.',
        unit: 'residues',
        min: 100,
        max: 1_000_000_000,
        step: 1000,
    },
    {
        key: 'ambiguousWarn',
        label: 'Ambiguity warning',
        description: 'Per-sequence ambiguous-residue fraction that raises a warning. Assembly gaps are legitimately long runs of N, so a scaffolded assembly can exceed this by design.',
        unit: '%',
        min: 0,
        max: 100,
        step: 0.1,
        asPercent: true,
    },
    {
        key: 'ambiguousReview',
        label: 'Ambiguity review',
        description: 'Fraction at which the check escalates from warning to review.',
        unit: '%',
        min: 0,
        max: 100,
        step: 0.1,
        asPercent: true,
    },
    {
        key: 'duplicateWarn',
        label: 'Duplicate warning',
        description: 'Dataset duplicate fraction that raises a warning. Expected to be high in amplicon panels and in deeply sequenced RNA-seq; a red flag mainly in low-depth shotgun libraries.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        asPercent: true,
    },
    {
        key: 'duplicateReview',
        label: 'Duplicate review',
        description: 'Fraction at which the duplicate check escalates to review.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
        asPercent: true,
    },
    {
        key: 'gcLowWarn',
        label: 'GC lower bound',
        description: 'GC percentage below which a warning is raised. Genomic GC spans roughly 17% to 75% across sequenced organisms, so this band is a generic sanity check rather than an expectation.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
    },
    {
        key: 'gcHighWarn',
        label: 'GC upper bound',
        description: 'GC percentage above which a warning is raised.',
        unit: '%',
        min: 0,
        max: 100,
        step: 1,
    },
    {
        key: 'homopolymerMinRun',
        label: 'Homopolymer run length',
        description: 'Shortest run of one repeated residue counted as a homopolymer. Long homopolymers are real genomic features and also where nanopore and ion semiconductor chemistries make the most errors.',
        unit: 'residues',
        min: 3,
        max: 500,
        step: 1,
    },
    {
        key: 'lowComplexityEntropy',
        label: 'Low-complexity entropy',
        description: 'Shannon entropy in bits per residue below which a sequence is called low-complexity. The maximum is 2 bits for DNA and about 4.32 for protein; the threshold is scaled to the alphabet.',
        unit: 'bits',
        min: 0,
        max: 4.5,
        step: 0.05,
    },
    {
        key: 'lowComplexityWindow',
        label: 'Low-complexity window',
        description: 'Window size for the sliding scan that locates low-complexity regions in the Composition module.',
        unit: 'residues',
        min: 8,
        max: 512,
        step: 8,
    },
    {
        key: 'meanQualityWarn',
        label: 'Mean quality warning',
        description: 'Mean read Phred score below which a warning is raised. Q20 is a 1-in-100 error rate, Q30 is 1-in-1000. FASTQ only.',
        unit: 'Phred',
        min: 0,
        max: 60,
        step: 1,
    },
    {
        key: 'meanQualityReview',
        label: 'Mean quality review',
        description: 'Mean read Phred score at which the quality check escalates to review.',
        unit: 'Phred',
        min: 0,
        max: 60,
        step: 1,
    },
];
/**
 * QC threshold editor.
 *
 * Thresholds live on the project, not in interface state, so the values that
 * produced a stored result travel with it. Changing one invalidates the QC
 * cache for that project's datasets - which is correct, because the verdicts
 * would otherwise disagree with the thresholds on display.
 *
 * Every field carries a sentence explaining what the number means and why the
 * default is not universal. The panel is collapsed by default: these are not
 * knobs most readers need to touch, but they must be visible to anyone who
 * wants to know where a verdict came from.
 */
export function ThresholdPanel({ className }) {
    const project = useProjectStore(selectActiveProject);
    const config = useProjectStore(selectActiveConfig);
    const updateConfig = useProjectStore((state) => state.updateConfig);
    const [open, setOpen] = useState(false);
    if (project === null)
        return null;
    const setValue = (field, raw) => {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed))
            return;
        const clamped = Math.max(field.min, Math.min(field.max, parsed));
        const stored = field.asPercent ? clamped / 100 : clamped;
        void updateConfig(project.id, {
            ...config,
            qc: { ...config.qc, [field.key]: stored },
        });
    };
    const changedFields = FIELDS.filter((field) => config.qc[field.key] !== DEFAULT_CONFIG.qc[field.key]);
    return (_jsxs(Card, { className: cn('overflow-hidden', className), children: [_jsxs("button", { type: "button", onClick: () => setOpen((previous) => !previous), className: "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50", "aria-expanded": open, children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-[13px] font-semibold tracking-tight text-foreground", children: "QC thresholds" }), _jsx("p", { className: "mt-0.5 text-xs leading-relaxed text-muted-foreground", children: changedFields.length === 0
                                    ? 'Using the default thresholds. None of them are biologically universal.'
                                    : `${changedFields.length} threshold${changedFields.length === 1 ? '' : 's'} changed from the default: ${changedFields.map((f) => f.label).join(', ')}.` })] }), _jsx(ChevronDown, { className: cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180'), "aria-hidden": true })] }), open ? (_jsxs("div", { className: "space-y-3 border-t border-border px-4 py-4", children: [_jsx(Alert, { variant: "note", title: "These values are inspection starting points", children: "A GC content that is normal for one organism is an outlier for another, and duplicate rates that signal PCR artefacts in shotgun data are expected in amplicon panels. Changing a threshold here changes which sequences are flagged and clears the cached QC result for this project, so the next run recomputes the verdicts." }), _jsx("div", { className: "grid gap-x-6 gap-y-3 md:grid-cols-2", children: FIELDS.map((field) => {
                            const stored = config.qc[field.key];
                            const displayed = field.asPercent ? stored * 100 : stored;
                            const isDefault = stored === DEFAULT_CONFIG.qc[field.key];
                            return (_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-baseline justify-between gap-2", children: [_jsx(Label, { htmlFor: `qc-${field.key}`, children: field.label }), isDefault ? null : (_jsx("button", { type: "button", onClick: () => void updateConfig(project.id, {
                                                    ...config,
                                                    qc: { ...config.qc, [field.key]: DEFAULT_CONFIG.qc[field.key] },
                                                }), className: "text-[10px] text-primary hover:underline", children: "reset" }))] }), _jsxs("div", { className: "flex items-center gap-1.5", children: [_jsx(Input, { id: `qc-${field.key}`, type: "number", value: Number.isInteger(displayed) ? displayed : Number(displayed.toFixed(3)), min: field.min, max: field.max, step: field.step, onChange: (event) => setValue(field, event.target.value), className: "h-7 max-w-32 text-xs" }), field.unit ? (_jsx("span", { className: "text-[11px] whitespace-nowrap text-muted-foreground", children: field.unit })) : null] }), _jsx("p", { className: "text-[11px] leading-relaxed text-muted-foreground", children: field.description })] }, field.key));
                        }) }), _jsx("div", { className: "flex justify-end border-t border-border pt-3", children: _jsxs(Button, { size: "sm", variant: "outline", onClick: () => void updateConfig(project.id, { ...config, qc: { ...DEFAULT_CONFIG.qc } }), disabled: changedFields.length === 0, children: [_jsx(RotateCcw, {}), "Restore all defaults"] }) })] })) : null] }));
}
