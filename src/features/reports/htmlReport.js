import { APP_VERSION } from '@/types';
import { SERIES_ALL_PAIRS, BASE_COLORS, STATUS } from '@/components/charts/palette';
import { statusLabel } from '@/components/ui/display';
import { barChartSvg, escapeXml, heatmapSvg, horizontalBarSvg, lineChartSvg, scatterSvg, stackedAreaSvg, statusPillHtml, } from './svgCharts';
import { leafOrder } from '@/bio/similarity/clustering';
import { formatBytes, formatDecimal, formatInteger, formatIsoTimestamp, formatPercent, formatSequenceType, formatFileFormat, formatTimestamp, pluralize, } from '@/utils/format';
/**
 * Builds a self-contained HTML report.
 *
 * Self-contained is the requirement that drives every decision here: the file
 * must open with no network access, no JavaScript, and no sibling assets,
 * because a report that only renders while SeqLens is running is not a report.
 * So the CSS is inlined, the charts are inline SVG, and there is no script tag.
 *
 * Every chart is followed by its data as a table. That is partly the
 * accessibility requirement - three of the palette's colours fall below 3:1
 * against white and a colour scale cannot be read in a forced-colours mode -
 * and partly practical: a reader who wants to check a number should not have to
 * measure a bar.
 *
 * The analysis configuration is written out in full at the end. That is what
 * makes the report reproducible: the numbers above mean nothing without the
 * thresholds that produced them.
 */
