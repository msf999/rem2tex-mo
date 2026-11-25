import {
  applyCitekeyRewrite,
  describeConvertError,
  dropCitationsCoveredByAdjacentCommand,
  getRemTitle,
  planCitekeyRewrite,
  previewRem2TexConvert,
  REM2TEX_FOCUS_CACHE_KEY,
  renumberCitations,
  rewriteRichTextWithCitekeys,
  runParagraphToTexConversion,
  runRem2TexConversion,
  runRem2TexConvert,
  runSelectionToTexConversion,
} from '../src/lib/rem2tex';
import { code, createFakeKb, deadRef, heading, pin, ref, suite, todo } from './fake-kb';

type Kb = ReturnType<typeof createFakeKb>;

/**
 * The defects an adversarial run confirmed on 2026-11-24 and the fixes for them, one block per
 * finding, numbered as in that run's repro scripts. Every check here failed before its fix. Names,
 * keys and sentences are made up.
 */
export async function run(): Promise<number> {
  const t = suite('defects found by the 2026-11-24 adversarial run');

  const TARGET: Record<string, { itemDocId: string; key: string }> = {
    A: { itemDocId: 'A', key: 'smith2020' },
    B: { itemDocId: 'B', key: 'jones2019' },
    passage: { itemDocId: 'A', key: 'smith2020' },
  };
  const targetFor = (id: string) => TARGET[id];
  const show = (a: unknown[] | undefined) =>
    a === undefined
      ? '(no change)'
      : a
          .map((e: any) =>
            typeof e === 'string' ? e : e.i === 'q' ? (e.pin ? `<pin:${e._id}>` : `{ref:${e._id}}`) : e.text ?? `[${e.i}]`
          )
          .join('');

  /** A knowledge base with a Zotero tree: smith2020 (A, with a passage), jones2019 (B). */
  function zoteroKb(): Kb {
    const kb = createFakeKb();
    kb.mk('z', ['Zotero'], null);
    kb.mk('items', ['Items'], 'z');
    kb.mk('A', ['smith2020'], 'items');
    kb.mk('B', ['jones2019'], 'items');
    kb.mk('passage', ['a highlighted passage'], 'A');
    kb.mk('note', ['a note to self'], null); // a pin to this is not a citation
    kb.mk('table', ['Table 1'], null); // an inline reference to this reads as words
    return kb;
  }

  /** A paper whose body heading holds `body` (id, text, extra). */
  function paperKb(body: Array<[string, unknown[], Record<string, unknown>?]>): Kb {
    const kb = zoteroKb();
    kb.mk('paper', ['A Sample Paper'], null);
    kb.mk('pre', ['Preamble'], 'paper');
    kb.mk('pre1', [code('\\documentclass{article}\n\\begin{document}')], 'pre');
    kb.mk('body', ['Body'], 'paper', heading);
    for (const [id, text, extra] of body) kb.mk(id, text as any[], 'body', extra ?? {});
    kb.mk('end', ['End'], 'paper');
    kb.mk('end1', [code('\\end{document}')], 'end');
    return kb;
  }

  /** Export a paper, rewrite its pins the way the popup does, and export it again. */
  async function exportRewriteExport(build: () => Kb) {
    const plain = build();
    await runRem2TexConversion(plain.plugin, { parentRem: plain.rems['paper'] });
    const kb = build();
    kb.focus(kb.rems['paper']);
    const preview = await previewRem2TexConvert(kb.plugin, { kind: 'paper' });
    const result = await runRem2TexConvert(kb.plugin, { kind: 'paper', pinRows: preview.pinRows });
    return { before: plain.captured.latex, after: kb.captured.latex, kb, result };
  }

  // ------------------------------------------------- 01: the rewrite deleted maths between two pins
  {
    const maths = { i: 'x', text: 'E_g \\approx 3.4' };
    const tight = { i: 'x', text: 'R^2>0.9' };
    const r = await exportRewriteExport(() =>
      paperKb([
        ['p1', ['The two estimates ', pin('A'), ' ', maths, ' ', pin('B'), ' agree.']],
        ['p2', ['Both fits', pin('A'), tight, pin('B'), '.']],
      ])
    );
    t.check('01 maths between two pins survives the rewrite, by reference', r.kb.rems['p1'].text.includes(maths), show(r.kb.rems['p1'].text));
    t.check('01 …and with nothing either side of it', r.kb.rems['p2'].text.includes(tight), show(r.kb.rems['p2'].text));
    t.equal('01 …each pin gets its own key', show(r.kb.rems['p1'].text), 'The two estimates \\cite{{ref:A}<pin:A>} E_g \\approx 3.4 \\cite{{ref:B}<pin:B>} agree.');
    t.check('01 …both rems were still rewritten', r.result.pinsWritten === 2, JSON.stringify(r.result));
    t.equal('01 …and the paper exports byte-identically', r.after, r.before);
    const img = { i: 'i', url: 'chart.png' };
    const pure = rewriteRichTextWithCitekeys(['Compare ', pin('A'), ' ', img, ' ', pin('B')], targetFor);
    t.check('01 the pure rewrite keeps an image between two pins too', !!pure && pure.includes(img), show(pure));
  }

  // ------------------------------------------------- 02: a retry after a failed write clobbered an edit
  {
    const kb = zoteroKb();
    kb.mk('sec', ['Section'], null);
    const p = kb.mk('p1', ['First draft citing ', pin('A'), '.'], 'sec');
    const plan = await planCitekeyRewrite(kb.plugin, [kb.rems['sec']], { hierarchyRemIds: new Set(['sec', 'p1']) } as any);
    const edited = ['Second draft, edited while the write hung: ', pin('A'), '.'];
    let calls = 0;
    // The write fails after the author's edit has landed — the catch path a stalled write takes too
    // (live-test/adversarial/02 drives the real 6-second stall).
    p.setText = async () => {
      calls += 1;
      p.text = edited;
      throw new Error('setText timed out');
    };
    const result = await applyCitekeyRewrite(kb.plugin, plan.rows);
    t.check('02 an edit that lands during a failed write is not overwritten by a retry', p.text === edited && calls === 1, `calls=${calls}; ${show(p.text)}`);
    t.check('02 …and the rem is reported as edited since the preview', result.skipped.length === 1 && result.skipped[0].reason === 'edited since the preview' && result.applied.length === 0, JSON.stringify(result));

    // Control: a write that fails with NO edit underneath it is still retried, and lands.
    const kb2 = zoteroKb();
    kb2.mk('sec', ['Section'], null);
    const q = kb2.mk('p1', ['First draft citing ', pin('A'), '.'], 'sec');
    const plan2 = await planCitekeyRewrite(kb2.plugin, [kb2.rems['sec']], { hierarchyRemIds: new Set(['sec', 'p1']) } as any);
    const realSetText = q.setText;
    let tries = 0;
    q.setText = async (text: unknown[]) => {
      tries += 1;
      if (tries === 1) throw new Error('a transient failure');
      return realSetText(text);
    };
    const result2 = await applyCitekeyRewrite(kb2.plugin, plan2.rows);
    t.check('02 control: an unedited rem is still retried and written', result2.applied.length === 1 && tries === 2, JSON.stringify(result2));
  }

  // ------------------------------------------------- 03: the rewrite folded a pin into another command
  {
    const r = await exportRewriteExport(() =>
      paperKb([
        ['n', ['\\nocite{other2000} ', pin('A')]],
        ['ca', ['As \\citeauthor{other2000} ', pin('A'), ' argued, the gap is direct.']],
        ['tc', ['\\textcite{other2000} ', pin('A'), ' measured it.']],
        ['cp', ['It is direct \\citep{other2000} ', pin('A'), '.']],
        ['cs', ['Starred \\cite*{other2000} ', pin('A'), '.']],
        ['ce', ['Known \\cite{}', pin('A'), '.']],
        ['cv', ['Visible \\cite{other2000} ', pin('A'), '.']],
      ])
    );
    t.equal('03 a pin beside \\nocite gets its own \\cite, not a place in the invisible one', show(r.kb.rems['n'].text), '\\nocite{other2000} \\cite{{ref:A}<pin:A>}');
    t.equal('03 …and the same beside \\citeauthor', show(r.kb.rems['ca'].text), 'As \\citeauthor{other2000} \\cite{{ref:A}<pin:A>} argued, the gap is direct.');
    t.equal('03 …and beside \\cite*', show(r.kb.rems['cs'].text), 'Starred \\cite*{other2000} \\cite{{ref:A}<pin:A>}.');
    t.equal('03 an empty \\cite{} takes the key with no stray comma', show(r.kb.rems['ce'].text), 'Known \\cite{{ref:A}<pin:A>}.');
    t.equal('03 a plain \\cite still takes the pin in, and the space between them goes', show(r.kb.rems['cv'].text), 'Visible \\cite{other2000, {ref:A}<pin:A>}.');
    t.equal('03 the paper exports byte-identically before and after', r.after, r.before);
    const before = rewriteRichTextWithCitekeys([pin('A'), ' \\cite{} after'], targetFor);
    t.equal('03 an empty \\cite{} after the pin takes it with no stray comma either', show(before), '\\cite{{ref:A}<pin:A>} after');
  }

  // ------------------------------------------------- 04: the rewrite moved or reordered citations
  {
    const r = await exportRewriteExport(() =>
      paperKb([
        ['word', ['As listed in \\cite{other2000} ', ref('table'), ' ', pin('A'), ', the values agree.']],
        ['math', ['The fit \\cite{other2000} ', { i: 'x', text: 'R^2 = 0.98' }, ' ', pin('A'), ' holds.']],
        ['dropped', ['Noted \\cite{other2000} ', pin('note'), ' ', pin('A'), '.']],
        ['order', ['Prior work ', pin('A'), pin('note'), pin('B'), pin('passage'), '.']],
      ])
    );
    t.equal('04 a pin is not moved across an inline reference that reads as words', show(r.kb.rems['word'].text), 'As listed in \\cite{other2000} {ref:table} \\cite{{ref:A}<pin:A>}, the values agree.');
    t.equal('04 …nor across maths', show(r.kb.rems['math'].text), 'The fit \\cite{other2000} R^2 = 0.98 \\cite{{ref:A}<pin:A>} holds.');
    t.equal('04 …but across a pin that renders as nothing, it still is (the pin stays, the spaces go)', show(r.kb.rems['dropped'].text), 'Noted \\cite{other2000, {ref:A}<pin:A>}<pin:note>.');
    t.equal('04 the paper — citation order included — exports byte-identically', r.after, r.before);
    const line = r.after.split('\n').find((l) => l.startsWith('Prior work')) ?? '(missing)';
    t.equal('04 keys keep reading order when a dropped pin splits a run', line, 'Prior work \\cite{smith2020, jones2019}.');
  }

  // ------------------------------------------------- 05: a typed \cite after \citeauthor was deleted
  {
    const kb = zoteroKb();
    const prose = (text: unknown[]) => getRemTitle(kb.plugin, { text } as any, { hierarchyRemIds: new Set() } as any);
    t.equal('05 "\\citeauthor{k} \\cite{k}" keeps its citation', await prose(['As \\citeauthor{doe2020} \\cite{doe2020} showed.']), 'As \\citeauthor{doe2020} \\cite{doe2020} showed.');
    t.equal('05 …and so does \\citeyear', await prose(['In \\citeyear{doe2020} \\cite{doe2020} it was shown.']), 'In \\citeyear{doe2020} \\cite{doe2020} it was shown.');
    t.equal('05 a pin after \\citeauthor still cites the work', await prose(['As \\citeauthor{smith2020} ', pin('A'), ' showed.']), 'As \\citeauthor{smith2020} \\cite{smith2020} showed.');
    t.equal('05 a command that prints a citation still covers its duplicate', dropCitationsCoveredByAdjacentCommand('\\textcite{k}\\cite{k}'), '\\textcite{k}');
  }

  // ------------------------------------------------- 06: code blocks were not verbatim
  {
    const block = 'Earlier methods are reviewed in \\cite{doe2020}\n\n\\cite{roe2019} later extended them.\nThe idea follows \\citeauthor{lee2018} \\cite{lee2018}. % kept';
    const figure = '\\begin{figure}\n\\caption{Data from \\cite{doe2020} \\cite{roe2019}}\n\\label{fig:data}\n\\end{figure}';
    const kb = paperKb([
      ['cb', [code(block)]],
      ['img', [{ i: 'i', url: 'x.png' }]],
    ]);
    kb.mk('imgFig', [code(figure)], 'img');
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    t.check('06 a code block is exported exactly as typed — paragraphs, citations and all', kb.captured.latex.includes(block), kb.captured.latex);
    t.check('06 …and so is a figure block under an image rem', kb.captured.latex.includes(figure), kb.captured.latex);
  }

  // ------------------------------------------------- 07: the popup exported another rem after 2 minutes
  {
    const kb = zoteroKb();
    kb.mk('doc', ['Lab notebook'], null);
    kb.mk('sec', ['A short section'], 'doc');
    kb.mk('secp', ['It cites ', pin('A'), '.'], 'sec');
    kb.mk('other', ['Another part of the notebook'], 'doc');
    kb.mk('otherp', ['Notes that were never meant for export.'], 'other');
    kb.openInPane(kb.rems['doc']);
    kb.focus(undefined); // the Omnibar has taken live focus; only the remembered caret knows 'sec'
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      await kb.plugin.storage.setSession(REM2TEX_FOCUS_CACHE_KEY, { remId: 'sec', capturedAt: now - 60_000 });
      const preview = await previewRem2TexConvert(kb.plugin, { kind: 'paragraph' });
      t.check('07 the preview says which rem it ran on', preview.targetRemId === 'sec', JSON.stringify(preview.targetRemId));
      now += 61_000; // the author reads the popup for a minute: the caret is now 121 s old
      const result = await runRem2TexConvert(kb.plugin, { kind: 'paragraph', targetRemId: preview.targetRemId, pinRows: preview.pinRows });
      t.check('07 Convert exports the rem the popup previewed, not the open document', !kb.captured.latex.includes('never meant for export') && kb.captured.latex.includes('A short section'), kb.captured.latex);
      const created = (Object.values(kb.rems) as any[]).filter((r) => /^new\d+$/.test(r._id));
      t.check('07 …and writes nothing under the open document', !created.some((r) => r.parent === 'doc'), created.map((r) => `${r._id}<-${r.parent}`).join(', '));
      t.check('07 …and the citekey was still written', result.pinsWritten === 1, JSON.stringify(result));
    } finally {
      Date.now = realNow;
    }
    let gone = '';
    try {
      await runRem2TexConvert(kb.plugin, { kind: 'paragraph', targetRemId: 'no-such-rem' });
    } catch (error) {
      gone = describeConvertError(error);
    }
    t.check('07 a previewed rem that has since been deleted stops the run with a reason', /previewed is gone/.test(gone), gone);
  }

  // ------------------------------------------------- 10: typed accents and \verb were escaped
  {
    const kb = createFakeKb();
    kb.mk('para', ['Na\\"{i}ve caf\\\'{e} r\\^{o}le, pi\\~{n}ata and \\verb|a_b$c| stay; 50% of x_1 does not.'], null);
    await runParagraphToTexConversion(kb.plugin, { paragraphRem: kb.rems['para'] });
    t.equal('10 accent groups and \\verb pass through; plain specials are still escaped', kb.captured.latex, 'Na\\"{i}ve caf\\\'{e} r\\^{o}le, pi\\~{n}ata and \\verb|a_b$c| stay; 50\\% of x\\_1 does not.');
  }

  // ------------------------------------------------- 13: an environment split across sibling rems
  {
    const kb = createFakeKb();
    kb.mk('para', ['Steps'], null);
    kb.mk('s1', ['\\begin{enumerate}'], 'para');
    kb.mk('s2', ['\\item Mix 50% of the powders.'], 'para');
    kb.mk('s3', ['\\end{enumerate}'], 'para');
    kb.mk('s4', ['\\['], 'para');
    kb.mk('s5', ['\\]'], 'para');
    await runParagraphToTexConversion(kb.plugin, { paragraphRem: kb.rems['para'] });
    t.equal(
      '13 a \\begin, \\[ or \\] alone in a rem passes through like its \\end',
      kb.captured.latex,
      ['Steps', '', '\\begin{enumerate}', '', '\\item Mix 50\\% of the powders.', '', '\\end{enumerate}', '', '\\[', '', '\\]'].join('\n')
    );
  }

  // ------------------------------------------------- 15: the rewrite changed comment-tree lines
  {
    const r = await exportRewriteExport(() => {
      const kb = paperKb([
        ['t1', ['check these references'], todo],
        ['c1', ['% reviewer note']],
      ]);
      kb.mk('t1a', ['compare \\cite{other2000} ', pin('A')], 't1');
      kb.mk('t1b', [pin('B'), ' \\cite{other2000} too'], 't1');
      kb.mk('t1c', [pin('A'), pin('B')], 't1');
      kb.mk('c1a', ['see \\cite{other2000} ', pin('A')], 'c1');
      return kb;
    });
    t.equal('15 comment-tree lines read the same before and after the rewrite', r.after, r.before);
    t.check('15 a child that is only pins gets no line, however many pins', !/%\s+-\s+⟨pin⟩/.test(r.before), r.before);
    t.check('15 …while the others keep theirs', /%\s+-\s+compare \\cite\{other2000\}\n/.test(r.after) && /%\s+-\s+\\cite\{other2000\} too/.test(r.after), r.after);
  }

  // ================================================================================================
  // R-019 (2026-11-25): the lower-risk findings of the same run. Each check failed before its fix.
  const h2 = { getFontSize: async () => 'H2' };
  const h3 = { getFontSize: async () => 'H3' };

  // ------------------------------------------------- 08: a heading label differed between exports
  {
    const kb = paperKb([
      ['s1', ['Experiment one'], h2],
      ['s2', ['Experiment two'], h2],
      ['disc', ['Discussion'], h2],
    ]);
    kb.mk('r1', ['Results'], 's1', h3);
    kb.mk('r1p', ['First results.'], 'r1');
    kb.mk('r2', ['Results'], 's2', h3);
    kb.mk('r2p', ['Second results, unlike Section~\\ref{', pin('r1'), '}.'], 'r2');
    kb.mk('d1', ['As Section~\\ref{', pin('r2'), '} shows, the second run differs.'], 'disc');
    const refIn = (tex: string) => /As Section~\\ref\{([^}]*)\}/.exec(tex)?.[1] ?? '(none)';
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const paper = kb.captured.latex;
    await runParagraphToTexConversion(kb.plugin, { paragraphRem: kb.rems['disc'] });
    t.equal('08 a pinned heading has the same label in the paper and in a paragraph export', refIn(kb.captured.latex), refIn(paper));

    const only = paperKb([['s1', ['Experiment one'], h2], ['s2', ['Experiment two'], h2]]);
    only.mk('r1', ['Results'], 's1', h3);
    only.mk('r2', ['Results'], 's2', h3);
    only.mk('r2p', ['As Section~\\ref{', pin('r2'), '} shows.'], 's2');
    await runRem2TexConversion(only.plugin, { parentRem: only.rems['paper'] });
    t.check(
      '08 …because same-titled headings are numbered in outline order, pinned or not',
      only.captured.latex.includes('\\subsubsection{Results}\\label{sec:results-2}') && refIn(only.captured.latex) === 'sec:results-2',
      only.captured.latex
    );
  }

  // ------------------------------------------------- 09: a generated label repeated a typed one
  {
    const kb = paperKb([['sec', ['Main text'], h2]]);
    kb.mk('methods', ['Methods'], 'sec', h3);
    kb.mk('m1', ['We describe the setup.'], 'methods');
    kb.mk('x1', ['Details are in Section~\\ref{', pin('methods'), '}.'], 'sec');
    kb.mk('appx', ['Supplementary methods \\label{sec:methods}'], 'sec', h3);
    kb.mk('a1', ['Extra detail.'], 'appx');
    const typedOnce = (tex: string) => (tex.match(/\\label\{sec:methods\}/g) ?? []).length === 1;
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const paper = kb.captured.latex;
    t.check(
      '09 a generated heading label never repeats one typed in the paper',
      typedOnce(paper) && paper.includes('\\subsubsection{Methods}\\label{sec:methods-2}') && paper.includes('Section~\\ref{sec:methods-2}'),
      paper
    );
    t.check('09 …so the Log has no label defined twice', !/defined 2 times/.test(kb.captured.log), kb.captured.log);
    await runParagraphToTexConversion(kb.plugin, { paragraphRem: kb.rems['sec'] });
    t.check('09 …nor does a paragraph export define it twice', typedOnce(kb.captured.latex), kb.captured.latex);
  }

  // ------------------------------------------------- 11: a % inside \url{…} was read as a comment
  {
    const kb = zoteroKb();
    kb.mk('s', ['The raw data are at \\url{https://example.org/data%20set} and were analysed in ', pin('A'), ' and ', pin('B'), '.'], null);
    const result = await runSelectionToTexConversion(kb.plugin, { selectedRemIds: ['s'] });
    t.check(
      '11 citations after a %-encoded address are numbered',
      result.citationCount === 2 &&
        kb.captured.latex.startsWith('The raw data are at \\url{https://example.org/data%20set} and were analysed in [1] and [2].'),
      kb.captured.latex
    );
    const pk = paperKb([
      ['fig', [code('\\begin{figure}\\caption{Spectra}\\label{fig:spectra}\\end{figure}')]],
      ['p', ['Raw files: \\url{https://example.org/data%20set}, plotted in Figure~\\ref{fig:spectra}.']],
    ]);
    await runRem2TexConversion(pk.plugin, { parentRem: pk.rems['paper'] });
    t.check('11 …and the \\ref check sees a reference after one', !/Nothing in the paper refers/.test(pk.captured.log), pk.captured.log);
    t.equal(
      '11 \\verb and \\href keep their % as well',
      renumberCitations('\\verb|50%| \\href{https://example.org/a%20b}{text} \\cite{a} % a note on \\cite{a}').latex,
      '\\verb|50%| \\href{https://example.org/a%20b}{text} [1] % a note on [1]'
    );
  }

  // ------------------------------------------------- 12: \textcite lost its author in the selection export
  {
    const kb = zoteroKb();
    kb.mk('s', ['As \\textcite{', pin('A'), '} showed, and \\citet{', pin('B'), '} confirmed, the gap is direct.'], null);
    await runSelectionToTexConversion(kb.plugin, { selectedRemIds: ['s'] });
    t.equal(
      '12 \\textcite and \\citet keep the author beside the number',
      kb.captured.latex.split('\n')[0],
      'As \\citeauthor{smith2020} [1] showed, and \\citeauthor{jones2019} [2] confirmed, the gap is direct.'
    );
    t.equal(
      '12 …notes go in the brackets, a star and a capital carry over, \\citealt has no brackets',
      renumberCitations('\\Textcite[see][p. 3]{a} \\citet*{b} \\citealt{a}').latex,
      '\\Citeauthor{a} [see 1, p. 3] \\citeauthor*{b} [2] \\citeauthor{a} 1'
    );
  }

  // ------------------------------------------------- 14: a lone CR ended a comment early
  {
    const kb = paperKb([
      ['t1', ['fix the caption\r\\section{Leaked from a todo}'], todo],
      ['c1', ['% old sentence kept for reference\rThis sentence was meant to stay commented out.']],
    ]);
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const tex = kb.captured.latex;
    const lines = tex.split(/\r\n?|\n/);
    t.check('14 no output line holds a lone CR', !tex.includes('\r'), JSON.stringify(tex));
    t.check(
      '14 …and the text after one stays commented out',
      lines.includes('% \\section{Leaked from a todo}') && lines.includes('% This sentence was meant to stay commented out.'),
      tex
    );
  }

  // ------------------------------------------------- 16: the popup listed keys it would not write
  {
    const kb = paperKb([
      ['p1', ['Done \\cite{', ref('A'), pin('A'), '} and new ', pin('B'), '.']],
      ['p2', ['A new one ', pin('B'), ', and a plain mention of ', ref('A'), '.']],
    ]);
    kb.focus(kb.rems['paper']);
    const preview = await previewRem2TexConvert(kb.plugin, { kind: 'paper' });
    const rows = preview.pinRows.map((row) => `${row.remId}: ${row.keys.join(',')} (${row.pins})`).join(' | ');
    t.equal('16 each row lists only the keys the rewrite writes, and counts its pins', rows, 'p1: jones2019 (1) | p2: jones2019 (1)');
    t.equal('16 …and the works are only those', preview.pinKeys.join(','), 'jones2019');
    const two = paperKb([['p3', ['Two new ones, ', pin('B'), ' and then ', pin('A'), ', plus ', pin('passage'), pin('A'), '.']]]);
    two.focus(two.rems['paper']);
    const many = await previewRem2TexConvert(two.plugin, { kind: 'paper' });
    t.check('16 …a rem with several pins counts every one', many.pinRows.length === 1 && many.pinRows[0].pins === 4, JSON.stringify(many.pinRows.map((row) => [row.keys, row.pins])));
  }

  // ------------------------------------------------- 17: bibliography edge cases
  {
    const kb = zoteroKb();
    kb.rems['A'].props = {
      'zotero-item': { title: ['A Sample Study'], authors: ['Doe, Jane'], year: ['2020'], link: ['https://example.org/~doe/sample--study.pdf'] },
    };
    kb.mk('sel', ['Notes'], null);
    kb.mk('s1', ['\\nocite{*}Data: see ', pin('A'), '.'], 'sel');
    kb.mk('s2', ['Also compare \\cite{typed2001,\ntyped2002}.'], 'sel');
    const r = await runSelectionToTexConversion(kb.plugin, { selectedRemIds: ['s1', 's2'] });
    const tex = kb.captured.latex;
    t.check('17 an address prints its ~ and -- as written', tex.includes('url: https://example.org/\\textasciitilde{}doe/sample-{}-study.pdf'), tex);
    t.check('17 \\nocite{*} takes no number and gets no entry', tex.startsWith('Data: see [1].') && !/\[\d\] \*/.test(tex), tex);
    t.check('17 a \\cite whose key list wraps onto the next line is numbered', tex.includes('Also compare [2, 3].') && r.citationCount === 3, tex);
  }

  // ------------------------------------------------- 18: two warnings' paths repeated the rem
  {
    const kb = paperKb([['sec', ['Methods'], h2]]);
    kb.mk('p1', ['A sentence citing a deleted item ', deadRef('Zotero | Items | gone2001', { pin: true }), '.'], 'sec');
    kb.mk('typed', ['\\section{Typed at the wrong depth}'], 'sec', h3);
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const at = kb.captured.log.split('\n').filter((line) => line.trim().startsWith('at:'));
    t.check('18 every warning path stops at the parent of the rem it names', at.length === 2 && at.every((line) => /^at:\s+Body > Methods$/.test(line.trim())), at.join('\n'));
  }

  // ------------------------------------------------- 19: a deleted target in \ref{} exported \ref{\cite{…}}
  {
    const kb = paperKb([
      [
        'p1',
        [
          'Live item: Figure~\\ref{', pin('A'), '}. Deleted item: Figure~\\ref{',
          deadRef('Zotero | Items | gone2001', { pin: true }), '}. Deleted figure: Figure~\\ref{',
          deadRef('Results | Old figure'), '}.',
        ],
      ],
    ]);
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const line = kb.captured.latex.split('\n').find((l) => l.startsWith('Live item')) ?? '';
    t.equal('19 a deleted target inside \\ref{} is left out, a Zotero item or not', line, 'Live item: Figure~\\ref{}. Deleted item: Figure~\\ref{}. Deleted figure: Figure~\\ref{}.');
    t.check(
      '19 …and the Log says why',
      /points at a Zotero item that no longer exists/.test(kb.captured.log) && /points at a rem that no longer exists/.test(kb.captured.log),
      kb.captured.log
    );
  }

  // ------------------------------------------------- 20: the \ref check's blind spots
  {
    const kb = paperKb([
      ['f1', [code('\\begin{figure}\\caption{Panel view}\\label{fig:panel}\\end{figure}')]],
      ['f2', [code('\\begin{figure}\\caption{One}\\label{fig:one}\\end{figure}\n\\begin{figure}\\caption{Never cited}\\label{fig:never}\\end{figure}')]],
      ['p1', ['See page~\\cpageref{fig:panel} and Figure~\\ref{fig:one}; also \\labelcref{fig:typo}.']],
    ]);
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const warnings = kb.captured.log.slice(kb.captured.log.indexOf('Warnings'));
    t.check('20 a figure cited only by \\cpageref is not reported as uncited', !warnings.includes('fig:panel'), warnings);
    t.check('20 …a \\labelcref to a label nothing defines is reported', warnings.includes('\\labelcref{fig:typo}'), warnings);
    t.check('20 …and of two figures in one code block, the uncited one is', /Figure "Never cited"[\s\S]*\\label\{fig:never\}/.test(warnings) && !warnings.includes('\\label{fig:one}'), warnings);
  }

  // ------------------------------------------------- 21: reference resolution was exponential
  {
    const kb = paperKb([['p1', ['We use ', ref('k0'), ' here.']]]);
    const ids = Array.from({ length: 12 }, (_, i) => `k${i}`);
    for (const id of ids) kb.mk(id, [`Term ${id}, see `, ...ids.filter((other) => other !== id).flatMap((other) => [ref(other), ' '])], null);
    let calls = 0;
    const findOne = kb.plugin.rem.findOne;
    kb.plugin.rem.findOne = async (id: string) => {
      calls += 1;
      return findOne(id);
    };
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const line = kb.captured.latex.split('\n').find((l) => l.startsWith('We use')) ?? '';
    t.check('21 one reference into twelve cross-linked rems stays cheap', calls < 2000 && line.length < 2000, `${calls} findOne calls, ${line.length} characters`);
    t.check('21 …and still spells out its target', line.replace(/\s+/g, ' ').startsWith('We use Term k0, see Term k1, see Term k2,'), line.slice(0, 120));

    const chain = paperKb([['p', ['See ', ref('a'), ' and ', ref('b'), '.']]]);
    chain.mk('a', ['alpha ', ref('b')], null);
    chain.mk('b', ['beta ', ref('c')], null);
    chain.mk('c', ['gamma ', { i: 'x', text: 'x^2' }], null);
    await runRem2TexConversion(chain.plugin, { parentRem: chain.rems['paper'] });
    t.check(
      '21 …while references without repeats read exactly as before',
      chain.captured.latex.split('\n').includes('See alpha beta gamma $x^2$ and beta gamma $x^2$.'),
      chain.captured.latex
    );
  }

  // ------------------------------------------------- an inline self-reference inlined the rem's own text
  {
    const kb = paperKb([['selfref', ['I mention ', ref('selfref'), ' myself']]]);
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    t.check('self-reference: a rem that references itself does not repeat its own text', kb.captured.latex.split('\n').includes('I mention  myself'), kb.captured.latex);
  }

  // ================================================================================================
  // R-024 (2026-11-25): the second adversarial run's findings, named as its scripts in
  // live-test/adversarial-r2/. Each check failed on the tree that run read.
  const lineOf = (tex: string, start: string) => tex.split('\n').find((l) => l.startsWith(start)) ?? '(none)';

  // ------------------------------------------------- r2-01: a pin-only child mistaken for the Status child
  {
    const r = await exportRewriteExport(() => {
      const kb = paperKb([['disc', ['Discussion'], { getFontSize: async () => 'H2', ...todo }]]);
      kb.mk('discPin', [pin('A')], 'disc');
      kb.mk('discP', ['Some discussion text.'], 'disc');
      kb.mk('t', ['read before submitting'], 'body', todo);
      kb.mk('tPin', [pin('B')], 't', todo);
      return kb;
    });
    t.check("r2-01 a heading+todo's pin-only child is a citation, not the Status child", r.before.split('\n').includes('\\cite{smith2020}'), r.before);
    t.check('r2-01 …and a pin-only todo in a comment tree keeps its line', /% TODO \[ \] \\cite\{jones2019\}/.test(r.before), r.before);
    t.equal('r2-01 …so the rewrite leaves the paper as it was', r.after, r.before);
  }

  // ------------------------------------------------- r2-03: a pin moved across a deleted Zotero pin
  {
    const r = await exportRewriteExport(() =>
      paperKb([
        ['p1', ['Shown before ', pin('A'), ' ', deadRef('Zotero | Items | doe2021', { pin: true }), ' \\cite{other2000}.']],
        ['p2', ['Shown after \\cite{other2000} ', deadRef('Zotero | Items | doe2021', { pin: true }), ' ', pin('B'), '.']],
      ])
    );
    t.equal('r2-03 a pin is never moved across a pin to a deleted Zotero item', r.after, r.before);
  }

  // ------------------------------------------------- r2-04: a pin moved across text a comment shows
  {
    const r = await exportRewriteExport(() =>
      paperKb([
        ['t1', ['compare \\cite{other2000} ', pin('table'), ' ', pin('A')], todo],
        ['c1', ['% check \\cite{other2000} ', pin('table'), ' ', pin('B')]],
      ])
    );
    t.equal('r2-04 in a todo or % rem, a pin is never moved across a pin that reads as text there', r.after, r.before);
  }

  // ------------------------------------------------- r2-06: a key typed as text reordered the keys
  {
    const r = await exportRewriteExport(() => paperKb([['p', ['Two studies agree ', pin('B'), ' ', pin('A'), ' \\cite{smith2020}.']]]));
    t.equal('r2-06 pins before a \\cite that names one of their works as text keep their order', lineOf(r.after, 'Two studies'), lineOf(r.before, 'Two studies'));
  }

  // ------------------------------------------------- r2-07: the popup undercounted pins
  {
    const kb = paperKb([
      ['pa', ['As argued by ', ref('A'), pin('A'), ', the effect is small.']],
      ['pb', ['Two passages agree \\cite{', pin('A'), ' ', pin('passage'), '}.']],
    ]);
    kb.focus(kb.rems['paper']);
    const preview = await previewRem2TexConvert(kb.plugin, { kind: 'paper' });
    t.equal('r2-07 each row counts every pin it converts', preview.pinRows.map((row) => `${row.remId}:${row.pins}`).join(' '), 'pa:1 pb:2');
  }

  // ------------------------------------------------- r2-08: the comment readers split on LF only
  {
    const sel = zoteroKb();
    sel.mk('s', [code('As shown before % see the notes\r\\cite{smith2020} the effect is small.')], null);
    const result = await runSelectionToTexConversion(sel.plugin, { selectedRemIds: ['s'] });
    t.check('r2-08 a citation after a comment that ends at a lone CR is numbered', result.citationCount === 1 && sel.captured.latex.includes('\r[1] the effect'), JSON.stringify(sel.captured.latex.split('\n')[0]));
    const kb = paperKb([['p', ['Figure~\\ref{fig:sample} shows it.']]]);
    kb.mk('img', [{ i: 'i', url: 'sample.png' }], 'body');
    kb.mk('imgFig', [code('\\begin{figure}\r\\caption{A sample}% short caption\r\\label{fig:sample}\r\\end{figure}')], 'img');
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    t.check('r2-08 …and the \\ref check sees a \\label after one', !/fig:sample/.test(kb.captured.log.slice(kb.captured.log.indexOf('Warnings'))), kb.captured.log);
  }

  // ------------------------------------------------- r2-09: missing citation commands
  {
    const kb = paperKb([['p', ['See \\Citep{', pin('A'), '} and \\fullcite{', pin('B'), '}.']]]);
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    t.equal('r2-09 a pin inside \\Citep or \\fullcite exports its key, not a nested \\cite', lineOf(kb.captured.latex, 'See '), 'See \\Citep{smith2020} and \\fullcite{jones2019}.');
    t.equal('r2-09 …\\fullcite stays as typed in the numbered export, \\Citealt keeps its author', renumberCitations('\\Citep{a} \\fullcite{b} \\Citealt{a}').latex, '[1] \\fullcite{b} \\Citeauthor{a} 1');
  }

  // ------------------------------------------------- r2-10: a kept pin double-cited beside a second pin
  {
    const kb = paperKb([
      ['p2', ['Two: listed only \\nocite{smith2020}', pin('A'), ' ', pin('B'), '.']],
      ['p3', ['Three: as shown\\supercite{smith2020}', pin('A'), ' ', pin('B'), '.']],
      ['p4', ['Four: see ', pin('B'), ' ', pin('A'), '\\supercite{smith2020}.']],
    ]);
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    const tex = kb.captured.latex;
    t.check(
      'r2-10 a pin kept beside \\nocite or \\supercite is not cited again when a second pin joins it',
      lineOf(tex, 'Two:') === 'Two: listed only \\nocite{smith2020}\\cite{jones2019}.' &&
        lineOf(tex, 'Three:') === 'Three: as shown\\supercite{smith2020}\\cite{jones2019}.' &&
        lineOf(tex, 'Four:') === 'Four: see \\cite{jones2019}\\supercite{smith2020}.',
      tex
    );
  }

  // ------------------------------------------------- r2-11: dead-reference warnings misattributed
  {
    const dead = () => deadRef('Zotero | Items | doe2021', { pin: true });
    const first = paperKb([['t1', ['check the deleted source ', dead()], todo], ['p1', ['A plain paragraph.']]]);
    await runRem2TexConversion(first.plugin, { parentRem: first.rems['paper'] });
    const warning = (log: string) => log.slice(log.indexOf('no longer exists')).split('\n').find((l) => l.trim().startsWith('rem:')) ?? '(none)';
    t.check('r2-11 a dead reference in a todo is reported against the todo', /check the deleted source/.test(warning(first.captured.log)), warning(first.captured.log));
    const last = paperKb([['p1', ['A plain paragraph.']], ['t1', ['check the deleted source ', dead()], todo]]);
    await runRem2TexConversion(last.plugin, { parentRem: last.rems['paper'] });
    t.check('r2-11 …even when nothing follows it', /check the deleted source/.test(warning(last.captured.log)), last.captured.log);
  }

  // ------------------------------------------------- r2-12 and r2-02: which headings take a generated label
  {
    const build = (preamble: string) => {
      const kb = zoteroKb();
      kb.mk('paper', ['A Sample Paper'], null);
      kb.mk('pre', ['Preamble'], 'paper');
      kb.mk('pre1', [code(preamble)], 'pre');
      kb.mk('s', ['Methods'], 'paper', heading);
      kb.mk('ss', ['Samples'], 's', heading);
      kb.mk('sss', ['Growth'], 'ss', heading);
      kb.mk('par', ['Annealing step'], 'sss', heading);
      kb.mk('parP', ['The samples were annealed once.'], 'par');
      kb.mk('typed', ['\\section*{Acknowledgements}'], 'paper', heading);
      kb.mk('r', ['Results'], 'paper', heading);
      kb.mk('rP', ['As in Section~\\ref{', pin('par'), '}, see Section~\\ref{', pin('typed'), '} and Section~\\ref{', pin('s'), '}.'], 'r');
      kb.mk('end', ['End'], 'paper');
      kb.mk('end1', [code('\\appendix\n\\section{Methods}\\label{sec:methods}\n\\end{document}')], 'end');
      return kb;
    };
    const kb = build('\\documentclass{article}\n\\begin{document}');
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    t.equal(
      'r2-12 no label for a heading LaTeX does not number (\\paragraph, \\section*), and r2-02 none repeating End\'s',
      lineOf(kb.captured.latex, 'As in'),
      'As in Section~\\ref{}, see Section~\\ref{} and Section~\\ref{sec:methods-2}.'
    );
    t.check('r2-12 …the Log says why', (kb.captured.log.match(/heading LaTeX does not number/g) ?? []).length === 2, kb.captured.log);
    t.check('r2-02 …and sec:methods is defined once', !/defined 2 times/.test(kb.captured.log), kb.captured.log);
    const deep = build('\\documentclass{article}\n\\setcounter{secnumdepth}{4}\n\\begin{document}');
    await runRem2TexConversion(deep.plugin, { parentRem: deep.rems['paper'] });
    t.check('r2-12 …while a preamble that numbers \\paragraph gets it labelled', lineOf(deep.captured.latex, 'As in').startsWith('As in Section~\\ref{sec:annealing-step}'), lineOf(deep.captured.latex, 'As in'));
  }

  // ------------------------------------------------- r2-05: floats under one image rem pooled
  {
    const figure = '\\begin{figure}\\caption{Sample}\\label{fig:sample}\\end{figure}';
    const table = '\\begin{table}\\caption{Never cited}\\label{tab:never}\\end{table}';
    const kb = paperKb([['p', ['Figure~\\ref{fig:sample} shows the sample.']]]);
    kb.mk('img', [{ i: 'i', url: 'sample.png' }], 'body');
    kb.mk('imgFig', [code(figure)], 'img');
    kb.mk('imgTab', [code(table)], 'img');
    await runRem2TexConversion(kb.plugin, { parentRem: kb.rems['paper'] });
    t.check('r2-05 two floats in two blocks under one image rem count apart', /Never cited[\s\S]*\\label\{tab:never\}/.test(kb.captured.log), kb.captured.log);
  }

  // ------------------------------------------------- r2-13: a heading pin read the whole paper
  {
    const big = (withPin: boolean) => {
      const kb = paperKb([]);
      for (let s = 0; s < 30; s += 1) {
        kb.mk(`s${s}`, [`Section ${s}`], 'body', h2);
        for (let p = 0; p < 9; p += 1) kb.mk(`s${s}p${p}`, [`Paragraph ${p} of section ${s}.`], `s${s}`);
      }
      kb.mk('target', ['Target'], 'body', h2);
      kb.mk('tp', withPin ? ['See Section~\\ref{', pin('s3'), '}.'] : ['No reference here.'], 'target');
      let calls = 0;
      for (const rem of Object.values(kb.rems) as any[]) {
        const original = rem.getFontSize;
        rem.getFontSize = async () => {
          calls += 1;
          return original();
        };
      }
      return { kb, calls: () => calls };
    };
    const plain = big(false);
    await runParagraphToTexConversion(plain.kb.plugin, { paragraphRem: plain.kb.rems['target'] });
    const pinned = big(true);
    await runParagraphToTexConversion(pinned.kb.plugin, { paragraphRem: pinned.kb.rems['target'] });
    // 300 rems; the 30 "Section N" headings share the title stem `section`, so those 30 are asked
    // once each. Before the fix every rem was (about 300 calls).
    t.check('r2-13 a heading pin asks getFontSize of the same-stem headings, not of every rem', pinned.calls() - plain.calls() < 60, `${plain.calls()} without the pin, ${pinned.calls()} with it`);
  }

  // ------------------------------------------------- r2-14: numbering across lines
  {
    t.equal(
      'r2-14 a \\cite{ inside \\verb is no citation, and no argument runs across a blank line',
      renumberCitations('Type \\verb|\\cite{| to start. Then \\cite{lee2018} is cited.\n\nClose it with \\verb|}| at the end.').latex,
      'Type \\verb|\\cite{| to start. Then [1] is cited.\n\nClose it with \\verb|}| at the end.'
    );
    t.equal('r2-14 …while a key list may wrap across a comment, as LaTeX allows', renumberCitations('As shown \\cite{smith2020, % the first\n  jones2019} here.').latex, 'As shown [1, 2] here.');
  }

  return t.failures();
}
