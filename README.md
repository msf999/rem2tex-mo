# Rem2Tex

Rem2Tex is a RemNote plugin that converts a structured RemNote paper outline into a LaTeX document string and writes it back into RemNote under a dedicated `Rem2Tex` exports rem.

## What Rem2Tex does

When you run the command:

- Rem2Tex reads the currently focused rem: your paper rem, or its `Preamble` rem (then the parent is the paper).
- It looks among the paper's children for:
  - a child titled `Preamble` (any position — children before it, e.g. a `Scratchpad`, are ignored)
  - the first child titled `End` after it
- It converts all children between `Preamble` and `End` into LaTeX body content.
- It assembles output as:
  - preamble block
  - converted body
  - end block
- It creates (if missing) a `Rem2Tex` child under the paper rem.
- It creates a new export rem under that node named `Rem2Tex HH:MM AM/PM DD-MM-YYYY`.
- Under the export rem it writes a `Paper` rem holding a `latex` code block with the document and a `Log` rem holding a `text` code block with the conversion log.
- It shows a one-line toast: exported, exported with warnings (check the log), or failed (see the log).

## Command

The plugin registers:

- `Rem2Tex: Convert Paper to TeX (Copy All Todos as Comments)` (`/rem2tex`)
- `Rem2Tex: Convert Paper to TeX (Copy Unfinished Todos as Comments)` (`/rem2tex-unfinished`)
- `Rem2Tex: Convert Paper to TeX (Do Not Copy Todos as Comments)` (`/rem2tex-no-todos`)
- `Rem2Tex: Paragraph to TeX` (`/rem2tex-paragraph`)
- `Rem2Tex: Toggle Rem2Tex-ignore tag on this rem` (`/rem2tex-ignore`) — see **Ignoring rems**

Run paper commands while focused on the **paper rem** you want to export, or on **any of its children** (`Preamble`, `Abstract`, …): Rem2Tex first checks whether the focused rem is a paper (it has `Preamble`, `End` after it, and rems between them), then whether its parent is. Anything else gets a toast explaining what is missing and nothing is written.

### Paragraph to TeX (`/rem2tex-paragraph`)

Use this on **any** focused rem (not only a paper root). Rem2Tex serializes **that rem and its descendants** with the **same rules as paper body conversion** (headings, images, paragraphs, `% TODO …` comment trees, etc.). **Finished and unfinished todos** are always included as comments (equivalent to “copy all todos”).

It creates a **direct child** of the source rem named `Rem2Tex paragraph HH:MM AM/PM DD-MM-YYYY`, with a **nested** LaTeX code block rem under it. Earlier paragraph exports under the same rem are **not** re-included when you run the command again. This command writes no log; success or failure is shown in a **toast**.

### Output and the log

A **paper** command writes, under the paper rem:

- `Rem2Tex`
  - `Rem2Tex 03:23 PM 03-09-2026`
    - `Paper` (missing when the conversion failed)
      - a `latex` code block: the whole document
    - `Log`
      - a `text` code block: the conversion **log**

There is no dialog. The toast says one of:

- `Rem2Tex: exported “Rem2Tex 03:23 PM 03-09-2026”.`
- `Rem2Tex: exported “…” with 2 warning(s) — check its Log.`
- `Rem2Tex failed: <what went wrong>. See the Log under “…”.`
- `Rem2Tex: <what went wrong>` — when nothing could be written (no focused rem, or not a paper).

The log is plain text meant to be read top to bottom:

- **Setup** — command, todo mode, the paper rem (and the child you started on, if any)
- **Structure** — how many children the paper has, where `Preamble` and `End` sit, the body rems, and what was ignored before `Preamble` / after `End`
- **Conversion** — Preamble/End block sizes, `\documentclass`, `\title`, `\author`, body size
- **Conversion summary** — headings, paragraphs, raw code blocks, figure/table blocks, citations (with their keys), pins dropped from prose, todo comments exported/skipped, `%` comment rems, rems skipped by the `Rem2Tex-ignore` tag
- **Skipped by Rem2Tex-ignore** — each skipped rem with its path (only when there were any)
- **Warnings** — e.g. an image rem without a figure/table block (a `REM2TEX WARNING` box was inserted), plain-text lines under `Preamble`/`End` that a code block took precedence over; each names the rem and its path
- **Result** — `SUCCESS` (with the LaTeX line count) or `FAILED — CODE: headline`, what happened, the section/subsection, the rem being converted with its path, id and text preview, technical detail, and suggestions

