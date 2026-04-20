# Rem2Tex

Rem2Tex is a RemNote plugin that converts a structured RemNote paper outline into a LaTeX document string and writes it back into RemNote under a dedicated `Rem2Tex` exports rem.

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
- It creates (if missing) a `Rem2Tex` child under the paper root where `/rem2tex` was started.
- It creates a new export rem under that node named `Rem2Tex HH:MM AM/PM DD-MM-YYYY`.
- It writes the generated LaTeX into a child code block (`latex`) under that export rem.

## Command

The plugin registers:

- `Rem2Tex: Convert Paper to TeX (Copy All Todos as Comments)` (`/rem2tex`)
- `Rem2Tex: Convert Paper to TeX (Copy Unfinished Todos as Comments)` (`/rem2tex-unfinished`)
- `Rem2Tex: Convert Paper to TeX (Do Not Copy Todos as Comments)` (`/rem2tex-no-todos`)

Run it while focused on the parent rem you want to export.

During conversion, Rem2Tex opens a **large popup** with a single scrolling document-style layout:

- **From preamble** section (inline `Title`, `Author(s)`, and `Paper rem`)
- **Todos** section (shows the active policy: all / unfinished-only / none)
- **Progress** section (completed stage log + explicit failure stage when conversion aborts)
- conversion status card (running / success / error)

On failure, the popup shows a **structured report**:

- error **code** (e.g. `MISSING LOCAL LABEL`)
- red **error summary** (headline + what happened)
- **Where it failed** details:
  - section/subsection (when available)
  - source rem title/id (the rem being exported when conversion failed)
  - source rem hierarchy path **relative to the rem where `/rem2tex` was started**
- source rem text preview
- technical detail
- linked pin target rem id (reference only, when available)
- for `MISSING_LOCAL_LABEL`, an additional **Referenced rem missing `\label`** block:
  - rem title (target rem or specific child media/code rem that needs the fix)
  - hierarchy path to that referenced rem
  - text/code preview for the missing-label rem (includes code block text when available)
- actionable suggestions

Use **Copy full report** to copy the plain-text failure bundle (including both source-rem failure context and referenced missing-label rem context) for bug reports.

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

TODO export is command-dependent:

- **Copy all todos**: unfinished and finished todos are exported as comments
  - unfinished -> `% TODO [ ] ...`
  - finished -> `% TODO [X] ...`
- **Copy unfinished todos only**: only unfinished todos are exported as comments
- **Do not copy todos**: todo rems are skipped from comment output

If a rem is both a **heading and a todo**, it is treated as a heading only (todo status is ignored for section output).

**Indented TODO subtrees:** When a non-heading todo is exported as a comment, its **child rems** are also emitted as `%` comment lines below it. **Indentation** follows outline depth with **one leading space per level** before the `%` (the whole line shifts right, not only the text after `%`).

- Non-todo children: one line each, indented `%  - ` plus a short title (from the rem’s title/text).
- Nested todo children: the full `% TODO [ ] …` / `% TODO [X] …` line for that child is emitted at the deeper indent (then its own descendants continue underneath).

**Todo status artifact:** RemNote often surfaces the checkbox state as a pin that serializes as `\cite{Status}`. That fragment is **stripped** from exported `% TODO …` lines and from subtree comment labels so it never appears in the TeX.

**Pins inside `% TODO …` lines:** Rem2Tex uses a dedicated “resolve pins as readable text” path for todo comments. Local pins therefore show as **linked visible text**, not as `\ref{...}` (even when the same pin would become `\ref{...}` in normal paragraph output). External pins still become `\cite{...}` when they point outside the export hierarchy (in addition to Status being stripped as above). The rule that **omits** local pins to other TODO rems in normal paragraphs does **not** apply inside exported TODO comment lines.

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

**Body rems vs boundary blocks:** For ordinary body rems, code detection uses the rem’s **main text** (`rem.text`) only. `Preamble` / `End` extraction (and some media paths) can also read **back text** (`backText`); if you rely on code in `backText` for a normal paragraph rem, move it into the main text or a child code block.

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
- if a pin/reference points inside the current export hierarchy, it usually resolves as linked text, `\ref{...}` for labeled local figures/tables/code, or is omitted when it points at another TODO rem in **paragraph** body text (see **TODO rem handling**—exported `% TODO …` lines and todo comment subtrees use different pin rules)
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
  - `Rem2Tex`
    - `Rem2Tex 09:42 AM 18-04-2026` (auto-generated export)
    - `Rem2Tex 11:05 AM 19-04-2026` (auto-generated export)

## Development

- The npm package name is `rem2tex-mo` (see `package.json`).
- Build for RemNote: `npm install` then `npm run build` — produces `PluginZip.zip` in the project root for sideloading.

## Notes

- This plugin is optimized for author-driven LaTeX workflows where RemNote stores structure and draft text, and code blocks store exact LaTeX for complex constructs.
- Existing exports can stay in the tree; they are safely ignored if placed after `End`.
