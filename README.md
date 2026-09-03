<div align="center">

<img src="public/logo.png" alt="Rem2Tex" width="120" height="120" />

# Rem2Tex

**Write your paper as a Remnote outline — export it as a LaTeX document.**

</div>

Rem2Tex is a [Remnote](https://www.remnote.com) plugin for authors who draft papers in Remnote.
Headings become `\section`s, prose is LaTeX-escaped, code blocks pass through untouched, pins to your
Zotero library become `\cite{…}`, and todos become `% TODO` comments. One command turns the outline
into a complete `.tex` document and writes it — together with a readable conversion log — right back
into your knowledge base.

> [!IMPORTANT]
> **Rem2Tex only ever adds.** It never edits or deletes your rems. Each export creates a new
> `Rem2Tex <timestamp>` rem under your paper (with the document and a log as code blocks); everything
> else in your outline is read, not touched.

> [!WARNING]
> **Vibe-coded — experimental.** Rem2Tex was built largely by prompting an AI assistant, with light
> human review. Check the generated LaTeX and read the log; expect rough edges.

---

## What it does

### Paper export
- **Your outline is the paper.** A paper is any rem whose children contain a **`Preamble`**, an
  **`End`** after it, and the body rems between them. Rems before `Preamble` (a scratchpad, notes) and
  after `End` (supplementary material, earlier exports) are ignored.
- **Run it anywhere on the paper** — on the paper rem itself or on any of its children (`Preamble`,
  `Abstract`, …). Rem2Tex first checks whether the focused rem is a paper, then whether its parent is.
- **Output in place:** a `Rem2Tex` folder under the paper rem gets a new `Rem2Tex HH:MM AM/PM
  DD-MM-YYYY` rem per run, holding a **`Paper`** rem (a `latex` code block with the whole document)
  and a **`Log`** rem (a `text` code block with the conversion log).
- **One-line toast:** exported; exported with *n* warnings — check the log; failed — see the log; or,
  when nothing could be written (no focused rem, not a paper), the reason itself.

### Body conversion
- **Headings → sections.** Rems with Remnote heading formatting become `\section`, `\subsection`,
  `\subsubsection`, `\paragraph`, `\subparagraph` by outline depth (the H1/H2/H3 size is ignored).
- **Prose → paragraphs**, LaTeX-escaped (`%`, `&`, `_`, `#`, `$`, `{`, `}`, `^`, `\`) while anything
  you typed as LaTeX — `\ce{ZnSnN2}`, `\textbf{…}`, `$E_g$`, `\begin{equation}…\end{equation}` — passes
  through untouched. Remnote's own bold/italic/underline formatting is *not* converted: type the LaTeX.
- **Code blocks → verbatim.** A rem that is a code block is emitted as-is; put tables, figures and
  anything fragile in code blocks.
- **Math elements → `$…$` / `$$…$$`**, with the usual clean-ups inside `equation` / `align` /
  `gather` / `multline` environments (no nested delimiters, no stray blank lines before `\label`).
- **Images → figures.** A rem containing an image must carry the LaTeX for it as a child code block
  (or plain text) with `\begin{figure}` or `\begin{table}`; those blocks are emitted, the image itself
  and the caption text are not. A missing block yields a visible `REM2TEX WARNING` box.

### Citations from Zotero
- A **pin or reference to a rem under `Zotero / Items`** (the tree the [Remzot](https://github.com/msf999/remzot)
  plugin maintains — items you add there by hand count too) becomes `\cite{<citekey>}`, the item doc's
  title being the key. A pin to a note nested inside an item cites the item.
- **Typed commands are never doubled:** `\cite{` + pin + `}` → `\cite{key}`, `\citep[p. 3]{` + pin +
  `}` → `\citep[p. 3]{key}`; adjacent citations merge into `\cite{a, b}`.
- **Every other pin is yours.** Pins to todos, figures, sections or notes are dropped from prose, so
  pin freely for navigation. Inline references to other rems keep their visible text.

### Todos, comments, ignoring
- **Todos → `% TODO [ ] …` / `% TODO [X] …` comments**, with their subtree as indented `%` lines (one
  space per level). Three commands choose the policy: all todos, unfinished only, none.
- **A rem that starts with `%` is a LaTeX comment**, treated like a todo: emitted unescaped with its
  subtree as comments, in every todo mode.
- **`Rem2Tex-ignore`:** tag any rem and it — with its whole subtree — is left out of every export.
  The `/rem2tex-ignore` command toggles the tag on the focused rem so you never type the name.

### Paragraph export
`Rem2Tex: Paragraph to TeX` converts just the focused rem and its descendants with the same body
rules (all todos as comments) and adds a `Rem2Tex paragraph <timestamp>` child with the LaTeX. Handy
for one section; it writes no log.

---

## How your paper looks in Remnote

```
Paper (any name)
├─ Scratchpad                    ← anything before Preamble is ignored
├─ Preamble                      ← required; its code block holds \documentclass … \begin{document}
│  └─ [latex code block]
├─ Abstract                      ← heading → \section{Abstract}
│  └─ We study …                    prose → escaped paragraph
├─ Introduction                  ← heading
│  ├─ Renewed interest \cite{ ⟨pin → Zotero/Items/keFirst2024⟩ } …
│  ├─ % reviewer 2 asked for more context on this      ← % rem → comment line
│  └─ ☐ add the ZnTiN2 numbers                          ← todo → % TODO [ ] add the …
├─ Results and Discussion
│  ├─ [image rem]
│  │  └─ [latex code block: \begin{figure} … \label{fig:setup} … \end{figure}]
│  └─ [latex code block: \begin{table} … \end{table}]
├─ End                           ← required, the first End after Preamble; \end{document} etc.
│  └─ [latex code block]
├─ Supplementary Information     ← anything after End is ignored
└─ Rem2Tex                       ← created by Rem2Tex, appended after End
   └─ Rem2Tex 03:23 PM 03-09-2026
      ├─ Paper
      │  └─ [latex code block]     the whole document
      └─ Log
         └─ [text code block]      the conversion log
```

> [!TIP]
> Cite by pinning the paper's rem under `Zotero / Items` — inside a typed `\cite{…}` if you like — or
> type the key. Type `\ref{fig:setup}` yourself for figures, tables and equations; a pin inside
> `\ref{…}` is dropped like any other pin. Prose that must start with a literal percent sign begins
> with `\%`.

---

## Setup

1. **Install.** Rem2Tex is unlisted. Either load it from the dev server (`npm run dev`, then in
   Remnote **Settings → Plugins → Build → `http://localhost:8080`**) or build `PluginZip.zip`
   (`npm run build`) and load that as a local plugin. There are no settings to fill in.
2. **Structure your paper** as above: a paper rem with `Preamble` and `End` children (each with a
   code block) and your sections between them.
3. **Type `/` on the paper rem** (or any of its children) and run **Rem2Tex: Convert Paper to TeX**
   (quick code `rem2tex`). Open the new `Rem2Tex <timestamp>` rem, copy the `Paper` code block into
   your `.tex` project, and read the `Log` if the toast asked you to.

## Commands

| Command | Quick code | What it does |
| --- | --- | --- |
| **Rem2Tex: Convert Paper to TeX (Copy All Todos as Comments)** | `rem2tex` | Export the paper; every todo becomes a `% TODO` comment. |
| **Rem2Tex: Convert Paper to TeX (Copy Unfinished Todos as Comments)** | `rem2tex-unfinished` | Export the paper; only unfinished todos are kept as comments (finished ones vanish with their subtrees). |
| **Rem2Tex: Convert Paper to TeX (Do Not Copy Todos as Comments)** | `rem2tex-no-todos` | Export the paper without any todo comments (todos vanish with their subtrees). |
| **Rem2Tex: Paragraph to TeX** | `rem2tex-paragraph` | Convert the focused rem and its descendants into a `Rem2Tex paragraph <timestamp>` child. |
| **Rem2Tex: Toggle Rem2Tex-ignore tag on this rem** | `rem2tex-ignore` | Add or remove the `Rem2Tex-ignore` tag on the focused rem (creates the tag rem the first time). |

## The log

Every paper export writes a plain-text log next to the document, meant to be read top to bottom:

- **Setup** — command, todo mode, the paper rem (and the child you started on, if any)
- **Structure** — how many children the paper has, where `Preamble` and `End` sit, the body rems, what was ignored before `Preamble` / after `End`
- **Conversion** — Preamble/End block sizes, `\documentclass`, `\title`, `\author`, body size
- **Conversion summary** — headings, paragraphs, raw code blocks, figure/table blocks, citations (with their keys), pins dropped from prose, todo comments exported/skipped, `%` comment rems, rems skipped by `Rem2Tex-ignore`, earlier exports skipped
- **Skipped by Rem2Tex-ignore** — each skipped rem with its path (only when there were any)
- **Warnings** — content that did not make it into the document, each naming the rem and its path (see *Errors and warnings*)
- **Result** — `SUCCESS` with the LaTeX line count, or `FAILED — CODE: headline` with what happened, the section, the rem being converted (path, id, text preview), technical detail and suggestions

Copy the log into a bug report when asking for help.

---

## Reference

### Preamble and End
`Preamble` and `End` are read as **boundary blocks**: every descendant contributes its code block(s)
(front or back text); if a boundary rem has no code at all, its descendants' plain text is used
instead. When a boundary subtree mixes code blocks and plain-text rems the code wins and each
plain-text line is appended as a `% REM2TEX: … not exported` comment (and listed as a warning) so
nothing disappears silently. A `Preamble`/`End` rem with no children is empty unless the block sits on
its back text — its own title is never exported. Remnote bookkeeping (`Size`, `Language`, trailing
`true`/`false`/`latex` lines) is filtered out.

### Todo details
- Unfinished → `% TODO [ ] …`, finished → `% TODO [X] …`; a rem that is both a heading and a todo is a heading.
- Children of an exported todo become indented `%` lines: non-todo children as `%  - <title>`, nested todos as their own `% TODO …` line, nested `%` rems as their own comment line — the whole line shifts right one space per level.
- A todo the mode skips takes **all** its descendants with it (prose or code under a finished todo is gone in "unfinished only" mode); the log warns when that loses non-todo content.
- Pins inside `% TODO` and `%` comment lines show the pinned rem's text (a Zotero pin still becomes `\cite{…}`); the todo status marker Remnote stores as a `Status` reference is dropped.
- Children of a prose rem are exported in outline order; comment lines sit tight under whatever precedes them, other children start a new paragraph.

### Comment rems (`%`)
A rem whose text starts with `%` is emitted unescaped (lines trimmed, blank lines dropped, `% ` prefixed to lines that lack it), with its children as the same comment tree as a todo, in every todo mode. Headings, todos and code blocks take precedence over the `%` rule. `%5 of samples` is a comment, exactly as in LaTeX — write `\%5 …` for prose.

### Ignoring rems (`Rem2Tex-ignore`)
The tag is the **top-level** rem named exactly `Rem2Tex-ignore` (the toggle command creates it there); a same-named rem nested elsewhere is not recognised. Tagged rems and their subtrees are skipped everywhere — sections, prose, todos in every mode, `%` comments, even under `Preamble`/`End` — and listed in the log. Rem2Tex reads the tag's list of tagged rems once per export, so the tag costs nothing when unused.

### Citation details
- Key = the Zotero item doc's title with whitespace removed and characters outside `A-Z a-z 0-9 : _ -` stripped; a title that already is a `\cite{…}` is used verbatim; fallback `\cite{rem_<id>}`.
- `\cite{one}\cite{two}` → `\cite{one, two}`; whitespace-separated citations merge too; duplicate keys are removed.
- Typed `\cite`, `\citep`, `\citet`, `\parencite`, `\textcite`, `\autocite`, … (with `*` / `[options]`) around pins are unwrapped; `\cite{smith2020, ` + pin + `}` → `\cite{smith2020, key}`.
- References to Remnote bookkeeping rems (powerup properties/slots) and rems whose text starts with `query:` export as nothing. Rem2Tex's own earlier export rems inside the body are skipped.

### Escaping and math
Protected as-is: LaTeX commands with their `[…]`/`{…}` arguments, `$…$`, `$$…$$`, `\(…\)`, `\[…\]`, and `\begin{…}…\end{…}` environments (nested same-name environments included). Everything else has `{ } $ & # % _ ^ \` escaped. Remnote math elements become `$…$`, or `$$…$$` when marked as block; inside `equation`/`align`/`gather`/`multline` (and starred variants) per-line `$…$` wrappers are removed and blank lines before `\label` collapsed. Body rems use their main text only; `Preamble`/`End` and figure children may also use back text.

### Errors and warnings
Toast only, nothing written: no focused rem (`NO_FOCUSED_REM`, `INACCESSIBLE_REM`); the focused rem is not a paper and neither is its parent (`NOT_A_PAPER` — the toast says what is missing on each: no `Preamble`, no `End` after it, or nothing between them).

Written into the log (an export rem with only the `Log` rem; the toast says to read it): an empty `Preamble`/`End` block (`EMPTY_BOUNDARY_BLOCK`); an unexpected failure while converting a body rem (`REM_CONVERSION_FAILED` — the log names the rem, its section and path).

Warnings (conversion continues; counted in the toast, listed in the log): an image rem without a figure/table block (a `REM2TEX WARNING` box is inserted); an image rem's children that are not figure/table blocks (not exported); plain-text lines under `Preamble`/`End` that lost to a code block; a todo skipped by the mode together with non-todo descendants.

---

## Development

- `npm ci` on **Node 16.15.1** (`.nvmrc`), then `npm run dev` for the dev server on port 8080.
- `npx tsc --noEmit` type-checks `src/` and `tests/`; `npm test` runs the exporter against a fake
  knowledge base (no framework).
- `npm run build` validates the manifest and writes `PluginZip.zip` (removing the old one first).
- The plugin registers no settings, no widgets and no powerups; its only scope is
  `All = ReadCreateModify` (it never deletes).
