# Security policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately, in order of preference:

1. **GitHub private vulnerability reporting** — on this repository, go to
   *Security → Report a vulnerability*
   (<https://github.com/nikhil-kunapareddy/SeqLens/security/advisories/new>).
2. **Email** — <nikhilkunapareddy@gmail.com>, with `[SeqLens security]` in the subject.

Include what you found, how to reproduce it (a small FASTA/FASTQ file that triggers it
is ideal — synthetic sequences, please, not real patient or proprietary data), the
browser and version, and the impact as you understand it.

| | |
|---|---|
| Acknowledgement | within 3 working days |
| Assessment and a plan | within 10 working days |
| Fix for a confirmed high or critical issue | as fast as it can be made safely, typically within 30 days |

You will be credited in the advisory unless you ask not to be.

## Supported versions

Security fixes land on `main` and in the next release. Older builds are not patched.

## What SeqLens promises, and what counts as a vulnerability

SeqLens's core guarantee is that **sequence data never leaves the browser**. Anything that
breaks it is in scope and treated as high severity:

* any network request carrying sequence data, file names, or analysis results;
* any way for an imported file to execute script — in the app, in a generated HTML report,
  or in an exported file opened in a spreadsheet (formula injection);
* any bypass of the Content-Security-Policy in `public/_headers`;
* data surviving the "delete everything" control in Settings.

Also in scope: denial of service from a crafted input file that a normal file of the same
size would not cause (catastrophic backtracking, unbounded memory), and anything in the
CI configuration that could leak a token.

Out of scope:

* Someone with access to your browser profile reading IndexedDB. SeqLens stores imported
  data there unencrypted, as the README states; use the delete control on shared machines.
* Hosting misconfiguration. The CSP is enforced by `public/_headers` on hosts that support
  it (Netlify, Cloudflare Pages). If you deploy elsewhere, configure the same headers.
* Already-public advisories in dependencies (Dependabot tracks those).
