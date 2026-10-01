import { createRng } from '@/bio/parsers/hash';
import { formatFastaRecord, formatFastqRecord } from '@/bio/parsers/writer';
import { reverseComplement } from '@/bio/statistics/composition';

/**
 * Synthetic demo datasets.
 *
 * Generated rather than embedded as literals, for two reasons. First, the
 * generator is seeded, so the bytes are identical on every machine and every
 * run - a demo that changed between sessions would make the QC numbers in
 * documentation wrong. Second, the output goes through exactly the same import,
 * parsing, and analysis path as a user's own file: nothing about the demo is
 * special-cased, so if the demo works the real pipeline works.
 *
 * The content is synthetic and deliberately carries features worth finding:
 * two compositional populations, real open reading frames, exact duplicates, a
 * near-duplicate family, assembly gaps, homopolymer runs, and a low-complexity
 * repeat region. Sequences are not drawn from any real organism.
 */

export interface DemoDataset {
  id: string;
  fileName: string;
  title: string;
  description: string;
  /** What the dataset is useful for demonstrating. */
  highlights: string[];
  /** Approximate size, for display before generation. */
  approximateBytes: number;
  build: () => File;
}

const BASES = 'ACGT';
const STOP_CODONS = new Set(['TAA', 'TAG', 'TGA']);

/** Random nucleotide run with a target GC fraction. */
function randomDna(length: number, gcTarget: number, rng: () => number): string {
  const out: string[] = [];
  for (let i = 0; i < length; i += 1) {
    if (rng() < gcTarget) out.push(rng() < 0.5 ? 'G' : 'C');
    else out.push(rng() < 0.5 ? 'A' : 'T');
  }
  return out.join('');
}

/**
 * Builds a coding sequence: start codon, stop-free codons, then a stop.
 *
 * Codons are re-drawn until they are not a stop codon, which is what makes the
 * resulting ORF a genuine uninterrupted reading frame rather than a stretch
 * that merely looks like one.
 */
function codingSequence(codons: number, gcTarget: number, rng: () => number): string {
  const out: string[] = ['ATG'];
  for (let i = 0; i < codons; i += 1) {
    let codon = randomDna(3, gcTarget, rng);
    while (STOP_CODONS.has(codon)) codon = randomDna(3, gcTarget, rng);
    out.push(codon);
  }
  out.push(['TAA', 'TAG', 'TGA'][Math.floor(rng() * 3)]);
  return out.join('');
}

/** Applies point substitutions at the given rate. */
function mutate(sequence: string, rate: number, rng: () => number): string {
  const out: string[] = [];
  for (const base of sequence) {
    if (rng() < rate) {
      let replacement = base;
      while (replacement === base) replacement = BASES[Math.floor(rng() * 4)];
      out.push(replacement);
    } else {
      out.push(base);
    }
  }
  return out.join('');
}

/* -------------------------------------------------------------------------- */
/* Assembly-style DNA contigs                                                  */
/* -------------------------------------------------------------------------- */