export function buildHtmlReport(input) {
    const generatedAt = input.generatedAt ?? Date.now();
    const { project, dataset, sections } = input;
    const isProtein = dataset.sequenceType === 'protein';
    const body = [];
    body.push(headerHtml(project, dataset, generatedAt));
    if (sections.overview)
        body.push(overviewSection(dataset, input));
    if (sections.qc && input.qc)
        body.push(qcSection(input.qc, isProtein));
    if (sections.composition && input.composition) {
        body.push(compositionSection(input.composition, isProtein));
    }
    if (sections.kmer && input.composition)
        body.push(kmerSection(input.composition));
    if (sections.redundancy && (input.qc || input.similarity)) {
        body.push(redundancySection(input.qc ?? null, input.similarity ?? null));
    }
    if (sections.similarity && input.similarity)
        body.push(similaritySection(input.similarity));
    if (sections.orf && input.orf)
        body.push(orfSection(input.orf));
    if (sections.alignment && input.alignment)
        body.push(alignmentSection(input.alignment));
    if (sections.embedding && input.embedding)
        body.push(embeddingSection(input.embedding));
    body.push(configSection(input.config, input));
    body.push(footerHtml(generatedAt));
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>SeqLens report — ${escapeXml(dataset.fileName)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="page">
${body.join('\n')}
</div>
</body>
</html>`;
}
/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */
const STYLES = `
:root{--ink:#101317;--ink-2:#4d5257;--muted:#6b7280;--border:#e2e5e8;--surface:#fff;--plane:#f7f8f9;--subtle:#fafbfc;--primary:#1c5cab}
*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.page{max-width:1080px;margin:0 auto;padding:32px 24px 64px}
h1{font-size:21px;font-weight:600;letter-spacing:-.01em;margin:0 0 4px}
h2{font-size:16px;font-weight:600;letter-spacing:-.01em;margin:0;padding-bottom:8px;border-bottom:1px solid var(--border)}
h3{font-size:13px;font-weight:600;margin:0 0 6px}
p{margin:0 0 8px}
section{margin-top:28px}
.sub{color:var(--muted);font-size:12px;margin:0}
.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-top:12px}
.grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px}
.tile .label{font-size:10px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:0 0 2px}
.tile .value{font-size:19px;font-weight:600;line-height:1.2;margin:0}
.tile .detail{font-size:11px;color:var(--muted);margin:2px 0 0}
table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
caption{caption-side:top;text-align:left;font-size:11px;color:var(--muted);padding:0 0 6px}
th,td{padding:4px 8px;border-bottom:1px solid var(--border);text-align:left}
th{font-weight:500;color:var(--muted);background:var(--subtle);position:sticky;top:0}
td.num,th.num{text-align:right}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.scroll{max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:6px;margin-top:8px}
.scroll table{font-size:11px}
.scroll th,.scroll td{border-bottom:1px solid var(--border)}
.pill{display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;white-space:nowrap}
.note{background:var(--subtle);border:1px solid var(--border);border-left:3px solid var(--primary);border-radius:4px;padding:8px 12px;font-size:12px;color:var(--ink-2);margin:10px 0}
.note strong{color:var(--ink)}
.notes{margin:10px 0 0;padding-left:18px;font-size:12px;color:var(--ink-2)}
.notes li{margin-bottom:4px}
.chart{margin:10px 0 4px}
.kv{display:grid;grid-template-columns:1fr auto;gap:0 16px;font-size:12px}
.kv dt{color:var(--muted);padding:3px 0;border-bottom:1px solid var(--border)}
.kv dd{margin:0;padding:3px 0;text-align:right;font-weight:500;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums}
.check{border:1px solid var(--border);border-radius:6px;padding:10px 12px;background:var(--surface)}
.check-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}
.check-value{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.check p{font-size:11px;color:var(--muted);margin:0 0 4px;line-height:1.5}
.check .threshold{border-top:1px solid var(--border);padding-top:5px;margin:0}
.privacy{background:rgba(12,163,12,.07);border:1px solid rgba(12,163,12,.25);border-radius:6px;padding:10px 12px;font-size:12px;color:var(--ink-2);margin-top:10px}
.privacy strong{color:#067506}
footer{margin-top:36px;padding-top:12px;border-top:1px solid var(--border);font-size:11px;color:var(--muted)}
pre{background:var(--subtle);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:10.5px;line-height:1.5;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.alignment{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;white-space:pre;overflow-x:auto;background:var(--subtle);border:1px solid var(--border);border-radius:6px;padding:10px;max-height:420px;overflow-y:auto}
@media print{body{background:#fff}.page{max-width:none;padding:0}.card,.tile{break-inside:avoid}.scroll{max-height:none;overflow:visible}}
`;
/* -------------------------------------------------------------------------- */
/* Sections                                                                   */
/* -------------------------------------------------------------------------- */
function headerHtml(project, dataset, generatedAt) {
    return `<header>
<h1>SeqLens analysis report</h1>
<p class="sub">${escapeXml(project.name)} &middot; <span class="mono">${escapeXml(dataset.fileName)}</span> &middot; generated ${escapeXml(formatTimestamp(generatedAt))}</p>
<div class="privacy"><strong>Local analysis.</strong> Every figure in this report was computed in the browser on the machine that produced it. No sequence data was transmitted, no account was involved, and no telemetry was collected. This file is self-contained: it embeds its own styles and charts and needs no network access to open.</div>
</header>`;
}
function overviewSection(dataset, input) {
    const isProtein = dataset.sequenceType === 'protein';
    const stats = input.qc?.stats;
    const tiles = [
        {
            label: 'Sequences',
            value: formatInteger(dataset.sequenceCount),
            detail: `${formatInteger(dataset.minLength)} to ${formatInteger(dataset.maxLength)} ${isProtein ? 'aa' : 'bp'}`,
        },
        {
            label: isProtein ? 'Total residues' : 'Total bases',
            value: formatInteger(dataset.totalResidues),
            detail: stats ? `mean ${formatDecimal(stats.meanLength, 1)}` : undefined,
        },
        { label: 'Format', value: formatFileFormat(dataset.format), detail: formatSequenceType(dataset.sequenceType) },
        {
            label: 'File size',
            value: formatBytes(dataset.fileSize),
            detail: dataset.gzipped ? 'gzip compressed' : undefined,
        },
    ];
    if (stats) {
        tiles.push({ label: 'N50', value: formatInteger(stats.n50), detail: `N90 ${formatInteger(stats.n90)}` }, ...(isProtein
            ? []
            : [{ label: 'GC content', value: formatPercent(stats.gcPercent, 2), detail: 'over unambiguous bases' }]), {
            label: 'Duplicates',
            value: formatInteger(stats.duplicateSequences),
            detail: pluralize(stats.duplicateGroups, 'group'),
        }, {
            label: 'QC status',
            value: statusLabel(input.qc.overallStatus),
            detail: `${input.qc.checks.filter((c) => c.status === 'pass').length} of ${input.qc.checks.length} checks pass`,
        });
    }
    const issues = dataset.parseIssues.length > 0
        ? `<div class="card"><h3>Parser notes</h3><ul class="notes">${dataset.parseIssues
            .map((issue) => `<li>${issue.count > 1 ? `<strong>${formatInteger(issue.count)}×</strong> ` : ''}${escapeXml(issue.message)}</li>`)
            .join('')}</ul></div>`
        : '';
    return `<section>
<h2>Dataset overview</h2>
<div class="grid" style="margin-top:12px">${tiles.map(tileHtml).join('')}</div>
<div class="card">
<h3>File metadata</h3>
${kvHtml([
        ['Imported', formatTimestamp(dataset.importedAt)],
        ['Record format', formatFileFormat(dataset.format)],
        ['Sequence type', `${formatSequenceType(dataset.sequenceType)} (${formatPercent(dataset.typeConfidence * 100, 0)} confidence)`],
        ['Type detection', dataset.typeDetectionNote || 'Not recorded'],
        ...(dataset.qualityEncoding
            ? [['Quality encoding', dataset.qualityEncoding === 'phred64' ? 'Phred+64' : 'Phred+33']]
            : []),
        ['Compressed', dataset.gzipped ? 'Yes (gzip)' : 'No'],
        ...(dataset.decompressedSize
            ? [['Decompressed size', formatBytes(dataset.decompressedSize)]]
            : []),
        ['Stored blocks', formatInteger(dataset.blockCount)],
        ['Truncated at import', dataset.truncated ? 'Yes' : 'No'],
    ])}
</div>
${issues}
</section>`;
}
function qcSection(qc, isProtein) {
    const checks = qc.checks
        .map((check) => `<div class="check">
<div class="check-head">
<div><h3 style="margin:0">${escapeXml(check.label)}</h3><p class="check-value" style="margin:2px 0 0">${escapeXml(check.value)}</p></div>
${statusPillHtml(check.status, statusLabel(check.status))}
</div>
<p>${escapeXml(check.explanation)}</p>
<p class="threshold"><strong>Threshold:</strong> ${escapeXml(check.thresholdNote)}</p>
</div>`)
        .join('');
    const lengthChart = barChartSvg({
        title: 'Sequence length distribution',
        data: qc.lengthHistogram.map((bin) => ({
            label: formatInteger(bin.from),
            value: bin.count,
        })),
        xLabel: isProtein ? 'Residues' : 'Length (bp)',
        yLabel: 'Sequences',
    });
    const gcChart = isProtein
        ? ''
        : `<div class="card"><h3>GC content distribution</h3><div class="chart">${barChartSvg({
            title: 'GC content distribution',
            data: qc.gcHistogram.map((bin) => ({ label: String(bin.gc), value: bin.count })),
            xLabel: 'GC content (%)',
            yLabel: 'Sequences',
        })}</div>${tableHtml(['GC %', 'Sequences'], qc.gcHistogram.map((bin) => [String(bin.gc), formatInteger(bin.count)]), [false, true], 'Per-sequence GC percentage.')}</div>`;
    const qualityChart = qc.perPositionQuality.length > 0
        ? `<div class="card"><h3>Per-position quality</h3><div class="chart">${lineChartSvg({
            title: 'Per-position mean Phred score',
            x: qc.perPositionQuality.map((entry) => entry.position),
            series: [
                {
                    label: 'Mean Phred',
                    values: qc.perPositionQuality.map((entry) => entry.mean),
                },
            ],
            xLabel: 'Position in read',
            yLabel: 'Mean Phred score',
            yMax: 45,
            bands: [
                { from: 28, to: 45, color: STATUS.pass },
                { from: 20, to: 28, color: STATUS.warning },
                { from: 0, to: 20, color: STATUS.review },
            ],
        })}</div><p class="sub">Bands mark Q28 and above, Q20 to Q28, and below Q20. A decline toward the 3&prime; end is normal for every current sequencing chemistry; the absolute values are only comparable within one platform and run.</p>${tableHtml(['Position', 'Mean Phred', 'Reads covering'], qc.perPositionQuality
            .filter((_, index) => index % Math.max(1, Math.ceil(qc.perPositionQuality.length / 60)) === 0)
            .map((entry) => [
            formatInteger(entry.position),
            formatDecimal(entry.mean, 2),
            formatInteger(entry.coverage),
        ]), [true, true, true], 'Sampled every few positions for readability; the CSV export from the QC page has every position.')}</div>`
        : '';
    const positional = qc.positionalComposition.length > 0
        ? `<div class="card"><h3>Per-position base composition</h3><div class="chart">${stackedAreaSvg({
            title: 'Per-position base composition',
            x: qc.positionalComposition.map((row) => row.position),
            series: [
                { label: 'A', values: qc.positionalComposition.map((row) => row.A), color: BASE_COLORS.A },
                { label: 'C', values: qc.positionalComposition.map((row) => row.C), color: BASE_COLORS.C },
                { label: 'G', values: qc.positionalComposition.map((row) => row.G), color: BASE_COLORS.G },
                { label: 'T/U', values: qc.positionalComposition.map((row) => row.T), color: BASE_COLORS.T },
                { label: 'Other', values: qc.positionalComposition.map((row) => row.N), color: BASE_COLORS.N },
            ],
            xLabel: 'Position',
            yLabel: 'Composition (%)',
        })}</div><p class="sub">A pronounced bias across the first 10 to 15 positions of a read set is the normal signature of random priming, not a defect.</p></div>`
        : '';
    return `<section>
<h2>Quality control</h2>
<p class="sub">Overall verdict: ${statusPillHtml(qc.overallStatus, statusLabel(qc.overallStatus))} &mdash; the most severe of ${qc.checks.length} checks. "Review" means a value is far from the configured expectation, not that the data is unusable.</p>
<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'Sequences', value: formatInteger(qc.stats.sequenceCount) })}
${tileHtml({ label: isProtein ? 'Residues' : 'Bases', value: formatInteger(qc.stats.totalResidues) })}
${tileHtml({ label: 'N50', value: formatInteger(qc.stats.n50), detail: `N90 ${formatInteger(qc.stats.n90)}, L50 ${formatInteger(qc.stats.l50)}` })}
${tileHtml({ label: 'Median length', value: formatInteger(qc.stats.medianLength), detail: `mean ${formatDecimal(qc.stats.meanLength, 1)}` })}
${isProtein ? '' : tileHtml({ label: 'GC content', value: formatPercent(qc.stats.gcPercent, 2) })}
${tileHtml({ label: 'Ambiguous', value: formatPercent(qc.stats.ambiguousPercent, 3) })}
${tileHtml({ label: 'Unique', value: formatPercent(qc.stats.uniquePercent, 2), detail: `${formatInteger(qc.stats.duplicateSequences)} duplicates` })}
${tileHtml({ label: 'Mean quality', value: qc.stats.meanQuality === null ? 'N/A' : `Q${formatDecimal(qc.stats.meanQuality, 1)}` })}
</div>

<div class="card"><h3>Checks</h3><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${checks}</div></div>

${notesHtml(qc.notes)}

<div class="card"><h3>Sequence length distribution</h3><div class="chart">${lengthChart}</div>
${tableHtml(['From', 'To (exclusive)', 'Sequences'], qc.lengthHistogram.map((bin) => [
        formatInteger(bin.from),
        formatInteger(bin.to),
        formatInteger(bin.count),
    ]), [true, true, true], 'Bin bounds and counts for the chart above.')}</div>

${gcChart}
${positional}
${qualityChart}

<div class="card"><h3>${isProtein ? 'Residue' : 'Nucleotide'} composition</h3>
${tableHtml(['Residue', 'Count', 'Percent'], qc.nucleotideComposition.map((entry) => [
        entry.residue,
        formatInteger(entry.count),
        formatPercent(entry.percent, 3),
    ]), [false, true, true])}</div>

<div class="card"><h3>Flagged sequences</h3>
<p class="sub">${pluralize(qc.flaggedSequences.length, 'sequence')} triggered at least one check.${qc.flaggedSequences.length >= 500 ? ' Capped at 500 for display; the CSV export from the QC page has the rest.' : ''}</p>
${qc.flaggedSequences.length === 0
        ? '<p class="sub">No sequence triggered a per-sequence check at the configured thresholds.</p>'
        : `<div class="scroll">${tableHtml(['#', 'Identifier', 'Length', 'Flags'], qc.flaggedSequences
            .slice(0, 500)
            .map((flag) => [
            formatInteger(flag.index + 1),
            flag.id,
            formatInteger(flag.length),
            flag.flags.join(', '),
        ]), [true, false, true, false])}</div>`}
</div>
</section>`;
}
function compositionSection(composition, isProtein) {
    const nucleotideTiles = composition.nucleotide
        ? `<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'GC content', value: formatPercent(composition.nucleotide.gcPercent, 2), detail: `AT ${formatPercent(composition.nucleotide.atPercent, 2)}` })}
