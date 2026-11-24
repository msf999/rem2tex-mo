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

Converting a paper opens a **preview** first: it shows what will be exported, lets you choose how
todos are handled, and lists the Zotero pins it can turn into visible citekeys — see
[Pins that become citekeys](#pins-that-become-citekeys).

> [!IMPORTANT]
> **Exporting only ever adds. Two things change your rems, and both need your say-so.** A conversion
> creates a new `Rem2Tex <timestamp>` (or `Rem2Tex paragraph` / `Rem2Tex selection <timestamp>`) rem
> and never edits or deletes anything else. The exceptions: leaving **Convert N pins to citekeys**
> ticked in the preview rewrites the prose rems that the preview lists — it keeps your pins and
> records every change under `Rem2Tex rewrite <timestamp>` — and `/rem2tex-ignore` toggles the
> `Rem2Tex-ignore` tag on the rem you run it on. Nothing is ever deleted.

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
│  ├─ As shown ⟨pin → Zotero/Items/smith2020⟩ …    pin → \cite{smith2020}
│  ├─ See Figure~\ref{⟨pin → the figure⟩}.         pin inside \ref → \ref{fig:setup}
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
   ├─ Rem2Tex 03:23 PM 03-09-2026
   │  ├─ [latex code block]            the whole document
   │  └─ Log    → [text code block]    the conversion log
   └─ Rem2Tex rewrite 03:23 PM 03-09-2026    ← only if you ticked the citekey option
```

Run the command on the paper rem **or on any of its children** — Rem2Tex checks the focused rem, then
its parent.

---

## Setup

1. **Structure your paper** as above: `Preamble` and `End` children, each with a code block, and your
   sections between them.
2. **Type `/rem2tex`** on the paper rem (or any child). A preview opens: pick how todos are handled,
   decide whether to write citekeys beside your Zotero pins, and press **Convert and export**.
3. Copy the `Paper` code block into your `.tex` project — and read the `Log` if the toast asked you to.

## Commands

All four are prefixed **`Rem2Tex:`** in the omnibar.

| Command | Quick code | What it does |
| --- | --- | --- |
| **Convert Paper to TeX** | `rem2tex` | Export the paper. Always opens the preview, because that is where you choose the todo mode. |
| **Convert Paragraph to TeX** | `rem2tex-paragraph` | Convert the focused rem and its descendants into a `Rem2Tex paragraph <timestamp>` child. No log. |
| **Convert Selection to TeX (Numbered Citations + Bibliography)** | `rem2tex-selection` | Convert the selected rem(s) into one code block whose citations are `[1]`, `[2]` … followed by a numbered bibliography. See [Numbered citations](#numbered-citations-and-the-bibliography). |
| **Toggle Rem2Tex-ignore tag on this rem** | `rem2tex-ignore` | Add or remove the `Rem2Tex-ignore` tag, creating the tag rem the first time. |

**Paragraph** and **Selection** only open the preview when there is something to say — pins that could
become citekeys, or a problem worth seeing. Otherwise they just run and toast. The todo choice is
offered for papers only; Paragraph and Selection always comment every todo. However long you spend
in the preview, **Convert exports the rem the preview showed**, even after you've clicked elsewhere.

---

## What gets converted

| In Remnote | In the LaTeX |
| --- | --- |
| Heading rem | `\section`, `\subsection`, `\subsubsection`, `\paragraph`, `\subparagraph` — by **outline depth**, not by the H1/H2/H3 size |
| Prose rem | an escaped paragraph: `% & _ # $ { } ^` are escaped, while anything you typed as LaTeX (`\textbf{…}`, `\"{o}`, `\verb\|…\|`, `$x^2$`, `\begin{equation}…\end{equation}`) passes through untouched — so does a `\begin{itemize}` or `\[` whose `\end` is in a later rem, so a list can be split across sibling rems. A `\` always starts a command, so write `\textbackslash{}` for a literal backslash |
| Code block rem | verbatim, character for character — put tables, figures and anything fragile in one |
| Math element | `$…$`, or `$$…$$` when marked as block |
| Image rem | only the `\begin{figure}` / `\begin{table}` code block you put underneath it; the image, its own caption text and any other children are dropped (the log says which), and with no such block you get a visible `REM2TEX WARNING` box |
| Pin or reference into `Zotero / Items` | `\cite{<citekey>}` — the item doc's title is the key |
| Pin inside a `\ref{…}` you typed (or `\cref`, `\eqref`, …) | the `\label` of the rem it points at — see [References to figures, tables and sections](#references-to-figures-tables-and-sections) |
| Any other pin | dropped from prose, so pin freely for navigation; inline (non-pin) references keep their visible text |
| Todo | `% TODO [ ] …` / `% TODO [X] …`, with its subtree as indented `%` lines (one space per level) |
| Rem starting with `%` | a comment line with its subtree, in every todo mode — as in LaTeX, `%5 of samples` is a comment, so write `\%5` for prose |
| Rem tagged `Rem2Tex-ignore` | nothing: it and its whole subtree are left out of every export |

The `Zotero / Items` tree is the one the [Remzot](https://github.com/msf999/remzot) plugin maintains —
items you added there by hand count too, and a pin to a note nested inside an item cites the item.

> [!TIP]
> Cite by pinning the item, inside a typed `\cite{…}` if you like: typed commands are never doubled
> and adjacent citations merge into `\cite{a, b}`. Refer to a figure the same way, with a pin
> inside a typed `\ref{…}` — see [below](#references-to-figures-tables-and-sections).

---

## Pins that become citekeys

A pin to a Zotero item exports as `\cite{citekey}`, but in Remnote it shows only as a pin icon — so
while drafting you cannot see *which* paper you cited without clicking. Rem2Tex can write the citekey
into the rem for you and **keep the pin**, so you get both: the key is readable in the outline, and
the pin still takes you to the exact passage you took the claim from.

Every preview lists the pins it can convert, with the before and after text. Leave **Convert N pins
to citekeys** ticked — it is ticked by default whenever there is at least one — and they are written
when you press Convert.

```
before    This matters ⟨pin⟩.
after     This matters \cite{smith2020⟨pin⟩}.
```

The citekey is written as a **rem reference** to the item's page, not as plain text — so it still
reads as a link, renames itself if you rename the item, and matches how you would have typed the
citation by hand. The pin goes **inside** the braces, next to the key it belongs to:

| In the outline | Becomes |
| --- | --- |
| `⟨pin A⟩` | `\cite{keyA⟨pin A⟩}` |
| `⟨pin A⟩⟨pin B⟩` (or separated by spaces) | `\cite{keyA⟨pin A⟩, keyB⟨pin B⟩}` — one command, both works |
| the same paper pinned twice | `\cite{keyA⟨pin A⟩⟨pin A⟩}` — one key, both pins kept |
| `\supercite{⟨pin A⟩}` you typed yourself | `\supercite{keyA⟨pin A⟩}` — your command is kept |
| `\cite{other2000} ⟨pin A⟩` | `\cite{other2000, keyA⟨pin A⟩}` — the pin joins the plain `\cite` beside it |

> [!IMPORTANT]
> **The exported LaTeX does not change.** Converting is a convenience for reading your own outline,
> never a change to the document: the `.tex` you get is byte-identical before and after. (One
> improvement, not a change: if you had typed something inside the braces right against a pin with
> no comma, as in `\cite{other2000⟨pin⟩}`, it used to export as one nonexistent key,
> `\cite{other2000smith2020}`. Converting separates the two properly.)

A pin joins only a **plain `\cite{…}`** right beside it, with nothing but spaces between them; the
spaces go too, as they do when the export merges two citations. In every other case the pin gets a
`\cite{…}` of its own:
- next to any other command (`\nocite`, `\citeauthor`, `\citep`, `\cite*`, …);
- next to a `\cite` with a page note: `\cite[p. 3]{smith2020}` beside a pin for another paper, so
  the "p. 3" never spreads to a work you did not apply it to;
- when words, maths or a reference stand between the pin and the `\cite`.

Folding the pin into any of these would change the PDF.

What it will **not** touch: code blocks, image rems, `Preamble` and `End`, anything tagged
`Rem2Tex-ignore`, Rem2Tex's own earlier exports, anything inside the `Zotero` tree itself, and pins
that point anywhere other than a Zotero item (those are navigation, and they stay pins). A rem whose
pin already has its citekey beside it is left alone, so running the command twice changes nothing the
second time.

Every converted rem is recorded under **`Rem2Tex rewrite <timestamp>`**, holding each rem's id and its
text before and after — so you can see exactly what changed, and put it back by hand if you want to.
If you edit one of the listed rems between opening the preview and pressing Convert, that rem is
skipped rather than overwritten.

---

## References to figures, tables and sections

Pin what you are referring to inside the braces of a `\ref{…}` you type — the same move as citing:

```
in Remnote    As Figure~\ref{⟨pin → the figure's code block⟩} shows, the signal doubles.
LaTeX         As Figure~\ref{fig:setup} shows, the signal doubles.
```

Rem2Tex fills in the `\label` of the rem the pin points at, so you never type a label, and changing a
label in its figure changes every pinned reference to it at the next export. This works in all three
exports and with every reference command: `\ref`, `\eqref`, `\pageref`, `\autoref`, `\nameref`,
`\vref`, `\cref`/`\Cref` (one pin per item of the list) and `\crefrange`/`\Crefrange` (one pin per
argument). An inline reference works the same as a pin.

| The pin points at | The label used |
| --- | --- |
| a code block — a figure, a table, an equation | its last `\label` (subfigures label each panel first and the whole figure last) |
| an image rem | the label in the figure or table block under it |
| a rem whose own text or maths holds a `\label{…}` | that label |
| a heading | a `\label{…}` typed into its title; otherwise `\label{sec:<its title>}`, which Rem2Tex adds right after that heading's sectioning command — `\section{Sample Preparation}\label{sec:sample-preparation}` |

Only a pin that has the braces to itself — or, in a `\cref` list, its own item — is filled in.
Anything else keeps the old behaviour, the pin is left out and the `\ref{}` stays empty, and the log
says why: the pin points at a rem with no label, shares its braces with other text, or points at a
Zotero item (cite that with `\cite{…}` instead). A heading gets a label only when a pin points at
it, so the headings you never refer to export exactly as before.

### The reference check

Every **paper** export also checks each reference, pinned or typed, against the labels the paper
defines — in the body, its headings and figure blocks, and the `Preamble` and `End` blocks, but never
in a `%` comment — and warns about:

- a reference to a label nothing in the paper defines, such as a typo or a deleted figure — the PDF
  would print **??** in its place;
- an empty reference, `\ref{}`;
- a label defined twice;
- a figure or table that nothing refers to (a figure counts as referenced when any of its labels is).

These are warnings only. They appear at the top of the preview and in the log, the export always goes
ahead, and the LaTeX is never changed. The log's Conversion section counts what it saw, e.g.
`Cross-references: 8 reference(s) to 6 label(s), 7 label(s) defined, 7 filled in from a pin, 2 heading
label(s) added`. Paragraph and Selection exports fill pins in but skip the check, because the labels
they refer to usually live elsewhere in the paper. A reference made inside a macro of your own (a
`\newcommand` that calls `\ref{#1}`) is resolved by TeX, not by Rem2Tex, so it is not checked.

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

The results agree with earlier work [1] and follow the method described in [2].

% ---------------- Bibliography ----------------

[1] Jane Smith, Wei Chen, and Maria Garcia. "A Sample Study of an Example Topic". In: Journal of
Examples (July 2008). doi: 10.1000/example.2008.

[2] A N Other. "An Example Book: Basic Theory and Practical Methods". In: Example University Press
(2020). url: https://example.org/books/example-book.
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

Every paper export writes `Rem2Tex / Rem2Tex <timestamp> / { the LaTeX code block, Log }` under the
paper rem and
toasts one line — exported, exported with *n* warnings, or failed, read the log. The log is plain
text: **Setup** (command, todo mode, paper rem) · **Structure** (where `Preamble` and `End` sit, which
body rems were converted, what was ignored) · **Conversion** (block sizes, `\documentclass`, `\title`,
`\author`, the cross-reference counts) · **Conversion summary** (counts, citation keys, dropped pins, todo comments, skipped rems)
· **Skipped by Rem2Tex-ignore** · **Warnings** · **Result**
(`SUCCESS` with the line count, or the failure with what happened, the rem, its path and suggestions).
Copy it into a bug report when asking for help.

Each warning is laid out in parts rather than one long sentence — the reason first, then the rem it
happened to, then whatever content was left out, then where that rem lives:

```
- Skipped by the todo mode, which also removed 1 non-todo descendant rem(s) from the paper.
    rem:  Todo "Todo1"
    at:   Introduction > Earlier work on this question has led to …
    now missing from the paper:
      · "indented below without todo."
```

The preview shows the same warnings the same way, at the top, before you export.

Problems found before a paper is located are shown **in the preview**, at the top, rather than
toasted: no focused rem, or the focused rem and its parent are both not papers — it says what is
missing on each (no `Preamble`, no `End` after it, or nothing between them) and leaves the Convert
button disabled. An empty `Preamble`/`End` block, or a failure part-way through the conversion, still writes an
export rem with the log in it.

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
- **Citation keys** are the item doc's title with whitespace removed and only the characters that
  would break a `\cite{}` argument stripped (`\ { } , % # & ~ ^`) — so a key containing `$` or `.`,
  like `doeExample$x$Study2023`, is cited exactly as you wrote it. Duplicate keys merge.
- **`Rem2Tex-ignore` must be the top-level rem** with exactly that name (the toggle command creates it
  there); a same-named rem nested elsewhere is not recognised.
- **Remnote's own bold/italic/underline are not converted** — type the LaTeX you want.
- **A heading you already wrote as a command is left alone.** If a heading rem's text is literally
  `\subsection{Further Results}`, that is what you get — not `\subsection{\subsection{…}}`.
  Heading depth otherwise comes from outline nesting (a sister of `Preamble` is a `\section`, its
  heading children are `\subsection`s), and the log warns if the command you typed sits at a
  different depth than the outline implies.
- **A reference to a deleted rem does not silently vanish.** Remnote remembers what the rem was
  called, so if it was an item under `Zotero / Items` its citekey is still used; otherwise an inline
  reference keeps its remembered words and a pin contributes nothing, as usual. Either way the log
  warns, naming the rem and what it used to be — so a citation can never disappear unnoticed.
- **The citekey rewrite preserves everything else in the rem** — bold, maths, clozes and your other
  references are carried across untouched, even maths sitting between two pins, because only the
  pins and the spaces around them are rewritten. If a rem changes while a write is under way, it is
  skipped rather than overwritten.
- **A citation beside `\citeauthor`, `\citeyear` or `\citetitle` is kept**, because those print a
  name, a year or a title rather than a citation: `\citeauthor{k} \cite{k}` gives "Smith [1]". A
  `\cite{k}` right after a command that already prints a citation of the same work (`\citet{k}
  \cite{k}`, or a pin beside `\supercite{k}`) is dropped, since it would print the number twice.
