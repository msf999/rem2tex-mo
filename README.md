# Rem2Tex

Rem2Tex is a RemNote plugin that converts a structured RemNote paper outline into a LaTeX document string and writes it back into RemNote as a dated export rem.

## What Rem2Tex does

When you run the command:

- Rem2Tex reads the currently focused parent rem (your paper root).
- It validates that:
  - the first child is `Preamble`
  - an `End` child exists somewhere after `Preamble`
- It converts all children between `Preamble` and `End` into LaTeX body content.
- It assembles output as:
  - preamble block
  - converted body
  - end block
- It creates a new child under the paper root named `Rem2Tex YYYY-MM-DD`.
- It writes the generated LaTeX into a child code block (`tex`) under that export rem.

## Command

The plugin registers:

- Name: `Rem2Tex: Convert Paper to TeX`
- Quick code: `/rem2tex`

Run it while focused on the parent rem you want to export.

During conversion, Rem2Tex emits step toasts (for example `Rem2Tex 2/6: ...`) to show progress.

## Required top-level paper structure

Expected paper tree:

- `Paper` (or any parent rem name)
  - `Preamble` (first child, required)
  - body rems (sections/content)
  - `End` (required, must appear after `Preamble`)
  - optional extra rems after `End` (ignored by converter)

Important behavior:

- `End` does not need to be the literal final child.
- Any rems after `End` are ignored, which allows keeping prior exports in place.

## How body conversion works

### Headings vs paragraphs

Rem2Tex uses RemNote heading formatting to decide heading nodes:

- heading rems become:
  - `\section`
  - `\subsection`
  - `\subsubsection`
  - `\paragraph`
  - `\subparagraph`
- non-heading rems become paragraph/content text.

### TODO rem handling

TODO rems are preserved as LaTeX comments in-place:

- unfinished -> `% TODO [ ] ...`
- finished -> `% TODO [X] ...`

Pins and rem references **in the TODO rem’s own text** are resolved like normal body text (linked text, external `\cite{...}`, local `\ref{...}` when applicable). That differs from **regular paragraphs**: a local pin that points at another TODO rem in the export tree is omitted in paragraph output so checklist links do not pollute the prose, but the same pin inside a TODO line is kept so the comment still reads correctly.

## Preamble and End extraction

`Preamble` and `End` are treated as boundary blocks:

- converter prefers code-formatted content from descendants
- if no code is found, it falls back to plain text
- code-block metadata artifacts are filtered out

Filtered artifacts include labels such as:

- `Size`
- `H1` to `H6`
- `BoundHeight`
- `Language`
- trailing `true` / `false` / `latex`

## Tables and figures (current media model)

Rem2Tex uses a codeblock-first media strategy.

### Image rems

If a rem contains an image token:

- it must have at least one immediate child code block containing media LaTeX
- valid media block is inferred from LaTeX content:
  - `\begin{figure}`
  - `\begin{table}`
- all valid child media code blocks are emitted in child order
- the parent rem image/title prose is ignored for output

If an image rem has no valid child media code block:

- conversion continues
- a highly visible boxed `REM2TEX WARNING` block is inserted into the output
- warning text is escaped to prevent LaTeX compile errors

### Standalone media code blocks

Standalone media blocks (e.g. table/figure LaTeX in a non-image rem) are supported through normal code-aware conversion paths and are emitted as raw LaTeX when the rem is truly code-formatted.

## Math and LaTeX escaping behavior

Rem2Tex applies context-aware escaping to protect normal prose while preserving LaTeX syntax.

### Preserved/protected patterns

- LaTeX commands and arguments:
  - `\ce{...}`, `\cite{...}`, `\textbf{...}`, etc.
- inline and display delimiters:
  - `$...$`, `$$...$$`, `\(...\)`, `\[...\]`
- full LaTeX environments:
  - `\begin{...} ... \end{...}` (with nested same-environment support)

### RemNote rich-text math tokens

RemNote LaTeX rich-text elements are converted to delimited math:

- inline math defaults to `$...$`
- block math uses `$$...$$` when marked as block by rich text metadata

Inside math environments (`equation`, `align`, `gather`, `multline`, and starred variants), Rem2Tex normalizes wrappers to avoid nested delimiter issues.

### Additional normalization

- removes spurious blank lines before `\label{...}` in math environments
- prevents runaway blank spacing inside math blocks

## Citation and rem-link behavior

For normal text extraction:

- rem reference tokens are context-aware
- if a pin/reference points inside the current export hierarchy, it usually resolves as linked text, `\ref{...}` for labeled local figures/tables/code, or is omitted when it points at another TODO rem (see **TODO rem handling** above—omission does not apply to pins inside a TODO rem’s text)
- if a pin/reference points outside the current export hierarchy, it is converted to a citation key
  derived from the first document ancestor and emitted as `\cite{...}`
- query-like payload artifacts (e.g. segments beginning with `query:`) are suppressed and not emitted

Adjacent citation normalization:

- adjacent citations are merged: `\cite{one}\cite{two}` -> `\cite{one, two}`
- whitespace-separated adjacent citations are merged similarly
- duplicate adjacent keys are deduplicated:
  - `\cite{one}\cite{one}\cite{two}` -> `\cite{one, two}`

Citation key fallback behavior:

- primary key source: first non-query-like document ancestor title
- fallback: deterministic id-based key (`doc_<id>` / `rem_<id>`) if no clean title is available

For code-only extraction:

- rem reference tokens are ignored to avoid importing UI metadata into code output

## Error and warning behavior

Hard errors (conversion abort) occur for structural issues:

- no focused/selected rem
- missing `Preamble` as first child
- missing `End` after `Preamble`
- empty boundary block content

Soft warnings (conversion continues) occur for media authoring issues:

- image rem without valid child figure/table code block

## Authoring recommendations

To get stable output:

- keep full document preamble only under `Preamble`
- keep full document tail under `End`
- use heading formatting for section hierarchy
- put complex LaTeX (tables/figures/equations) in code blocks when possible
- for figure/image rems, always include child figure/table code block(s)
- keep citations as explicit LaTeX keys or linked rem keys

## Example high-level tree

- `Paper`
  - `Preamble`
    - code block with preamble
  - `Abstract` (heading)
  - `Introduction` (heading)
  - `Results and Discussion` (heading)
    - prose rems
    - table code block rem
    - image rem
      - figure code block child
  - `Conclusion` (heading)
  - `End`
    - code block with `\begin{document}` closure/end material
  - `Rem2Tex 2026-04-17` (auto-generated export)

## Notes

- This plugin is optimized for author-driven LaTeX workflows where RemNote stores structure and draft text, and code blocks store exact LaTeX for complex constructs.
- Existing exports can stay in the tree; they are safely ignored if placed after `End`.
