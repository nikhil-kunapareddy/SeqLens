/** Accumulates issues, collapsing repeats of the same kind into one entry. */
export class IssueLog {
    issues = [];
    byKind = new Map();
    add(issue) {
        const existing = this.byKind.get(issue.kind);
        if (existing) {
            existing.count += 1;
            return;
        }
        const entry = { ...issue, count: 1 };
        this.byKind.set(issue.kind, entry);
        this.issues.push(entry);
    }
    get total() {
        let sum = 0;
        for (const issue of this.issues)
            sum += issue.count;
        return sum;
    }
}