${tileHtml({ label: 'GC skew', value: formatDecimal(composition.nucleotide.gcSkew, 4), detail: '(G − C) / (G + C)' })}
${tileHtml({ label: 'AT skew', value: formatDecimal(composition.nucleotide.atSkew, 4) })}
${tileHtml({ label: 'CpG obs/exp', value: formatDecimal(composition.nucleotide.cpgObservedExpected, 3), detail: `${formatInteger(composition.nucleotide.cpgCount)} CpG` })}
${tileHtml({ label: 'Entropy', value: `${formatDecimal(composition.nucleotide.entropyBitsPerBase, 3)} bits`, detail: 'maximum 2 bits per base' })}
${tileHtml({ label: 'Ambiguous', value: formatPercent(composition.nucleotide.ambiguousPercent, 3) })}
</div>`
        : '';
    const proteinTiles = composition.protein
        ? `<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'Mean GRAVY', value: formatDecimal(composition.protein.aggregate.gravy, 3), detail: `${formatPercent(composition.protein.aggregate.hydrophobicFraction * 100, 1)} hydrophobic` })}
${tileHtml({ label: 'Aggregate pI', value: formatDecimal(composition.protein.aggregate.isoelectricPoint, 2) })}
${tileHtml({ label: 'Basic residues', value: formatInteger(composition.protein.aggregate.positiveResidues) })}
${tileHtml({ label: 'Acidic residues', value: formatInteger(composition.protein.aggregate.negativeResidues) })}
${tileHtml({ label: 'Aromatic residues', value: formatInteger(composition.protein.aggregate.aromaticResidues) })}
${tileHtml({ label: 'Low-complexity regions', value: formatInteger(composition.protein.lowComplexityRegions.length) })}
</div>
<div class="note"><strong>Protein property estimates.</strong> Molecular weight, isoelectric point, and GRAVY describe the unmodified polypeptide chain from its sequence alone. They exclude signal peptide cleavage, glycosylation, disulfide bond formation, and any other post-translational modification, and a computed pI commonly differs from the measured value by a few tenths of a pH unit.</div>`
        : '';
    const positional = composition.positionalComposition.length > 0 && !isProtein
        ? `<div class="card"><h3>Per-position composition</h3><div class="chart">${stackedAreaSvg({
            title: 'Per-position composition',
            x: composition.positionalComposition.map((row) => Number(row.position)),
            series: [
                { label: 'A', values: composition.positionalComposition.map((row) => Number(row.A ?? 0)), color: BASE_COLORS.A },
                { label: 'C', values: composition.positionalComposition.map((row) => Number(row.C ?? 0)), color: BASE_COLORS.C },
                { label: 'G', values: composition.positionalComposition.map((row) => Number(row.G ?? 0)), color: BASE_COLORS.G },
                { label: 'T/U', values: composition.positionalComposition.map((row) => Number(row.T ?? 0)), color: BASE_COLORS.T },
                { label: 'Other', values: composition.positionalComposition.map((row) => Number(row.N ?? 0)), color: BASE_COLORS.N },
            ],
            xLabel: 'Position',
            yLabel: 'Composition (%)',
        })}</div></div>`
        : '';
    const lowComplexity = composition.protein && composition.protein.lowComplexityRegions.length > 0
        ? `<div class="card"><h3>Low-complexity regions</h3>
