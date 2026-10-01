import { describe, expect, it } from 'vitest';
import { escapeCsvField, toCsv } from './export';
describe('escapeCsvField', () => {
    it('quotes fields containing commas, quotes, or line breaks', () => {
        expect(escapeCsvField('a,b')).toBe('"a,b"');
        expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
        expect(escapeCsvField('line\nbreak')).toBe('"line\nbreak"');
    });
    it('neutralises spreadsheet formulas in text fields', () => {
        expect(escapeCsvField('=HYPERLINK("http://example.invalid")')).toBe('"\'=HYPERLINK(""http://example.invalid"")"');
        expect(escapeCsvField('+cmd')).toBe("'+cmd");
        expect(escapeCsvField('-cmd')).toBe("'-cmd");
        expect(escapeCsvField('@SUM(A1)')).toBe("'@SUM(A1)");
    });
    it('leaves numbers and numeric strings unchanged', () => {
        expect(escapeCsvField(-0.5)).toBe('-0.5');
        expect(escapeCsvField('-0.5')).toBe('-0.5');
        expect(escapeCsvField('+12')).toBe('+12');
        expect(escapeCsvField('-1.2e-3')).toBe('-1.2e-3');
    });
    it('renders null, undefined, and non-finite numbers as empty', () => {
        expect(escapeCsvField(null)).toBe('');
        expect(escapeCsvField(undefined)).toBe('');
        expect(escapeCsvField(Number.NaN)).toBe('');
    });
});
describe('toCsv', () => {
    it('applies formula neutralisation to every cell', () => {
        const csv = toCsv([{ id: '=1+1', length: 10 }], [
            { header: 'id', value: (row) => row.id },
            { header: 'length', value: (row) => row.length },
        ]);
        expect(csv).toBe("id,length\n'=1+1,10\n");
    });
});