function buildContigs(): string {
  const rng = createRng(20260917);
  const records: string[] = [];

  // Population A: GC-rich, with coding sequences.
  for (let i = 1; i <= 18; i += 1) {
    const codons = 80 + Math.floor(rng() * 400);
    const sequence =
      randomDna(120 + Math.floor(rng() * 300), 0.62, rng) +
      codingSequence(codons, 0.62, rng) +
      randomDna(80 + Math.floor(rng() * 250), 0.62, rng);
    records.push(
      formatFastaRecord(
        `contigA_${String(i).padStart(3, '0')}`,
        `synthetic GC-rich contig, length=${sequence.length}, contains one forward ORF`,
        sequence,
      ),
    );
  }

  // Population B: AT-rich, some with reverse-strand coding sequences.
  for (let i = 1; i <= 16; i += 1) {
    const codons = 60 + Math.floor(rng() * 300);
    const coding = codingSequence(codons, 0.34, rng);
    const oriented = i % 2 === 0 ? reverseComplement(coding) : coding;
    const sequence =
      randomDna(100 + Math.floor(rng() * 200), 0.34, rng) +
      oriented +
      randomDna(100 + Math.floor(rng() * 200), 0.34, rng);
    records.push(
      formatFastaRecord(
        `contigB_${String(i).padStart(3, '0')}`,
        `synthetic AT-rich contig, length=${sequence.length}, ORF on ${i % 2 === 0 ? 'reverse' : 'forward'} strand`,
        sequence,
      ),
    );
  }

  // A near-duplicate family: one ancestor at several divergence levels. This is
  // what the similarity module's clustering should recover as one cluster.
  const ancestor = randomDna(1500, 0.5, rng);
  records.push(
    formatFastaRecord('family_ancestor', 'near-duplicate family founder, 0% divergence', ancestor),
  );
  for (const [i, rate] of [0.002, 0.005, 0.01, 0.02, 0.05, 0.1].entries()) {
    records.push(
      formatFastaRecord(
        `family_variant_${i + 1}`,
        `near-duplicate of family_ancestor at ${(rate * 100).toFixed(1)}% divergence`,
        mutate(ancestor, rate, rng),
      ),
    );
  }

  // Exact duplicates: three copies of one sequence and two of another.
  const repeated = randomDna(900, 0.48, rng);
  for (let copy = 1; copy <= 3; copy += 1) {
    records.push(
      formatFastaRecord(
        `duplicate_alpha_copy${copy}`,
        'exact duplicate: three identical copies of this sequence exist',
        repeated,
      ),
    );
  }
  const repeatedShort = randomDna(300, 0.55, rng);
  for (let copy = 1; copy <= 2; copy += 1) {
    records.push(
      formatFastaRecord(
        `duplicate_beta_copy${copy}`,
        'exact duplicate: two identical copies of this sequence exist',
        repeatedShort,
      ),
    );
  }

  // A scaffold with assembly gaps, which is where high N content is legitimate.
  const scaffold = [
    randomDna(800, 0.5, rng),
    'N'.repeat(220),
    randomDna(1100, 0.5, rng),
    'N'.repeat(140),
    randomDna(600, 0.5, rng),
  ].join('');
  records.push(
    formatFastaRecord(
      'scaffold_with_gaps',
      'scaffold containing two runs of N representing assembly gaps (about 13% ambiguous)',
      scaffold,
    ),
  );

  // A low-complexity tandem repeat: high Shannon entropy, low linguistic
  // complexity, so it shows why the two measures disagree.
  records.push(
    formatFastaRecord(
      'tandem_repeat_at',
      'low-complexity tandem repeat: (AT)n, balanced composition but no sequence diversity',
      'AT'.repeat(600),
    ),
  );
  records.push(
    formatFastaRecord(
      'tandem_repeat_gaa',
      'low-complexity trinucleotide repeat: (GAA)n',
      'GAA'.repeat(400),
    ),
  );

  // Homopolymer runs, the failure mode of nanopore and ion-torrent chemistries.
  records.push(
    formatFastaRecord(
      'homopolymer_carrier',
      'contains A and T homopolymer runs of 30 and 45 residues',
      `${randomDna(400, 0.5, rng)}${'A'.repeat(30)}${randomDna(300, 0.5, rng)}${'T'.repeat(45)}${randomDna(400, 0.5, rng)}`,
    ),
  );

  // Edge cases the QC module is supposed to notice.
  records.push(formatFastaRecord('empty_record', 'header with no residues', ''));
  records.push(
    formatFastaRecord('very_short', 'a 12 bp fragment, below the default short-sequence threshold', 'ACGTACGTACGT'),
  );
  records.push(
    formatFastaRecord(
      'ambiguity_codes',
      'uses the full IUPAC ambiguity alphabet',
      `${randomDna(200, 0.5, rng)}RYSWKMBDHVN${randomDna(200, 0.5, rng)}`,
    ),
  );

  return records.join('');
}

/* -------------------------------------------------------------------------- */
/* Short-read FASTQ                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Builds a paired-end-style read set with realistic quality behaviour.
 *
 * Quality declines toward the 3' end, which is normal for every current
 * sequencing chemistry, and a tenth of the reads are low-quality throughout, as
 * happens with poor clusters. A handful of exact duplicates and one adapter-only
 * read are included so the QC module has something to find.
 */
