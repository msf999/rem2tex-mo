<div align="center">

<img src="public/logo.png" alt="Rem2Tex" width="120" height="120" />

# Rem2Tex

**Write your paper as a Remnote outline — export it as a LaTeX document.**

</div>

Rem2Tex is a [Remnote](https://www.remnote.com) plugin for authors who draft papers in Remnote.
Headings become `\section`s, prose is LaTeX-escaped, code blocks pass through untouched, pins to your
Zotero library become `\cite{…}`, and todos become `% TODO` comments. One command turns the outline
into a complete `.tex` document and writes it — with a readable conversion log — back into your
knowledge base. Another takes just the rems you have selected and gives you `[1]`-style numbered
citations with a matching bibliography, built from your Zotero item properties.

> [!IMPORTANT]
> **Exports only ever add.** A conversion creates a new `Rem2Tex <timestamp>` (or
> `Rem2Tex selection <timestamp>`) rem and never edits or deletes anything else. The one command that
> modifies a rem is `/rem2tex-ignore`, which toggles the `Rem2Tex-ignore` tag on the rem you run it on.

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

1. **Structure your paper** as above: `Preamble` and `End` children, each with a code block, and your
   sections between them.
2. **Type `/rem2tex`** on the paper rem (or any child), then copy the `Paper` code block into your
   `.tex` project — and read the `Log` if the toast asked you to.

## Commands

All six are prefixed **`Rem2Tex:`** in the omnibar.

| Command | Quick code | What it does |
| --- | --- | --- |
| **Convert Paper to TeX (Copy All Todos as Comments)** | `rem2tex` | Export the paper; every todo becomes a `% TODO` comment. |
| **Convert Paper to TeX (Copy Unfinished Todos as Comments)** | `rem2tex-unfinished` | The same, but finished todos vanish with their subtrees. |
| **Convert Paper to TeX (Do Not Copy Todos as Comments)** | `rem2tex-no-todos` | The same, with no todo comments at all. |
| **Selection to TeX (Numbered Citations + Bibliography)** | `rem2tex-selection` | Convert the selected rem(s) into one code block whose citations are `[1]`, `[2]` … followed by a numbered bibliography. See [Numbered citations](#numbered-citations-and-the-bibliography). |
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

## Numbered citations and the bibliography

`Rem2Tex: Selection to TeX` is for the times you want a self-contained excerpt — a section to send a
co-author, a paragraph for a grant form — rather than the whole paper. **Select the rems** you want
(click a bullet, `Esc`, `Shift+↓` for more), then run the command from the omnibar.

It converts the selection with the ordinary body rules — headings, escaping, code blocks, todos as
`% TODO` comments, the `Rem2Tex-ignore` tag — and then does two extra things:

1. **Every citation becomes a number.** `\cite{smith2020}` becomes `[1]`, the next new work `[2]`, and
   so on **in order of first appearance**; citing the same work again reuses its number. Typed
   wrappers keep their meaning: `\supercite{…}` becomes `\textsuperscript{[1]}`, `\cite[p. 3]{…}`
   becomes `[1, p. 3]`, `\citenum{…}` becomes a bare `1`, and `\nocite{…}` prints nothing but still
   earns a bibliography entry. `\citeauthor{…}` and `\citeyear{…}` print a name or a year rather than
   a label, so they are left exactly as you typed them — their work still gets an entry.
2. **A numbered bibliography is appended**, formatted like `biblatex`'s `numeric` style.

```
\section{Results}

The defect levels align with earlier work [1, 2], and the correction scheme [3] is unchanged.

% ---------------- Bibliography ----------------

[1] Audrius Alkauskas, Peter Broqvist, and Alfredo Pasquarello. "Defect Energy Levels in Density
Functional Calculations". In: Physical Review Letters (July 2008). doi: 10.1103/PhysRevLett.101.046405.

[2] R M Martin. "Electronic structure: Basic theory and practical methods". In: Cambridge University
Press (2020). url: https://books.google.com.au/books?id=dmRTFLpSGNsC.
```

Where the export lands depends on what you selected: **one rem** → the export is a child of that rem;
**several rems** → it is a sister, inserted right after the last of them. Either way it is a
`Rem2Tex selection <timestamp>` rem with a single `latex` code block. There is no log — the toast says
how many works were cited, and anything missing is written into the bibliography itself.

### Where the bibliography comes from

Each entry is read from the properties [Remzot](https://github.com/msf999/remzot) writes onto the item
doc — Title, Authors, Publication, Date, DOI and Link(s). Authors are stored as `Last, First` and
printed as `First Last`; more than three of them truncate to `First author et al.`, exactly as
biblatex does. An item with **no DOI falls back to its link**, printed as `url: …` — and it is the
real address, not the shortened text Remnote shows on a link.

> [!NOTE]
> Remzot does not store **volume, issue, pages or ISSN**, so those parts of a full biblatex entry can
> never appear. Entries are otherwise complete; fields the item simply does not have are left out
> silently. Entries are plain text — straight quotes, an unstyled journal name, a lowercase `doi:` —
> so the block reads as written rather than as LaTeX source.

A citekey with nothing behind it still gets a number, and says why in its entry:

```
[7] smith2019. [Rem2Tex: no metadata — no item titled "smith2019" was found under Zotero/Items.]
```

You will see that when you typed `\cite{key}` by hand for an item you have not added yet, or when the
item doc exists but has never been synced (then it reads *its Zotero properties are empty*).

> [!TIP]
> Citations inside `%` comments never create bibliography entries — a `% TODO read \cite{…}` reminder
> is not a citation. If the body cites that work anyway, the comment shows its number too.

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