<p class="sub">Windows whose residue entropy falls below the threshold, merged into maximal regions. These are common and functional in disordered proteins rather than defects.</p>
<div class="scroll">${tableHtml(['Sequence', 'Start', 'End', 'Length', 'Entropy', 'Dominant'], composition.protein.lowComplexityRegions
            .slice(0, 200)
            .map((region) => [
            region.sequenceId,
            formatInteger(region.start),
            formatInteger(region.end),
            formatInteger(region.end - region.start + 1),
            formatDecimal(region.entropy, 2),
            region.dominantResidue,
        ]), [false, true, true, true, true, false])}</div></div>`
        : '';
    return `<section>
<h2>Composition</h2>
<p class="sub">Computed over ${formatInteger(composition.sequencesAnalyzed)} sequences.</p>
${nucleotideTiles}
${proteinTiles}
${notesHtml(composition.notes)}

<div class="card"><h3>${isProtein ? 'Amino acid' : 'Residue'} composition</h3>
<div class="chart">${horizontalBarSvg({
        title: 'Residue composition',
        data: composition.residueComposition.slice(0, 26).map((entry) => ({
            label: entry.residue,
            value: entry.count,
            secondary: formatPercent(entry.percent, 2),
        })),
        maxRows: 26,
    })}</div>
${tableHtml(['Residue', 'Count', 'Percent'], composition.residueComposition.map((entry) => [
        entry.residue,
        formatInteger(entry.count),
        formatPercent(entry.percent, 4),
    ]), [false, true, true])}</div>

${positional}
${lowComplexity}
</section>`;
}
function kmerSection(composition) {
    const panels = composition.kmerSpectra
        .map((spectrum) => `<div class="card">
<h3>k = ${spectrum.k}</h3>
<div class="grid">
${tileHtml({ label: 'Distinct', value: formatInteger(spectrum.distinct), detail: `of ${formatInteger(spectrum.possible)} possible` })}
${tileHtml({ label: 'Total counted', value: formatInteger(spectrum.total) })}
${tileHtml({ label: 'Entropy', value: `${formatDecimal(spectrum.entropy, 3)} bits`, detail: `normalised ${formatDecimal(spectrum.normalizedEntropy, 3)}` })}
${tileHtml({ label: 'Rare k-mers', value: formatInteger(spectrum.rareCount) })}
${tileHtml({ label: 'Counting', value: spectrum.exact ? 'Exact table' : 'Hash map', detail: spectrum.canonical ? 'canonical' : 'forward strand' })}
</div>
<div class="chart">${horizontalBarSvg({
        title: `Most frequent ${spectrum.k}-mers`,
        data: spectrum.top.slice(0, 20).map((entry) => ({
            label: entry.kmer,
            value: entry.count,
            secondary: formatPercent(entry.frequency * 100, 3),
        })),
    })}</div>
