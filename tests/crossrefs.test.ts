import {
  previewRem2TexConvert,
  runParagraphToTexConversion,
  runRem2TexConversion,
  runSelectionToTexConversion,
  type Rem2TexConvertIssue,
} from '../src/lib/rem2tex';
import { code, createFakeKb, heading, pin, ref, suite, todo } from './fake-kb';

/**
 * Cross-references (2026-11-24): a pin inside `\ref{…}` is filled in with its target's label in
 * every export, a heading a pin points at gets a generated label, and the paper export checks every
 * reference against the labels the paper defines — warnings only, never a change to the output.
 */
export async function run(): Promise<number> {
  const t = suite('cross-references: label pins and the \\ref check');

  /** A paper with one of every case, in outline order. All names and labels are made up. */
  function buildPaper() {
    const kb = createFakeKb();
    const { mk } = kb;
    mk('z', ['Zotero'], null);
    mk('items', ['Items'], 'z');
    mk('item', ['smith2020'], 'items');

    mk('paper', ['A Sample Paper'], null);
    mk('pre', ['Preamble'], 'paper');
    // `\ref{#1}` is a macro parameter: TeX resolves it, so the check must not.
    mk('pre1', [code('\\documentclass{article}\n\\newcommand{\\figref}[1]{Figure~\\ref{#1}}\n\\begin{document}')], 'pre');

    mk('intro', ['Introduction'], 'paper', heading);
    mk('pFig', ['As Figure~\\ref{', pin('figA'), '} shows, the gap rises.'], 'intro');
    mk('pTyped', ['Table~\\ref{tab:b} is typed by hand.'], 'intro');
    mk('pTypo', ['A typo in \\ref{fig:typo} prints question marks.'], 'intro');
    mk('pEmpty', ['An empty \\ref{} too.'], 'intro');
    mk('pSec', ['Details are in Section~\\ref{', pin('methods'), '}.'], 'intro');
    mk('pNoLabel', ['This points at a note: \\ref{', pin('note'), '}.'], 'intro');
    mk('pCrowded', ['Crowded \\ref{fig:', pin('figA'), '} braces.'], 'intro');
    mk('pTwo', ['Two in one \\ref{', pin('figA'), pin('tabB'), '} braces.'], 'intro');
    mk('pList', ['Both \\cref{', pin('figA'), ', ', pin('tabB'), '} agree.'], 'intro');
    mk('pMixed', ['Mixed \\cref{fig:a, ', pin('tabB'), '} list.'], 'intro');
    mk('pInline', ['Inline \\ref{', ref('figA'), '} works too.'], 'intro');
    mk('pZotero', ['A Zotero pin \\ref{', pin('item'), '} is a citation.'], 'intro');
    mk('pHyper', ['See \\hyperref[fig:hyper]{this figure}.'], 'intro');
    mk('pRange', ['Range \\crefrange{fig:a}{fig:r2}.'], 'intro');
    mk('pAppendix', ['The appendix is \\ref{sec:extra}.'], 'intro');
    mk('pUnbalanced', ['Unbalanced \\ref{', pin('figA'), ' never closes.'], 'intro');
    mk('pComment', ['% \\ref{fig:commented} is only a comment'], 'intro');
    mk('pTodo', ['check \\ref{fig:intodo}'], 'intro', todo);
    mk('note', ['A plain note with no label.'], 'intro');
    // Subfigures label their panels first and the whole figure last; a commented label is no label.
    mk('figA', [code('\\begin{figure}\n\\caption{Gap against strain}\n\\label{fig:a1}\n\\label{fig:a}\n% \\label{fig:old}\n\\end{figure}')], 'intro');
    mk('tabB', [code('\\begin{table}\n\\caption{Lattice constants}\n\\label{tab:b}\n\\end{table}')], 'intro');
    mk('figOrphan', [code('\\begin{figure}\n\\caption{Nobody cites me}\n\\label{fig:orphan}\n\\end{figure}')], 'intro');
    mk('figHyper', [code('\\begin{figure}\n\\caption{Linked by hyperref}\n\\label{fig:hyper}\n\\end{figure}')], 'intro');
    mk('eq1', [code('\\begin{equation}\nE = mc^2 \\label{eq:dup}\n\\end{equation}')], 'intro');
    mk('eq2', [code('\\begin{equation}\nF = ma \\label{eq:dup} % \\ref{fig:incode}\n\\end{equation}')], 'intro');
    // An image rem: its label lives in the figure block under it.
    mk('img', [{ i: 'i', url: 'x.png' }], 'intro');
    mk('imgFig', [code('\\begin{figure}\n\\caption{Strain map}\n\\label{fig:img}\n\\end{figure}')], 'img');
    mk('pImg', ['The map in Figure~\\ref{', pin('img'), '}.'], 'intro');

    mk('methods', ['Methods'], 'paper', heading);
    // Pointing BACK at a heading whose line was emitted long before.
    mk('pBack', ['Back to Section~\\ref{', pin('intro'), '}.'], 'methods');
    mk('results', ['Results'], 'paper', heading); // no pin points here
    mk('typedHeading', ['Discussion \\label{sec:talk}'], 'results', heading);
    mk('pTalk', ['As Section~\\ref{', pin('typedHeading'), '} argues.'], 'results');
    mk('dupA', ['Summary'], 'results', heading);
    mk('dupB', ['Summary'], 'paper', heading);
    mk('pDup', ['Compare \\ref{', pin('dupA'), '} with \\ref{', pin('dupB'), '}.'], 'dupB');
    mk('slugs', ['\\ce{H2O} and Résumé of $\\alpha$-phase results across many many compounds'], 'paper', heading);
    mk('pSlug', ['See \\ref{', pin('slugs'), '}.'], 'slugs');

    mk('end', ['End'], 'paper');
    mk('end1', [code('\\appendix\n\\section{Extra}\\label{sec:extra}\n\\end{document}')], 'end');
    return kb;
  }

  const lineOf = (latex: string, start: string): string =>
    latex.split('\n').find((line) => line.startsWith(start)) ?? `(no line starting "${start}")`;

  // ---------------------------------------------------------------- the paper export's output
  {
    const kb = buildPaper();
    const result = await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const tex = kb.captured.latex;
    t.check('the paper export succeeds', result.status === 'success', JSON.stringify(result));

    const lines: Array<[string, string, string]> = [
      ['a pin alone in \\ref{} takes the figure\'s LAST label (subfigures first, a % label ignored)', 'As Figure', 'As Figure~\\ref{fig:a} shows, the gap rises.'],
      ['a typed reference is untouched', 'Table~', 'Table~\\ref{tab:b} is typed by hand.'],
      ['a pin to a heading takes its generated label', 'Details are', 'Details are in Section~\\ref{sec:methods}.'],
      ['a pin to a rem with no label leaves \\ref{} as before', 'This points', 'This points at a note: \\ref{}.'],
      ['a pin sharing its braces with text is left out, not guessed', 'Crowded', 'Crowded \\ref{fig:} braces.'],
      ['two pins in one \\ref{} are both left out', 'Two in one', 'Two in one \\ref{} braces.'],
      ['each pin in a \\cref list is filled in', 'Both', 'Both \\cref{fig:a, tab:b} agree.'],
      ['a pin beside a typed key in a \\cref list is filled in', 'Mixed', 'Mixed \\cref{fig:a, tab:b} list.'],
      ['an inline reference is filled in like a pin', 'Inline', 'Inline \\ref{fig:a} works too.'],
      ['a Zotero pin inside \\ref{} is left out: a work is cited, not referenced', 'A Zotero', 'A Zotero pin \\ref{} is a citation.'],
      ['a pin to an image rem takes the label of the figure block under it', 'The map', 'The map in Figure~\\ref{fig:img}.'],
      ['a heading pinned from LATER in the outline still gets its label', '\\section{Introduction', '\\section{Introduction}\\label{sec:introduction}'],
      ['a pin to a heading earlier in the outline is filled in', 'Back to', 'Back to Section~\\ref{sec:introduction}.'],
      ['a pinned heading gets its label after the sectioning command', '\\section{Methods', '\\section{Methods}\\label{sec:methods}'],
      ['a heading no pin points at is exported exactly as before', '\\section{Results', '\\section{Results}'],
      ['a label typed into a heading wins, and nothing is added', '\\subsection{Discussion', '\\subsection{Discussion \\label{sec:talk}}'],
      ['a pin to that heading uses the typed label', 'As Section', 'As Section~\\ref{sec:talk} argues.'],
      ['two headings with the same title get distinct labels (1)', '\\subsection{Summary', '\\subsection{Summary}\\label{sec:summary}'],
      ['two headings with the same title get distinct labels (2)', '\\section{Summary', '\\section{Summary}\\label{sec:summary-2}'],
      ['and the pins name each one', 'Compare', 'Compare \\ref{sec:summary} with \\ref{sec:summary-2}.'],
      [
        'a generated label drops \\ce, folds accents, keeps \\alpha and stops at a word within 40 characters',
        '\\section{\\ce',
        '\\section{\\ce{H2O} and Résumé of $\\alpha$-phase results across many many compounds}\\label{sec:h2o-and-resume-of-alpha-phase-results}',
      ],
    ];
    for (const [name, start, expected] of lines) t.equal(name, lineOf(tex, start), expected);
    t.check('an unbalanced \\ref{ is left alone (nothing filled in)', !/Unbalanced[^\n]*fig:a/.test(tex), lineOf(tex, 'Unbalanced'));
    t.check('comments and todo lines keep their references as typed', tex.includes('% \\ref{fig:commented}') && tex.includes('% TODO [ ] check \\ref{fig:intodo}'), tex);
    const generated = (tex.match(/\}\\label\{sec:[^}]*\}/g) ?? []).filter((label) => !label.includes('sec:extra'));
    t.equal('exactly five generated heading labels were written', String(generated.length), '5');

    const log = kb.captured.log;
    t.check(
      'the Log counts references, labels and pins',
      log.includes(
        'Cross-references: 20 reference(s) to 14 label(s), 14 label(s) defined, 12 filled in from a pin, 5 heading label(s) added'
      ),
      log.split('\n').filter((line) => line.includes('Cross-references')).join('\n') || log.slice(0, 1500)
    );
  }

  // ---------------------------------------------------------------- the check, through the preview
  {
    const kb = buildPaper();
    kb.focus(kb.rems['paper']);
    const preview = await previewRem2TexConvert(kb.plugin, { kind: 'paper' });
    const warnings = preview.issues.filter((issue) => issue.severity === 'warning');
    const about = (reason: string): Rem2TexConvertIssue[] => warnings.filter((w) => w.message.includes(reason));
    const quoting = (list: Rem2TexConvertIssue[], text: string): boolean =>
      list.some((w) => (w.quotes ?? []).some((q) => q === text));
    const describe = warnings.map((w) => `- ${w.message} | ${w.subject} | ${(w.quotes ?? []).join(' ; ')}`).join('\n');

    t.check('warnings never block the export', !preview.blocked, JSON.stringify(preview.issues));

    const undefinedRefs = about('points at a label that nothing in the paper defines');
    t.equal('two references point at labels nothing defines', String(undefinedRefs.length), '2');
    t.check('… the typo, quoted as typed', quoting(undefinedRefs, '\\ref{fig:typo}'), describe);
    t.check('… the end of a \\crefrange', quoting(undefinedRefs, '\\crefrange{fig:r2}'), describe);
    t.check(
      'the typo names the rem it is in',
      undefinedRefs.some((w) => w.subject === 'Rem "A typo in \\ref{fig:typo} prints question marks."' && w.path === 'Introduction'),
      describe
    );

    const empties = about('This reference is empty');
    t.equal('only the hand-typed empty \\ref{} is reported as empty', String(empties.length), '1');
    t.check('… named with its \\ref{} in place', empties.some((w) => w.subject === 'Rem "An empty \\ref{} too."'), describe);

    const duplicates = about('defined 2 times');
    t.check('a label defined twice is reported once', duplicates.length === 1 && quoting(duplicates, '\\label{eq:dup}'), describe);
    t.check('… at its second definition, an equation named by its maths', duplicates.some((w) => w.subject === 'Equation "F = ma"'), describe);

    const orphans = about('Nothing in the paper refers to this figure or table');
    t.equal('exactly one figure is referenced by nothing', String(orphans.length), '1');
    t.check('… named by its caption', orphans.some((w) => w.subject === 'Figure "Nobody cites me"' && quoting([w], '\\label{fig:orphan}')), describe);

    const noLabel = about('points at a rem with no \\label');
    t.equal('one pin points at a rem with no label', String(noLabel.length), '1');
    t.check(
      '… shown with its pin, naming what it points at',
      noLabel.some((w) => w.subject === 'Rem "This points at a note: \\ref{⟨pin⟩}."' && quoting([w], 'Rem "A plain note with no label."')),
      describe
    );

    const crowded = about('shares its braces with other text');
    t.equal('a crowded pin is reported once per pair of braces', String(crowded.length), '2');

    const zotero = about('points at a Zotero item');
    t.check('a Zotero pin inside \\ref{} says a work is cited, not referenced', zotero.length === 1 && quoting(zotero, '"smith2020"'), describe);

    const all = warnings.map((w) => (w.quotes ?? []).join(' ')).join('\n');
    t.check('a crowded pin\'s leftover is not reported a second time', !all.includes('fig:}'), describe);
    t.check('commented-out references are not checked', !/fig:commented|fig:incode|fig:intodo/.test(all), describe);
    t.check('a macro parameter (\\ref{#1}) is not checked', !all.includes('#1'), describe);
    t.check('a label in the End block counts', !all.includes('sec:extra'), describe);
    t.check('\\hyperref[…] counts as a reference', !all.includes('fig:hyper'), describe);
    t.check('a subfigure panel nothing refers to is fine when its figure is referenced', !all.includes('fig:a1'), describe);
    t.equal('and nothing else is reported', String(warnings.length), '9');
  }

  // ---------------------------------------------------------------- paragraph and selection exports
  {
    const kb = buildPaper();
    await runParagraphToTexConversion(kb.plugin, { paragraphRem: kb.rems['intro'] });
    const tex = kb.captured.latex;
    t.equal('paragraph export: a pin in \\ref{} is filled in too', lineOf(tex, 'As Figure'), 'As Figure~\\ref{fig:a} shows, the gap rises.');
    t.equal('paragraph export: a heading outside the export still names its label', lineOf(tex, 'Details are'), 'Details are in Section~\\ref{sec:methods}.');
    t.check('… but its \\label is not invented here', !tex.includes('\\label{sec:methods}'), tex);

    kb.focus(kb.rems['intro']);
    const preview = await previewRem2TexConvert(kb.plugin, { kind: 'paragraph' });
    const reasons = preview.issues.map((issue) => issue.message).join('\n');
    t.check('paragraph preview: a pin that cannot be filled in is still reported', reasons.includes('points at a rem with no \\label'), reasons);
    t.check(
      'paragraph preview: the paper-wide check does not run (its labels may live elsewhere)',
      !reasons.includes('nothing in the paper defines') && !reasons.includes('Nothing in the paper refers'),
      reasons
    );
  }
  {
    const kb = buildPaper();
    await runSelectionToTexConversion(kb.plugin, { selectedRemIds: ['pSec', 'methods'] });
    const tex = kb.captured.latex;
    t.check(
      'selection export: the pin is filled in and the selected heading gets its label',
      tex.includes('Details are in Section~\\ref{sec:methods}.') && tex.includes('\\section{Methods}\\label{sec:methods}'),
      tex
    );
  }

  // ---------------------------------------------------------------- nothing to fill in: no change
  {
    const kb = createFakeKb();
    const { mk } = kb;
    mk('paper', ['A Sample Paper'], null);
    mk('pre', ['Preamble'], 'paper');
    mk('pre1', [code('\\documentclass{article}\n\\begin{document}')], 'pre');
    mk('h', ['Overview'], 'paper', heading);
    mk('p', ['Plain prose with a pin ', pin('h'), ' outside any reference.'], 'h');
    mk('end', ['End'], 'paper');
    mk('end1', [code('\\end{document}')], 'end');
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    t.equal(
      'a pin outside any reference is dropped as before, and its heading gets no label',
      kb.captured.latex,
      '\\documentclass{article}\n\\begin{document}\n\n\\section{Overview}\n\nPlain prose with a pin  outside any reference.\n\n\\end{document}'
    );
    t.check(
      'the Log still says how many references there were',
      kb.captured.log.includes('Cross-references: 0 reference(s) to 0 label(s), 0 label(s) defined, 0 filled in from a pin'),
      kb.captured.log.slice(0, 1500)
    );
  }

  return t.failures();
}