function buildReads(): string {
  const rng = createRng(4242);
  const records: string[] = [];
  const readLength = 150;

  // Reference the reads are sampled from, so duplicates are biologically
  // plausible rather than arbitrary.
  const reference = randomDna(20_000, 0.47, rng);
  const adapter = 'AGATCGGAAGAGCACACGTCTGAACTCCAGTCAC';

  const qualityString = (length: number, poor: boolean): string => {
    const out: string[] = [];
    for (let i = 0; i < length; i += 1) {
      // Start near Q38 and decline; poor reads start near Q18.
      const base = poor ? 18 : 38;
      const decline = (i / length) * (poor ? 10 : 12);
      const noise = (rng() - 0.5) * 6;
      const score = Math.max(2, Math.min(41, Math.round(base - decline + noise)));
      out.push(String.fromCharCode(score + 33));
    }
    return out.join('');
  };

  for (let i = 1; i <= 360; i += 1) {
    const poor = i % 10 === 0;
    const start = Math.floor(rng() * (reference.length - readLength));
    let residues = reference.slice(start, start + readLength);
    // Sequencing errors, higher in the poor-quality reads.
    residues = mutate(residues, poor ? 0.03 : 0.002, rng);
    if (rng() < 0.5) residues = reverseComplement(residues);

    records.push(
      formatFastqRecord(
        `read_${String(i).padStart(4, '0')}`,
        `synthetic 150 bp read${poor ? ' (low quality)' : ''}`,
        residues,
        qualityString(residues.length, poor),
      ),
    );
  }

  // Optical/PCR duplicates: the same fragment sequenced repeatedly.
  const duplicated = reference.slice(5000, 5000 + readLength);
  for (let copy = 1; copy <= 12; copy += 1) {
    records.push(
      formatFastqRecord(
        `dup_read_${String(copy).padStart(2, '0')}`,
        'exact duplicate read, twelve identical copies',
        duplicated,
        qualityString(readLength, false),
      ),
    );
  }

  // Adapter-only reads: the insert was too short, so only adapter was read.
  for (let i = 1; i <= 6; i += 1) {
    const residues = (adapter + randomDna(readLength - adapter.length, 0.5, rng)).slice(0, readLength);
    records.push(
      formatFastqRecord(
        `adapter_read_${i}`,
        'read beginning with an Illumina adapter sequence',
        residues,
        qualityString(readLength, false),
      ),
    );
  }

  // Poly-G tail, the classic two-colour chemistry artefact.
  records.push(
    formatFastqRecord(
      'polyG_read_1',
      'poly-G read, the two-colour chemistry no-signal artefact',
      'G'.repeat(readLength),
      qualityString(readLength, true),
    ),
  );

  return records.join('');
}

/* -------------------------------------------------------------------------- */
/* Protein sequences                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Builds protein records with distinct physicochemical characters.
 *
 * Residues are drawn from class-weighted alphabets so the set separates into
 * hydrophobic, acidic, and basic populations. The composition module's charge
 * and GRAVY distributions should show three modes rather than one.
 */