${tableHtml(['k-mer', 'Count', 'Frequency'], spectrum.top.slice(0, 50).map((entry) => [
        entry.kmer,
        formatInteger(entry.count),
        entry.frequency.toExponential(3),
    ]), [false, true, true], `The ${Math.min(50, spectrum.top.length)} highest-count ${spectrum.k}-mers.`)}
${spectrum.rare.length > 0
        ? tableHtml(['Rare k-mer', 'Count'], spectrum.rare.slice(0, 30).map((entry) => [entry.kmer, formatInteger(entry.count)]), [false, true], `A sample of the ${formatInteger(spectrum.rareCount)} k-mers at or below the rare threshold. In a random sequence of this length, rare k-mers are expected at large k; a k-mer absent entirely can indicate a restriction site.`)
        : ''}
</div>`)
        .join('');
    return `<section>
<h2>k-mer analysis</h2>
<p class="sub">Exact counts over ${formatInteger(composition.sequencesAnalyzed)} sequences. Windows containing an ambiguous residue are skipped rather than counted, because a k-mer spanning an N is not a k-mer of any known sequence.</p>
${panels}
</section>`;
}
function redundancySection(qc, similarity) {
    const groups = similarity?.exactDuplicateGroups ?? qc?.duplicateGroups ?? [];
    const duplicateSequences = qc?.stats.duplicateSequences ?? groups.reduce((sum, g) => sum + g.count - 1, 0);
    const total = qc?.stats.sequenceCount ?? similarity?.totalSequences ?? 0;
    const histogram = qc?.duplicateHistogram ?? [];
    return `<section>
<h2>Redundancy</h2>
<p class="sub">Exact duplicates are byte-identical residue strings, grouped by a 64-bit hash and then confirmed by direct comparison, so a hash collision costs a wasted comparison rather than a wrong count. This covers every sequence in the dataset.</p>
<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'Duplicate sequences', value: formatInteger(duplicateSequences), detail: total > 0 ? formatPercent((duplicateSequences / total) * 100, 2) : undefined })}
${tileHtml({ label: 'Duplicate groups', value: formatInteger(groups.length) })}
${tileHtml({ label: 'Unique', value: total > 0 ? formatPercent(((total - duplicateSequences) / total) * 100, 2) : '-' })}
${tileHtml({ label: 'Largest group', value: formatInteger(groups[0]?.count ?? 0), detail: groups[0] ? `${formatInteger(groups[0].length)} residues` : undefined })}
</div>
<div class="note"><strong>Duplication is not automatically a defect.</strong> Exact duplication is expected in amplicon panels, in high-depth RNA-seq of abundant transcripts, and in any dataset of short reads where the sequence space is small. It is a red flag mainly for low-depth shotgun libraries.</div>
${histogram.length > 0
        ? `<div class="card"><h3>Duplicate group sizes</h3><div class="chart">${barChartSvg({
            title: 'Duplicate group sizes',
            data: histogram.map((bin) => ({ label: String(bin.copies), value: bin.groups })),
            xLabel: 'Copies per group',
            yLabel: 'Groups',
        })}</div>${tableHtml(['Copies', 'Groups', 'Sequences'], histogram.map((bin) => [
            formatInteger(bin.copies),
            formatInteger(bin.groups),
            formatInteger(bin.sequences),
        ]), [true, true, true])}</div>`
        : ''}
${groups.length > 0
        ? `<div class="card"><h3>Duplicate groups</h3><div class="scroll">${tableHtml(['Copies', 'Length', 'Hash', 'Identifiers'], groups
            .slice(0, 200)
            .map((group) => [
            formatInteger(group.count),
            formatInteger(group.length),
            group.hash.slice(0, 12),
            group.ids.join(', ') +
                (group.count > group.ids.length ? ` and ${formatInteger(group.count - group.ids.length)} more` : ''),
        ]), [true, true, false, false])}</div></div>`
        : '<p class="sub">No exact duplicates were found.</p>'}
</section>`;
}
function similaritySection(similarity) {
    const order = leafOrder(similarity.dendrogram);
    return `<section>
<h2>Similarity and clustering</h2>
<p class="sub">${similarity.sampled ? `A deterministic length-stratified sample of ${formatInteger(similarity.members.length)} of ${formatInteger(similarity.totalSequences)} sequences was compared.` : `All ${formatInteger(similarity.members.length)} sequences were compared.`} Jaccard values are MinHash estimates from ${formatInteger(similarity.configSnapshot.sketchSize)} hashes of ${similarity.configSnapshot.sketchK}-mers.</p>
<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'Clusters', value: formatInteger(similarity.clusters.length), detail: `${similarity.configSnapshot.linkage} linkage at ${formatDecimal(similarity.configSnapshot.clusterThreshold, 2)}` })}
${tileHtml({ label: 'Redundant fraction', value: formatPercent(similarity.stats.redundantFraction * 100, 1) })}
${tileHtml({ label: 'Mean Jaccard', value: formatDecimal(similarity.stats.meanJaccard, 4), detail: `median ${formatDecimal(similarity.stats.medianJaccard, 4)}` })}
${tileHtml({ label: 'Max Jaccard', value: formatDecimal(similarity.stats.maxJaccard, 4) })}
${tileHtml({ label: 'Pairs compared', value: formatInteger(similarity.stats.pairsCompared) })}
${tileHtml({ label: 'Pairs refined', value: formatInteger(similarity.stats.pairsRefined), detail: 'by exact alignment' })}
</div>

<div class="note"><strong>Estimate versus measurement.</strong> The Jaccard column is a sketch estimate with a standard error of roughly ${formatDecimal(Math.sqrt(0.25 / Math.max(1, similarity.configSnapshot.sketchSize)), 3)} at a true similarity of 0.5, so differences smaller than that between pairs are not meaningful. The identity column, where present, is a real alignment measurement.</div>

${notesHtml(similarity.notes)}

