# Flink test fixtures

Phase 1 commits only small, synthetic metadata. Generated PDFs, encrypted files, large files, and user documents must not be committed or packaged into an IPA.

## Small synthetic set (FIX-01 through FIX-04)

Run this from the repository root:

```powershell
node scripts/fixtures/generate-pdf-fixtures.mjs
```

The command writes into ignored `tests/fixtures/.generated/`. It uses exclusive creation and refuses to overwrite an existing fixture. Delete or move that generated directory yourself before regenerating it.

The set contains a numbered three-page PDF, a one-page PDF, mixed portrait/landscape/rotation pages, Unicode/case/duplicate filenames, a non-PDF text file, a false `.pdf`, and a zero-byte `.pdf`.

## Encrypted PDFs (FIX-05)

Install `qpdf` from its official distribution outside this project, then use a generated one-page PDF as the input. Keep both results outside version control. With the exact syntax supported by the installed qpdf version, prepare:

- one PDF whose user password is a known local test value;
- one encrypted PDF with an empty user password.

Record the qpdf version and commands in the test evidence. Never use a real document or a real password. PDFKit must distinguish `isLocked` from encryption alone on an actual device; creating the files does not verify that behavior.

## Large and realistic data (FIX-06 through FIX-09)

Prepare these only for Phase 5, outside the repository and GitHub Releases:

- a valid 10,000-page numbered PDF;
- a valid PDF of at least 3,000,000,000 bytes and a separate valid PDF near 3 GiB (3,221,225,472 bytes);
- a rights-cleared image-heavy book or comic-like PDF;
- 1,000 mostly small PDFs.

Any generator must stream output and must not hold the entire file in memory. A padded PDF may exercise 64-bit offsets and copying, but it is not evidence for image decoding or rendering performance. Do not prepare 1,000 copies of a 3 GB file. Record free space before and after each isolated test.

## Blink data (FIX-10)

`blink-synthetic.json` contains artificial coefficients only. It contains no captured image, face mesh, or measured personal time series. The unit suite builds full contract records around these values and covers the detailed boundaries from DES-BLINK-FSM.