function buildProteins(): string {
  const rng = createRng(777);
  const records: string[] = [];

  const draw = (alphabet: string, length: number): string => {
    const out: string[] = ['M'];
    for (let i = 1; i < length; i += 1) out.push(alphabet[Math.floor(rng() * alphabet.length)]);
    return out.join('');
  };

  const families: { prefix: string; alphabet: string; note: string; count: number }[] = [
    {
      prefix: 'hydrophobic',
      alphabet: 'AILMFVWAILMFVGPST',
      note: 'hydrophobic-biased sequence; expect a positive GRAVY score',
      count: 10,
    },
    {
      prefix: 'acidic',
      alphabet: 'DEDESGTNQAKDEDESG',
      note: 'acidic sequence; expect a low isoelectric point and negative net charge at pH 7',
      count: 10,
    },
    {
      prefix: 'basic',
      alphabet: 'KRKRHNQSGAKRKRHTP',
      note: 'basic sequence; expect a high isoelectric point and positive net charge at pH 7',
      count: 10,
    },
    {
      prefix: 'balanced',
      alphabet: 'ACDEFGHIKLMNPQRSTVWY',
      note: 'uniform residue composition across the 20 standard amino acids',
      count: 8,
    },
  ];

  for (const family of families) {
    for (let i = 1; i <= family.count; i += 1) {
      const length = 120 + Math.floor(rng() * 380);
      records.push(
        formatFastaRecord(
          `${family.prefix}_${String(i).padStart(2, '0')}`,
          `${family.note}, length=${length}`,
          draw(family.alphabet, length),
        ),
      );
    }
  }

  // A low-complexity region, common in real disordered proteins.
  records.push(
    formatFastaRecord(
      'lowcomplexity_polyQ',
      'poly-glutamine tract flanked by balanced sequence, as in disordered regions',
      `${draw('ACDEFGHIKLMNPQRSTVWY', 90)}${'Q'.repeat(70)}${draw('ACDEFGHIKLMNPQRSTVWY', 90)}`,
    ),
  );

  // Exact duplicates.
  const repeated = draw('ACDEFGHIKLMNPQRSTVWY', 240);
  for (let copy = 1; copy <= 2; copy += 1) {
    records.push(
      formatFastaRecord(
        `duplicate_protein_copy${copy}`,
        'exact duplicate: two identical copies of this sequence exist',
        repeated,
      ),
    );
  }

  // Sequences with ambiguity and a terminal stop symbol, both of which appear
  // in real translated-CDS files.
  records.push(
    formatFastaRecord(
      'with_ambiguity',
      'contains X (unknown), B (Asx), and Z (Glx) ambiguity codes',
      `${draw('ACDEFGHIKLMNPQRSTVWY', 100)}XXXBZ${draw('ACDEFGHIKLMNPQRSTVWY', 100)}`,
    ),
  );
  records.push(
    formatFastaRecord(
      'with_terminal_stop',
      'translated CDS retaining its terminal stop symbol',
      `${draw('ACDEFGHIKLMNPQRSTVWY', 180)}*`,
    ),
  );

  return records.join('');
}

/* -------------------------------------------------------------------------- */

const toFile = (contents: string, fileName: string, type = 'text/plain'): File =>
  new File([contents], fileName, { type, lastModified: Date.now() });

export const DEMO_DATASETS: DemoDataset[] = [
  {
    id: 'demo-contigs',
    fileName: 'seqlens_demo_contigs.fasta',
    title: 'Synthetic assembly contigs',
    description:
      'Forty-eight nucleotide contigs from two compositional populations, with real open reading frames, a near-duplicate family, exact duplicates, assembly gaps, and low-complexity repeats.',
    highlights: [
      'Two GC populations (34% and 62%)',
      'Forward and reverse-strand ORFs',
      'Near-duplicate family at six divergence levels',
      'Exact duplicates and N-gap scaffold',
      'Tandem repeats and homopolymer runs',
    ],
    approximateBytes: 95_000,
    build: () => toFile(buildContigs(), 'seqlens_demo_contigs.fasta'),
  },
  {
    id: 'demo-reads',
    fileName: 'seqlens_demo_reads.fastq',
    title: 'Synthetic short reads',
    description:
      'Three hundred and seventy-nine 150 bp reads sampled from a synthetic reference, with quality declining toward the 3′ end, a low-quality subpopulation, PCR duplicates, adapter-only reads, and a poly-G artefact.',
    highlights: [
      'Phred+33 quality with realistic 3′ decline',
      '10% low-quality read subpopulation',
      'Twelve exact PCR duplicates',
      'Adapter-only and poly-G reads',
    ],
    approximateBytes: 150_000,
    build: () => toFile(buildReads(), 'seqlens_demo_reads.fastq'),
  },
  {
    id: 'demo-proteins',
    fileName: 'seqlens_demo_proteins.faa',
    title: 'Synthetic protein sequences',
    description:
      'Forty-two protein sequences in four families with distinct physicochemical characters, plus a poly-glutamine low-complexity tract, duplicates, and ambiguity codes.',
    highlights: [
      'Hydrophobic, acidic, basic, and balanced families',
      'Separable GRAVY and isoelectric point distributions',
      'Poly-Q low-complexity region',
      'X, B, and Z ambiguity codes',
    ],
    approximateBytes: 15_000,
    build: () => toFile(buildProteins(), 'seqlens_demo_proteins.faa'),
  },
];

/** The dataset offered by the landing page's primary demo action. */
export const PRIMARY_DEMO = DEMO_DATASETS[0];

export const getDemoDataset = (id: string): DemoDataset | undefined =>
  DEMO_DATASETS.find((dataset) => dataset.id === id);
