# SeqLens

[![CI](https://github.com/nikhil-kunapareddy/SeqLens/actions/workflows/ci.yml/badge.svg)](https://github.com/nikhil-kunapareddy/SeqLens/actions/workflows/ci.yml)
[![Security](https://github.com/nikhil-kunapareddy/SeqLens/actions/workflows/security.yml/badge.svg)](https://github.com/nikhil-kunapareddy/SeqLens/actions/workflows/security.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Local sequence intelligence.** A sequence-analysis workstation for FASTA and FASTQ files that
runs entirely in your browser.

No uploads. No accounts. No cloud. Quality control, composition, k-mer spectra, redundancy
detection, similarity and clustering, open reading frames, alignment, and embeddings — all
computed on your own machine.

```
npm install
npm run dev
```

Then open the URL it prints and click **Try demo dataset**.

---

## The privacy guarantee, and why it is structural

SeqLens does not promise to keep your data private. It is built so that it cannot do otherwise:

- **There is no backend.** The build output is a static bundle. There is no API to send sequences
  to, because none was written.
- **No network requests happen after load.** Parsing, statistics, alignment, clustering, and
  embedding all run in Web Workers on your device. Open the Network panel in your browser's
  developer tools and run every analysis — you will see nothing.
- **Storage is local and optional.** Sequence data is written to this browser's IndexedDB only
  when you import into a project, and Settings has a control that removes every trace of it.
- **No telemetry, no analytics, no accounts.** Nothing is measured and nothing identifies you.
  When something fails, the message appears on your screen and in your console, and nowhere else.
- **The browser enforces it.** `public/_headers` ships a Content-Security-Policy with
  `connect-src 'self'`, so outbound connections are blocked by the browser rather than by the
  code's good behaviour. CI fails the build if that directive ever disappears.
- **Imported files cannot run code.** Sequence identifiers are rendered as text, every value in
  the HTML report is escaped and the report carries its own `default-src 'none'` policy, and CSV
  exports neutralise spreadsheet formulas.

What this does *not* protect against: IndexedDB is readable by anything with access to the
browser profile and is not encrypted beyond whatever full-disk encryption the machine has. On a
shared device, use the delete control when you are done.

---

## What it computes

| Module | What it does |
|---|---|
| **QC** | Eleven checks with configurable thresholds, N50/N90/L50, GC, ambiguity, duplicates, per-position quality and composition, flagged-sequence table |
| **Composition** | Residue composition, GC/AT skew, CpG observed/expected, Shannon entropy, positional composition; for proteins: GRAVY, isoelectric point, molecular weight, charge, low-complexity regions |
| **k-mer** | Exact counts for k = 1–15, entropy, top and rare k-mers, optional canonical (strand-merged) counting |
| **Similarity** | Exhaustive exact-duplicate detection, MinHash similarity matrix, hierarchical clustering with a dendrogram, representative selection, optional alignment refinement |
| **ORF** | Six-frame detection under five NCBI genetic codes, graphical ORF map, six-frame translation, codon usage |
| **Alignment** | Optimal Gotoh pairwise alignment with affine gaps, center-star progressive MSA, consensus, per-column conservation, variant table |
| **Embeddings** | Provider architecture with a k-mer spectrum backend, PCA and UMAP reduction, k-means clustering, interactive 2-D explorer with nearest-neighbour lookup |
| **Reports** | Self-contained HTML (inline SVG charts, no JavaScript), plus CSV and JSON export |

### What is honest about the limits

Several things here are genuinely approximate, and the interface says so rather than implying
precision it does not have:

- **Jaccard similarity is an estimate.** MinHash sketches carry a standard error of roughly 0.044
  at the default sketch size. The interface distinguishes the estimate from the alignment identity
  that the optional refinement step actually measures.
- **Multiple alignment is a heuristic.** Center-star progressive alignment has a known
  factor-of-two sum-of-pairs guarantee and needs n−1 alignments rather than n². It is not
  profile-based, and divergent sets align less accurately than under MAFFT. Every result names the
  method used.
- **The embedding provider is a counting argument, not a language model.** k-mer spectra separate
  sequences by compositional signature — organism GC bias, coding versus non-coding, taxa in a
  metagenome — which is why tools like Kraken and MetaBAT rest on them. They capture nothing
  positional or structural. The provider is labelled `deterministic` for exactly that reason.
- **The protein language model provider is marked unavailable, not faked.** It is fully wired into
  the pipeline — registry entry, availability probe, progress, cancellation — and throws rather
  than returning plausible numbers, because running one needs an inference runtime and model
  weights that SeqLens will not download (a download would mean a network request). Registering a
  local ONNX file is offered in the UI; the missing runtime is stated explicitly.
- **No QC threshold is biologically universal.** A 20% duplicate rate is alarming in shotgun data
  and expected in an amplicon panel; 30% GC is normal for *Plasmodium*. Every verdict names the
  configured threshold that produced it, and every one is adjustable.

---

## Architecture

```
src/
  app/          application shell, router, error boundary
  bio/          all algorithms — no React, no IndexedDB
    parsers/      streaming FASTA and FASTQ, format detection, 64-bit hashing
    statistics/   lengths and NX, entropy, composition, protein properties, duplicates
    kmer/         2-bit packed counting, spectra
    similarity/   MinHash, condensed matrix, hierarchical clustering
    translation/  NCBI genetic codes, six-frame translation, ORF detection
    alignment/    substitution matrices, Gotoh, center-star MSA
    embeddings/   provider interface and registry
    reduction/    PCA, UMAP, k-means
  workers/      job dispatch, one implementation per analysis
  storage/      Dexie schema, block store, repositories
  state/        Zustand stores
  features/     per-module orchestration and configuration panels
  components/   UI primitives, charts, sequence viewer
  pages/        one per navigation entry
```

The `bio/` layer is pure: it imports nothing from React, the DOM, or the storage layer, which is
why it can be tested directly and why the same functions run in the worker and in the report
generator.

### Three decisions that shape everything

**Sequences are stored in concatenated blocks, not one record per sequence.** A block holds a few
megabytes of residues as a single string with a `Uint32Array` of offsets. One IndexedDB record per
sequence would mean one key, one structured-clone envelope, and one JS string header for each of
ten million reads — more overhead than the reads themselves. A block is also the natural unit for
incremental processing: a worker pulls one, folds it into its accumulators, and drops it.

**A column-oriented index answers most questions without touching residues.** Length, GC count,
ambiguity count, a 64-bit residue hash, and mean quality live in typed arrays — about 24 MB for a
million sequences instead of gigabytes. Sorting the explorer, binning a histogram, re-deriving QC
verdicts after a threshold change, and grouping duplicate candidates all read only this.

**Everything expensive runs in a Web Worker, with staged progress and cancellation.** Cancellation
is cooperative — jobs check at chunk boundaries — because terminating a worker would abandon its
IndexedDB transactions mid-write. Progress is reported per stage rather than as one blended
percentage, so a slow phase is identifiable.

### Performance notes

- Import streams `File.stream()` → byte counter → optional `DecompressionStream('gzip')` →
  `TextDecoder`, and computes the index, the dataset profile, and the blocks in **one** pass. A
  12 GB FASTQ imports in the same memory footprint as a 12 MB one.
- k-mer counting uses a rolling 2-bit code with a dense table up to k = 11 and a hash map above
  it. The configuration panel shows the table size before you run, because k = 12 needs 64 MB.
- Similarity never attempts all-pairs alignment. Exact duplicates are found from the import
  hashes in O(n log n) over the whole dataset; the matrix uses fixed-size sketches over a
  deterministic length-stratified sample when the dataset is large, and says so.
- The sequence viewer and every long table are virtualised. Residue colouring is opt-in because
  it is the one thing that needs a DOM node per residue.
- Heatmaps and the embedding scatter are canvas-drawn. A 400-sequence matrix is 160,000 cells;
  as SVG that is 160,000 DOM nodes.

---

## Visualization

Charts follow a design method with computable checks rather than taste. The categorical palette is
a fixed eight-slot order, validated for colour-vision separation and contrast against the actual
chart surface; slots are assigned by series identity and never cycled. Consequences visible in the
product:

- Single-series charts get one colour. Colouring bars darker-where-taller would double-encode the
  height.
- Sequential magnitude (similarity, GC) uses one hue light→dark. No rainbows.
- The embedding scatter is capped at four hues because *any* two points can sit adjacent there,
  and a fifth would fall below the separation floor — so it adds marker shape as a second channel,
  giving sixteen distinguishable clusters.
- Nucleotide colours follow genome-browser convention (A green, C blue, G yellow, T red) and that
  exact set passes the all-pairs checks.
- **Every chart has a table-view twin and a CSV export.** Three palette slots sit below 3:1
  contrast on white, and a colour scale cannot be read in a forced-colours mode; in both cases the
  mitigation is that the same values are reachable as text.

---

## Testing

```
npm test              # 418 tests
npm run coverage
npm run lint
npm run build
```

Unit tests cover the algorithms against hand-derived expectations and independent references:

- Gotoh alignment is checked against a **brute-force affine-gap oracle** over 60 random sequence
  pairs — exponential, so only usable on short inputs, but it depends on none of the DP machinery
  under test. The linear-memory identity variant is cross-checked against the full traceback on 40
  more.
- The 64-bit FNV-1a hash is verified against a BigInt reference and the published test vector.
- MinHash estimates are checked against exact Jaccard within four standard errors, and Mash
  distance against a known substitution rate.
- Both parsers are fuzzed across **every chunk size** from 1 byte upward, so no chunk boundary can
  split a record incorrectly.
- Genetic code tables are the NCBI strings verbatim, guarded by a 64-codon length assertion, and
  spot-checked against known reassignments (TGA→W and AGA/AGG→stop in vertebrate mitochondria).

Integration tests exercise import, persistence, every analysis module, report generation, and
deletion against the real storage layer via `fake-indexeddb` — including cancellation cleanup,
block-boundary splitting, and the error paths.

---

## Browser support

Needs **Web Workers** and **IndexedDB**. Everything else degrades: without the File System Access
API, exports fall back to a plain download; without `DecompressionStream`, gzip import asks you to
decompress first. Settings reports which capabilities are present.

Tested on current Chrome, Edge, Firefox, and Safari.

---

## Supported formats

`.fasta` `.fa` `.fna` `.faa` `.ffn` `.frn` `.fastq` `.fq` `.txt`, and gzipped versions of any of
them. Record format and molecule type are detected from the file contents, not the extension —
FASTQ named `.fasta` happens, and mis-parsing it produces nonsense rather than an error. Detection
can be overridden per file at import.

---

## Contributing and security

Contributions are welcome — [CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the rules
every change follows (the privacy guarantee first among them), and the CI gates a pull
request must pass. Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

Found a vulnerability — anything that could send data off the device, or let an imported
file run script? Please report it privately as described in [SECURITY.md](SECURITY.md),
not as an issue.

---

## License

[MIT](LICENSE)
