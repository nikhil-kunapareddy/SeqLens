import { BASE_CODE } from '../alphabets';
export const GENETIC_CODES = [
    {
        id: 1,
        name: 'Standard',
        shortName: 'Standard (1)',
        aminoAcids: 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
        starts: '---M------**--*----M---------------M----------------------------',
        note: 'Nuclear genes of most eukaryotes.',
    },
    {
        id: 2,
        name: 'Vertebrate Mitochondrial',
        shortName: 'Vertebrate mito (2)',
        aminoAcids: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG',
        starts: '----------**--------------------MMMM---------------M------------',
        note: 'AGA and AGG are stops; TGA encodes tryptophan.',
    },
    {
        id: 4,
        name: 'Mold, Protozoan, and Coelenterate Mitochondrial; Mycoplasma/Spiroplasma',
        shortName: 'Mold mito / Mycoplasma (4)',
        aminoAcids: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
        starts: '--MM------**-------M------------MMMM---------------M------------',
        note: 'TGA encodes tryptophan rather than a stop.',
    },
    {
        id: 5,
        name: 'Invertebrate Mitochondrial',
        shortName: 'Invertebrate mito (5)',
        aminoAcids: 'FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSSSVVVVAAAADDEEGGGG',
        starts: '---M------**--------------------MMMM---------------M------------',
        note: 'AGA and AGG encode serine; TGA encodes tryptophan.',
    },
    {
        id: 11,
        name: 'Bacterial, Archaeal and Plant Plastid',
        shortName: 'Bacterial / plastid (11)',
        aminoAcids: 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG',
        starts: '---M------**--*----M------------MMMM---------------M------------',
        note: 'Same amino acid assignments as the standard code, with additional alternative start codons.',
    },
];
const NCBI_BASES = 'TCAG';
/** Converts a codon string to the internal 2-bit index, or -1 if ambiguous. */
export function codonCode(codon) {
    const c1 = BASE_CODE[codon.charCodeAt(0)];
    const c2 = BASE_CODE[codon.charCodeAt(1)];
    const c3 = BASE_CODE[codon.charCodeAt(2)];
    if (c1 === 255 || c2 === 255 || c3 === 255)
        return -1;
    return c1 * 16 + c2 * 4 + c3;
}
/** Renders an internal codon index back to residues. */
export function codonFromCode(code) {
    const bases = 'ACGT';
    return bases[(code >> 4) & 3] + bases[(code >> 2) & 3] + bases[code & 3];
}
function compile(table) {
    const aminoAcids = new Uint8Array(64);
    const isStart = new Uint8Array(64);
    const isStop = new Uint8Array(64);
    const startCodons = [];
    const stopCodons = [];
    for (let i = 0; i < 64; i += 1) {
        const codon = NCBI_BASES[(i >> 4) & 3] + NCBI_BASES[(i >> 2) & 3] + NCBI_BASES[i & 3];
        const code = codonCode(codon);
        if (code < 0)
            continue;
        const aa = table.aminoAcids[i];
        aminoAcids[code] = aa.charCodeAt(0);
        if (aa === '*') {
            isStop[code] = 1;
            stopCodons.push(codon);
        }
        if (table.starts[i] === 'M') {
            isStart[code] = 1;
            startCodons.push(codon);
        }
    }
    return {
        id: table.id,
        name: table.name,
        aminoAcids,
        isStart,
        isStop,
        startCodons,
        stopCodons,
    };
}
// Transcription guard: a table string that is not exactly 64 characters long
// would silently shift every codon assignment after the error, so it is checked
// once at module load rather than producing wrong translations at runtime.
for (const table of GENETIC_CODES) {
    if (table.aminoAcids.length !== 64 || table.starts.length !== 64) {
        throw new Error(`Genetic code table ${table.id} is malformed: expected 64 codons, found ` +
            `${table.aminoAcids.length} amino acids and ${table.starts.length} start flags.`);
    }
}
const compiled = new Map(GENETIC_CODES.map((table) => [table.id, compile(table)]));
/** Returns a compiled table, falling back to the standard code. */
export function getGeneticCode(id) {
    return compiled.get(id) ?? compiled.get(1);
}
export const DEFAULT_GENETIC_CODE = getGeneticCode(1);