<div class="card"><h3>Similarity matrix</h3>
<p class="sub">Rows are ordered by the clustering tree, so related sequences sit adjacent and block structure is visible. Colour is a single-hue sequential scale because the encoded value is magnitude.</p>
<div class="chart">${heatmapSvg({
        title: 'Similarity matrix',
        matrix: similarity.matrix,
        size: similarity.matrixSize,
        order: order.length === similarity.matrixSize ? order : undefined,
    })}</div></div>

<div class="card"><h3>Clusters</h3><div class="scroll">${tableHtml(['Cluster', 'Members', 'Representative', 'Mean Jaccard', 'Member identifiers'], similarity.clusters.map((cluster) => [
        formatInteger(cluster.clusterId + 1),
        formatInteger(cluster.memberIndices.length),
        cluster.representativeId,
        formatDecimal(cluster.meanSimilarity, 3),
        cluster.memberIndices
            .slice(0, 8)
            .map((index) => similarity.members[index]?.id ?? '')
            .join(', ') +
            (cluster.memberIndices.length > 8
                ? ` and ${formatInteger(cluster.memberIndices.length - 8)} more`
                : ''),
    ]), [true, true, false, true, false], 'The representative is the longest member, which is what a redundancy-reduction step would retain.')}</div></div>

<div class="card"><h3>Most similar pairs</h3><div class="scroll">${tableHtml(['Sequence A', 'Sequence B', 'Jaccard (est.)', 'Identity (aligned)'], similarity.topPairs
        .slice(0, 100)
        .map((pair) => [
        similarity.members[pair.a]?.id ?? '',
        similarity.members[pair.b]?.id ?? '',
        formatDecimal(pair.jaccard, 4),
        pair.identity === undefined
            ? 'not aligned'
            : `${formatPercent(pair.identity * 100, 1)} over ${formatInteger(pair.alignedLength ?? 0)}`,
    ]), [false, false, true, true])}</div></div>
</section>`;
}
function orfSection(orf) {
    return `<section>
<h2>Open reading frames</h2>
<p class="sub">Genetic code ${orf.configSnapshot.geneticCode}, minimum ${formatInteger(orf.configSnapshot.minAminoAcids)} amino acids, ${orf.configSnapshot.requireStartCodon ? 'initiation codon required' : 'scanning stop to stop'}${orf.configSnapshot.searchReverseStrand ? ', both strands' : ', forward strand only'}. One ORF is reported per stop codon.</p>
<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'ORFs found', value: formatInteger(orf.stats.orfCount), detail: `in ${formatInteger(orf.stats.sequencesWithOrf)} of ${formatInteger(orf.stats.sequencesScanned)} sequences` })}
${tileHtml({ label: 'Longest', value: `${formatInteger(orf.stats.maxOrfLength)} aa` })}
${tileHtml({ label: 'Median length', value: `${formatInteger(orf.stats.medianOrfLength)} aa`, detail: `mean ${formatDecimal(orf.stats.meanOrfLength, 1)}` })}
${tileHtml({ label: 'Coding bases', value: formatInteger(orf.stats.totalCodingBases), detail: formatPercent(orf.stats.codingFraction * 100, 1) })}
</div>

${notesHtml(orf.notes)}

<div class="card"><h3>ORF length distribution</h3><div class="chart">${barChartSvg({
        title: 'ORF length distribution',
        data: orf.lengthHistogram.map((bin) => ({ label: formatInteger(bin.from), value: bin.count })),
        xLabel: 'ORF length (amino acids)',
        yLabel: 'ORFs',
    })}</div>
<p class="sub">In non-coding sequence, stop codons occur roughly every 21 codons by chance, so a long right tail is what distinguishes real coding sequence from noise.</p></div>

<div class="card"><h3>ORFs per frame</h3><div class="chart">${barChartSvg({
        title: 'ORFs per frame',
        data: orf.perFrameCounts.map((entry) => ({
            label: entry.frame,
            value: entry.count,
            color: entry.frame.startsWith('+') ? SERIES_ALL_PAIRS[0] : SERIES_ALL_PAIRS[1],
        })),
        xLabel: 'Strand and frame',
        yLabel: 'ORFs',
    })}</div>
${tableHtml(['Frame', 'ORFs'], orf.perFrameCounts.map((entry) => [entry.frame, formatInteger(entry.count)]), [false, true])}</div>

<div class="card"><h3>Codon usage</h3>
${tableHtml(['Start codon', 'ORFs'], orf.startCodonUsage.map((entry) => [entry.codon, formatInteger(entry.count)]), [false, true])}
${tableHtml(['Stop codon', 'ORFs'], orf.stopCodonUsage.map((entry) => [entry.codon, formatInteger(entry.count)]), [false, true], 'Stop codon preference differs between organisms: TAA dominates in AT-rich genomes and TGA in GC-rich ones.')}</div>

<div class="card"><h3>Longest ORFs</h3><div class="scroll">${tableHtml(['Sequence', 'Frame', 'Start', 'End', 'Length (aa)', 'Start codon', 'Stop codon'], orf.orfs
        .slice(0, 200)
        .map((entry) => [
        entry.sequenceId,
        `${entry.strand}${entry.frame}`,
        formatInteger(entry.start),
        formatInteger(entry.end),
        formatInteger(entry.aminoAcidLength),
        entry.startCodon,
        entry.stopCodon ?? 'partial',
    ]), [false, false, true, true, true, false, false], 'Coordinates are 1-based, inclusive, and on the forward strand of the input sequence for both strands, so they can be drawn on one axis.')}</div></div>
