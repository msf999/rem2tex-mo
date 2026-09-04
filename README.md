<div align="center">

<img src="public/logo.png" alt="Rem2Tex" width="120" height="120" />

# Rem2Tex

**Write your paper as a Remnote outline — export it as a LaTeX document.**

</div>

Rem2Tex is a [Remnote](https://www.remnote.com) plugin for authors who draft papers in Remnote.
Headings become `\section`s, prose is LaTeX-escaped, code blocks pass through untouched, pins to your
Zotero library become `\cite{…}`, and todos become `% TODO` comments. One command turns the outline
into a complete `.tex` document and writes it — with a readable conversion log — back into your
knowledge base.

> [!IMPORTANT]
> **Exports only ever add.** A conversion creates a new `Rem2Tex <timestamp>` rem under your paper and
> never edits or deletes anything else. The one command that modifies a rem is `/rem2tex-ignore`,
> which toggles the `Rem2Tex-ignore` tag on the rem you run it on.

> [!WARNING]
> **Vibe-coded — experimental.** Built largely by prompting an AI assistant, with light human review.
> Check the generated LaTeX and read the log; expect rough edges.

---

## How your paper looks in Remnote

```
Paper (any name)
├─ Scratchpad                    ← anything before Preamble is ignored
├─ Preamble                      ← required; code block with \documentclass … \begin{document}
│  └─ [latex code block]
├─ Abstract                      ← heading → \section{Abstract}
│  └─ We study …                    prose → escaped paragraph
├─ Introduction                  ← heading
│  ├─ As shown \cite{ ⟨pin → Zotero/Items/smith2020⟩ } …
│  ├─ % reviewer 2 asked for more context here     ← % rem → comment line
│  └─ ☐ add the missing numbers                    ← todo → % TODO [ ] add the …
├─ Results
│  ├─ [image rem]
│  │  └─ [latex code block: \begin{figure} … \label{fig:setup} … \end{figure}]
│  └─ [latex code block: \begin{table} … \end{table}]
├─ End                           ← required, the first End after Preamble; \end{document} etc.
│  └─ [latex code block]
├─ Supplementary Information     ← anything after End is ignored
└─ Rem2Tex                       ← created by Rem2Tex, one child per run
   └─ Rem2Tex 03:23 PM 03-09-2026
      ├─ Paper  → [latex code block]   the whole document
      └─ Log    → [text code block]    the conversion log
```

Run the command on the paper rem **or on any of its children** — Rem2Tex checks the focused rem, then
its parent.

---

## Setup

1. **Install.** Rem2Tex is unlisted: load it from the dev server (`npm run dev`, then in Remnote
   **Settings → Plugins → Build → `http://localhost:8080`**), or build `PluginZip.zip`
   (`npm run build`) and load that as a local plugin. There are no settings to fill in.
2. **Structure your paper** as above: `Preamble` and `End` children, each with a code block, and your
   sections between them.
3. **Type `/rem2tex`** on the paper rem (or any child), then copy the `Paper` code block into your
   `.tex` project — and read the `Log` if the toast asked you to.

## Commands

All five are prefixed **`Rem2Tex:`** in the omnibar.

| Command | Quick code | What it does |
| --- | --- | --- |
| **Convert Paper to TeX (Copy All Todos as Comments)** | `rem2tex` | Export the paper; every todo becomes a `% TODO` comment. |
| **Convert Paper to TeX (Copy Unfinished Todos as Comments)** | `rem2tex-unfinished` | The same, but finished todos vanish with their subtrees. |
| **Convert Paper to TeX (Do Not Copy Todos as Comments)** | `rem2tex-no-todos` | The same, with no todo comments at all. |
| **Paragraph to TeX** | `rem2tex-paragraph` | Convert just the focused rem and its descendants into a `Rem2Tex paragraph <timestamp>` child. No log; if it yields nothing, the toast says so. |
| **Toggle Rem2Tex-ignore tag on this rem** | `rem2tex-ignore` | Add or remove the `Rem2Tex-ignore` tag, creating the tag rem the first time. |

---

## What gets converted

| In Remnote | In the LaTeX |
| --- | --- |
| Heading rem | `\section`, `\subsection`, `\subsubsection`, `\paragraph`, `\subparagraph` — by **outline depth**, not by the H1/H2/H3 size |
| Prose rem | an escaped paragraph: `% & _ # $ { } ^` are escaped, while anything you typed as LaTeX (`\textbf{…}`, `$x^2$`, `\begin{equation}…\end{equation}`) passes through untouched — a `\` always starts a command, so write `\textbackslash{}` for a literal backslash |
| Code block rem | verbatim — put tables, figures and anything fragile in one |
| Math element | `$…$`, or `$$…$$` when marked as block |
| Image rem | only the `\begin{figure}` / `\begin{table}` code block you put underneath it; the image, its own caption text and any other children are dropped (the log says which), and with no such block you get a visible `REM2TEX WARNING` box |
| Pin or reference into `Zotero / Items` | `\cite{<citekey>}` — the item doc's title is the key |
| Any other pin | dropped from prose, so pin freely for navigation; inline (non-pin) references keep their visible text |
| Todo | `% TODO [ ] …` / `% TODO [X] …`, with its subtree as indented `%` lines (one space per level) |
| Rem starting with `%` | a comment line with its subtree, in every todo mode — as in LaTeX, `%5 of samples` is a comment, so write `\%5` for prose |
| Rem tagged `Rem2Tex-ignore` | nothing: it and its whole subtree are left out of every export |

The `Zotero / Items` tree is the one the [Remzot](https://github.com/msf999/remzot) plugin maintains —
items you added there by hand count too, and a pin to a note nested inside an item cites the item.

> [!TIP]
> Cite by pinning the item, inside a typed `\cite{…}` if you like: typed commands are never doubled
> and adjacent citations merge into `\cite{a, b}`. Rem2Tex never generates `\ref{}` — type
> `\ref{fig:setup}` yourself, and a pin inside `\ref{…}` is dropped like any other pin.

---

## Output and the log

Every paper export writes `Rem2Tex / Rem2Tex <timestamp> / { Paper, Log }` under the paper rem and
toasts one line — exported, exported with *n* warnings, or failed, read the log. The log is plain
text: **Setup** (command, todo mode, paper rem) · **Structure** (where `Preamble` and `End` sit, which
body rems were converted, what was ignored) · **Conversion** (block sizes, `\documentclass`, `\title`,
`\author`) · **Conversion summary** (counts, citation keys, dropped pins, todo comments, skipped rems)
· **Skipped by Rem2Tex-ignore** · **Warnings** (each naming the rem and its path) · **Result**
(`SUCCESS` with the line count, or the failure with what happened, the rem, its path and suggestions).
Copy it into a bug report when asking for help.

Problems found before a paper is located are toasted and nothing is written: no focused rem, or the
focused rem and its parent are both not papers — the toast says what is missing on each (no
`Preamble`, no `End` after it, or nothing between them). An empty `Preamble`/`End` block, or a failure
part-way through the conversion, still writes an export rem with the log in it.

## Details worth knowing

- **`Preamble` and `End` are boundary blocks:** every descendant contributes its code (front or back
  text); with no code at all, the descendants' plain text is used instead; when a subtree mixes the
  two, the code wins and each dropped line is appended as a `% REM2TEX: …` comment. The boundary rem's
  own back text counts too, its title never does — so a boundary rem with nothing under it is an error.
  Back text is read **only** there and under an image rem: an ordinary body rem exports its front text,
  so a rem written as a card contributes just its front side.
- **Earlier Rem2Tex exports are never re-exported**, wherever they sit in the outline, so re-running a
  command never feeds an old export back into the new one.
- **A todo the mode skips takes its whole subtree with it** (prose under a finished todo is gone in
  "unfinished only" mode); the log warns when that loses non-todo content.
- **Citation keys** are the item doc's title with whitespace removed and anything outside
  `A-Z a-z 0-9 : _ -` stripped; duplicate keys merge.
- **`Rem2Tex-ignore` must be the top-level rem** with exactly that name (the toggle command creates it
  there); a same-named rem nested elsewhere is not recognised.
- **Remnote's own bold/italic/underline are not converted** — type the LaTeX you want.

---

## Development

- `npm ci` on **Node 16.15.1** (`.nvmrc`), then `npm run dev` for the dev server on port 8080.
- `npx tsc --noEmit` type-checks `src/` and `tests/`; `npm test` runs the exporter against a fake
  knowledge base (no framework).
- `npm run build` validates the manifest and writes `PluginZip.zip` (removing the old one first).