Copy the log into a bug report when asking for help.

## Required top-level paper structure

Expected paper tree:

- `Paper` (or any parent rem name)
  - optional rems before `Preamble`, e.g. `Scratchpad` (ignored by converter)
  - `Preamble` (required, any position)
  - body rems (sections/content)
  - `End` (required, the first `End` after `Preamble`)
  - optional extra rems after `End`, e.g. `Supplementary Information`, earlier exports (ignored by converter)

Important behavior:

- `Preamble` does not need to be the first child and `End` does not need to be the last.
- Only what lies strictly between `Preamble` and `End` becomes the paper body; everything before or after is ignored, which allows keeping scratch notes and prior exports in place.
- An `End` that appears before `Preamble` does not count.

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
- Nested `%` comment children (see **Comment rems**): emitted as their own `%` line(s) at the deeper indent, not as a `%  - ` label.

A todo that is **not** exported (mode "do not copy", or a finished todo in "unfinished only") is skipped **together with all of its descendants** — prose or code nested under it never becomes body text.

**Todo status artifact:** RemNote surfaces the checkbox state as a reference to a bookkeeping `Status` rem. Such references are dropped (and any leftover `\cite{Status}` is stripped) so the fragment never appears in the TeX.

**Pins inside `% TODO …` lines:** a comment never reaches the compiled document, so pins are more useful than harmful there. A pin to a Zotero item still becomes `\cite{...}`; any other pin (a todo, a figure, a note) shows the pinned rem's **visible text** instead of being dropped as it is in body prose (see **Citation and rem-link behavior**).

### Comment rems (`%`)

To match normal LaTeX, a rem whose text **starts with `%`** is a comment and is treated exactly like a todo comment:

- its text is emitted **unescaped** (pins resolve as in `% TODO` lines); lines are trimmed, blank lines dropped, and each line of a multi-line text gets a `% ` prefix unless it already starts with `%`
- prose that must **start with a literal percent sign** (e.g. "5% of samples") should start with `\%` — `%5 of samples` is a comment, exactly as in LaTeX
- its **children** become the same indented `%` comment tree as under a todo
- it is emitted in **every** todo mode (it is your own LaTeX comment, not a todo) and stays **in outline order** (it is not hoisted like todo children)
- headings and todos take precedence (a heading starting with `%` is still a heading; a todo is still `% TODO …`), and a **code block** starting with `%` is still a code block

### Ignoring rems (`Rem2Tex-ignore`)

Tag any rem with `Rem2Tex-ignore` and Rem2Tex leaves it **and its whole subtree** out of every export — a section, a paragraph, a todo (in every todo mode, including "copy all"), a `%` comment, or something under `Preamble` / `End`. The tag name is matched case-insensitively.

You do not have to remember the name: run `Rem2Tex: Toggle Rem2Tex-ignore tag on this rem` (`/rem2tex-ignore`) on the focused rem. It adds the tag (creating the `Rem2Tex-ignore` tag rem in your knowledge base the first time) or removes it if it is already there, and says which in a toast. Skipped rems are listed in the export log.

## Preamble and End extraction

`Preamble` and `End` are treated as boundary blocks:

- converter prefers code-formatted content from descendants
- if no code is found, it falls back to plain text
- a `Preamble` / `End` rem with no children is empty (`EMPTY_BOUNDARY_BLOCK`) unless the block sits on its back text; its own title is never exported
- if a boundary subtree mixes code blocks and plain-text rems, the code wins and each plain-text line is appended as a `% REM2TEX: … not exported` comment so nothing disappears silently
- code-block metadata artifacts and RemNote bookkeeping rems (e.g. a heading's `Size` child) are filtered out

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

- it must have at least one immediate child code block containing media LaTeX (a child whose plain text is a `\begin{figure}` / `\begin{table}` environment is accepted too, and emitted unescaped)
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

**RemNote text formatting is not converted.** Bold, italic, underline, sub/superscript, inline code, strikethrough, highlight and colour applied in RemNote are dropped and the text comes out plain. Type the LaTeX yourself (`\textbf{...}`, `\textit{...}`, `\textsuperscript{...}`, …); commands pass through untouched.

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

Pins are the author's tool, not the exporter's. Only one kind of reference means anything to Rem2Tex:

- a **pin or inline reference to a rem under `Zotero/Items`** (the tree the Remzot plugin maintains;
  items you added there by hand before a sync count too) becomes `\cite{<item doc title>}` — Remzot
  names item docs with the citekey. A pin to a note nested *inside* an item cites the item.
- any other **pin** (to a todo, a figure, a section, a note anywhere else) is **dropped from body
  prose** — pin freely for your own navigation and reminders; nothing leaks into the LaTeX. Inside
  `% TODO …` comment lines such pins show the pinned rem's text instead.
- an **inline reference** (a rem reference that is not a pin, i.e. renders the rem's name as words in
  your sentence) to a non-Zotero rem keeps its visible text.
- references to RemNote bookkeeping rems (powerup properties/slots such as a todo's `Status`) are
  always dropped.
- a rem whose text starts with `query:` (a RemNote search-portal payload) exports as nothing.

Rem2Tex no longer turns pins to local figures/tables/code into `\ref{...}`: type the label yourself
(`\ref{fig:setup}`). A pin placed inside a typed `\ref{...}` is dropped like any other pin.

Adjacent citation normalization:

- adjacent citations are merged: `\cite{one}\cite{two}` -> `\cite{one, two}`
- whitespace-separated adjacent citations are merged similarly
- duplicate adjacent keys are deduplicated:
  - `\cite{one}\cite{one}\cite{two}` -> `\cite{one, two}`

Typed citation/reference commands around a pin are not doubled:

- if you type `\cite{`, then pin the paper's rem, then `}`, the pin's own `\cite{key}` is unwrapped
  into your command: `\cite{` + pin + `}` -> `\cite{key}` (not `\cite{\cite{key}}`)
- works for `\citep`, `\citet`, `\parencite`, `\textcite`, `\autocite`, etc. (with `*` / `[options]`)
- mixed and multiple keys are kept and deduplicated: `\cite{smith2020, ` + pin + `}` ->
  `\cite{smith2020, key}`

Citation key details:

- key = the Zotero item doc's title with whitespace removed and characters outside `A-Z a-z 0-9 : _ -`
  stripped; a title that is already a `\cite{...}` is used verbatim
- fallback: `\cite{rem_<id>}` if the item doc has no usable title

For code-only extraction:

- rem reference tokens are ignored to avoid importing UI metadata into code output

## Error and warning behavior

Errors that stop before anything is written (toast only):

- no focused/selected rem (`NO_FOCUSED_REM`, `INACCESSIBLE_REM`)
- the focused rem is not a paper and neither is its parent (`NOT_A_PAPER`) — the toast says what is
  missing on each: no `Preamble`, no `End` after it, or nothing between them

Errors during the conversion (an export rem with only the log is written; the toast says to read it):

- empty `Preamble` / `End` block (`EMPTY_BOUNDARY_BLOCK`)
- an unexpected failure while converting a body rem (`REM_CONVERSION_FAILED`) — the log names the
  rem, its section and its path so you can find it

Warnings (conversion continues; counted in the toast and listed in the log):

- image rem without a valid child figure/table code block (a `REM2TEX WARNING` box is inserted)
- plain-text lines under `Preamble` / `End` that lost to a code block (kept as `% REM2TEX:` comments)

## Authoring recommendations

To get stable output:

- keep full document preamble only under `Preamble`
- keep full document tail under `End`
- use heading formatting for section hierarchy
- put complex LaTeX (tables/figures/equations) in code blocks when possible
- for figure/image rems, always include child figure/table code block(s)
- cite by pinning the paper's rem under `Zotero/Items` (optionally inside a typed `\cite{…}`), or type
  the key; type `\ref{label}` yourself for figures/tables/equations
- pin todos, figures and notes into your prose as much as you like — those pins never export

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
      - `Paper`
        - `latex` code block
      - `Log`
        - `text` code block
    - `Rem2Tex 11:05 AM 19-04-2026` (auto-generated export)
      - `Paper`
        - `latex` code block
      - `Log`
        - `text` code block

## Development

- The npm package name is `rem2tex-mo` (see `package.json`).
- Build for RemNote: `npm install` then `npm run build` — produces `PluginZip.zip` in the project root for sideloading.

## Notes

- This plugin is optimized for author-driven LaTeX workflows where RemNote stores structure and draft text, and code blocks store exact LaTeX for complex constructs.
- Existing exports can stay in the tree; they are safely ignored if placed after `End`.