</section>`;
}
function alignmentSection(alignment) {
    // Alignment blocks as preformatted text: 60 columns per block, the
    // convention every alignment tool uses.
    const width = 60;
    const nameWidth = Math.min(24, Math.max(12, ...alignment.rows.map((row) => row.id.length)));
    const blocks = [];
    const maxBlocks = 40;
    for (let from = 0; from < alignment.stats.alignmentLength && blocks.length < maxBlocks; from += width) {
        const lines = alignment.rows.map((row) => 
        // Pad before escaping: the identifier comes from the user's file, and
        // padding an escaped string would count `&lt;` as four columns.
        `${escapeXml(row.id.slice(0, nameWidth).padEnd(nameWidth))} ${escapeXml(row.aligned.slice(from, from + width))}`);
        const marks = alignment.columns
            .slice(from, from + width)
            .map((column) => column.conservation >= 1
            ? '*'
            : column.conservation >= 0.8
                ? ':'
                : column.conservation >= 0.5
                    ? '.'
                    : ' ')
            .join('');
        lines.push(`${'consensus'.padEnd(nameWidth)} ${escapeXml(alignment.consensus.slice(from, from + width))}`);
        lines.push(`${''.padEnd(nameWidth)} ${marks}`);
        blocks.push(`${lines.join('\n')}\n`);
    }
    const truncated = alignment.stats.alignmentLength > maxBlocks * width
        ? `<p class="sub">Showing the first ${formatInteger(maxBlocks * width)} of ${formatInteger(alignment.stats.alignmentLength)} columns. The full alignment is available as an aligned-FASTA or CLUSTAL export from the Alignment page.</p>`
        : '';
    return `<section>
<h2>Alignment</h2>
<p class="sub">${alignment.method === 'pairwise-gotoh' ? `Optimal ${alignment.configSnapshot.mode} alignment with affine gap costs (Gotoh).` : 'Center-star progressive alignment: each sequence aligned to a central sequence, then merged into one layout. This is a heuristic - columns where the centre is gapped carry no information about how the other sequences relate to each other.'}</p>
<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'Sequences', value: formatInteger(alignment.stats.sequences) })}
${tileHtml({ label: 'Alignment length', value: formatInteger(alignment.stats.alignmentLength) })}
${tileHtml({ label: 'Mean identity', value: formatPercent(alignment.stats.meanPairwiseIdentity * 100, 1) })}
${tileHtml({ label: 'Gap fraction', value: formatPercent(alignment.stats.gapFraction * 100, 1) })}
${tileHtml({ label: 'Substitutions', value: formatInteger(alignment.stats.substitutions) })}
${tileHtml({ label: 'Indels', value: formatInteger(alignment.stats.insertions + alignment.stats.deletions), detail: `${formatInteger(alignment.stats.insertions)} ins, ${formatInteger(alignment.stats.deletions)} del` })}
</div>

${notesHtml(alignment.notes)}

<div class="card"><h3>Alignment</h3>
<p class="sub">Conservation marks below each block: <span class="mono">*</span> fully conserved, <span class="mono">:</span> at or above 80%, <span class="mono">.</span> at or above 50%.</p>
<div class="alignment">${blocks.join('\n')}</div>
${truncated}</div>

<div class="card"><h3>Conserved and variable regions</h3>
${tableHtml(['Type', 'Start', 'End', 'Length', 'Mean conservation'], [
        ...alignment.conservedRegions.map((region) => [
            'Conserved',
            formatInteger(region.start),
            formatInteger(region.end),
            formatInteger(region.end - region.start + 1),
            formatPercent(region.meanConservation * 100, 1),
        ]),
        ...alignment.variableRegions.map((region) => [
            'Variable',
            formatInteger(region.start),
            formatInteger(region.end),
            formatInteger(region.end - region.start + 1),
            formatPercent(region.meanConservation * 100, 1),
        ]),
    ], [false, true, true, true, true], `Runs of at least three consecutive columns. Conservation is measured over non-gap residues only, and the gap fraction is reported per column separately, so a column with two residues and many gaps is not mistaken for a well-supported one.`)}</div>

${alignment.variants.length > 0
        ? `<div class="card"><h3>Variants</h3><div class="scroll">${tableHtml(['Column', 'Type', 'Reference', 'Observed', 'Sequences'], alignment.variants
            .slice(0, 300)
            .map((variant) => [
            formatInteger(variant.column),
            variant.kind,
            variant.reference,
            variant.observed,
            formatInteger(variant.count),
        ]), [true, false, false, false, true], `Per-column differences from "${escapeXml(alignment.rows[0]?.id ?? 'the reference')}". Consecutive columns are not merged into multi-base events.`)}</div></div>`
        : ''}
</section>`;
}
function embeddingSection(embedding) {
    return `<section>
<h2>Embeddings</h2>
<p class="sub">${escapeXml(embedding.providerName)}, ${formatInteger(embedding.dimensions)} dimensions, reduced by ${embedding.reduction.toUpperCase()}. ${embedding.sampled ? `Sampled ${formatInteger(embedding.points.length)} of ${formatInteger(embedding.totalSequences)} sequences.` : `All ${formatInteger(embedding.points.length)} sequences embedded.`}</p>
<div class="grid" style="margin-top:12px">
${tileHtml({ label: 'Provider', value: embedding.providerName })}
${tileHtml({ label: 'Dimensions', value: formatInteger(embedding.dimensions) })}
${tileHtml({ label: 'Reduction', value: embedding.reduction.toUpperCase(), detail: embedding.reduction === 'pca' && embedding.explainedVariance.length >= 2 ? `${formatPercent((embedding.explainedVariance[0] + embedding.explainedVariance[1]) * 100, 1)} of variance` : `seed ${embedding.configSnapshot.seed}` })}
${tileHtml({ label: 'Clusters', value: formatInteger(embedding.clusterSummary.filter((entry) => entry.size > 0).length) })}
</div>

${notesHtml(embedding.notes)}

<div class="card"><h3>2-D projection</h3>
<div class="chart">${scatterSvg({
        title: '2-D embedding projection',
        points: embedding.points.map((point) => ({ x: point.x, y: point.y, group: point.cluster })),
        colors: [...SERIES_ALL_PAIRS],
        xLabel: embedding.reduction === 'pca' ? 'PC1' : 'UMAP 1',
        yLabel: embedding.reduction === 'pca' ? 'PC2' : 'UMAP 2',
    })}</div>
<p class="sub">${embedding.reduction === 'umap' ? 'UMAP axes have no units: which points are near each other is meaningful, but the distance between two well-separated clusters is not, and neither is the orientation.' : 'PCA axes are the directions of greatest variance in the embedding space, so distances are meaningful, but only the variance captured by these two components is visible.'} Clusters beyond the fourth reuse the four hues, because a fifth would not stay distinguishable when any two points can sit adjacent; the table below disambiguates them.</p></div>

<div class="card"><h3>Cluster summary</h3>
${tableHtml(['Cluster', 'Size', 'Mean GC %', 'Mean length'], embedding.clusterSummary.map((entry) => [
        formatInteger(entry.cluster + 1),
        entry.size === 0 ? 'empty' : formatInteger(entry.size),
        entry.size === 0 ? '-' : formatDecimal(entry.meanGc, 1),
        entry.size === 0 ? '-' : formatInteger(Math.round(entry.meanLength)),
    ]), [true, true, true, true], 'Clusters come from k-means on the full-dimensional vectors, not on the 2-D projection, so a cluster can appear split in the plot. k-means always returns the number of clusters requested, whether or not the data has that many.')}</div>

<div class="card"><h3>Coordinates</h3><div class="scroll">${tableHtml(['Identifier', 'Cluster', 'Length', 'GC %', 'X', 'Y'], embedding.points
        .slice(0, 500)
        .map((point) => [
        point.id,
        formatInteger(point.cluster + 1),
        formatInteger(point.length),
        formatDecimal(point.gcPercent, 2),
        formatDecimal(point.x, 4),
        formatDecimal(point.y, 4),
    ]), [false, true, true, true, true, true], embedding.points.length > 500
        ? `The first 500 of ${formatInteger(embedding.points.length)} points. The CSV export from the Embeddings page has all of them.`
        : undefined)}</div></div>
</section>`;
}
/**
 * Configuration appendix.
 *
 * This is what makes the report reproducible. Every threshold that influenced
 * a verdict or a computed value is written out, so a reader can tell whether a
 * "review" verdict reflects the data or the settings, and can reproduce the run
 * from the same inputs.
 */
function configSection(config, input) {
    const provenance = [
        ['Report generated', formatTimestamp(input.generatedAt ?? Date.now())],
        ['ISO timestamp', formatIsoTimestamp(input.generatedAt ?? Date.now())],
        ['SeqLens version', APP_VERSION],
        ['Project', input.project.name],
        ['Dataset', input.dataset.fileName],
        ['Dataset imported', formatTimestamp(input.dataset.importedAt)],
        ...(input.qc ? [['QC computed', formatTimestamp(input.qc.computedAt)]] : []),
        ...(input.composition
            ? [['Composition computed', formatTimestamp(input.composition.computedAt)]]
            : []),
        ...(input.similarity
            ? [['Similarity computed', formatTimestamp(input.similarity.computedAt)]]
            : []),
        ...(input.orf ? [['ORF computed', formatTimestamp(input.orf.computedAt)]] : []),
        ...(input.alignment
            ? [['Alignment computed', formatTimestamp(input.alignment.computedAt)]]
            : []),
        ...(input.embedding
            ? [['Embedding computed', formatTimestamp(input.embedding.computedAt)]]
            : []),
    ];
    return `<section>
<h2>Analysis parameters</h2>
<p class="sub">Every threshold that influenced a number in this report. None of these values are biologically universal: they are the settings that produced these results, recorded so the run can be reproduced and so a reader can tell whether a verdict reflects the data or the configuration.</p>
<div class="card"><h3>Provenance</h3>${kvHtml(provenance)}</div>
<div class="card"><h3>Configuration</h3>
<pre>${escapeXml(JSON.stringify(config, null, 2))}</pre></div>
</section>`;
}
function footerHtml(generatedAt) {
    return `<footer>
<p>Generated by SeqLens ${escapeXml(APP_VERSION)} on ${escapeXml(formatTimestamp(generatedAt))}.</p>
<p>This report is a single self-contained file: its styles and charts are embedded, it contains no JavaScript, and it needs no network access to open. Every figure in it was computed locally in the browser; no sequence data was transmitted at any point.</p>
</footer>`;
}
/* -------------------------------------------------------------------------- */
/* HTML helpers                                                               */
/* -------------------------------------------------------------------------- */
function tileHtml(tile) {
    return `<div class="tile"><p class="label">${escapeXml(tile.label)}</p><p class="value">${escapeXml(tile.value)}</p>${tile.detail ? `<p class="detail">${escapeXml(tile.detail)}</p>` : ''}</div>`;
}
function kvHtml(rows) {
    return `<dl class="kv">${rows
        .map(([label, value]) => `<dt>${escapeXml(label)}</dt><dd>${escapeXml(value)}</dd>`)
        .join('')}</dl>`;
}
function tableHtml(headers, rows, numeric, caption) {
    if (rows.length === 0) {
        return `<p class="sub">${caption ? `${escapeXml(caption)} ` : ''}No rows.</p>`;
    }
    return `<table>${caption ? `<caption>${escapeXml(caption)}</caption>` : ''}
<thead><tr>${headers
        .map((header, index) => `<th${numeric[index] ? ' class="num"' : ''}>${escapeXml(header)}</th>`)
        .join('')}</tr></thead>
<tbody>${rows
        .map((row) => `<tr>${row
        .map((cell, index) => `<td${numeric[index] ? ' class="num"' : ''}>${escapeXml(String(cell))}</td>`)
        .join('')}</tr>`)
        .join('')}</tbody></table>`;
}
function notesHtml(notes) {
    if (notes.length === 0)
        return '';
    return `<div class="note"><strong>How to read these numbers</strong><ul class="notes">${notes
        .map((note) => `<li>${escapeXml(note)}</li>`)
        .join('')}</ul></div>`;
}
