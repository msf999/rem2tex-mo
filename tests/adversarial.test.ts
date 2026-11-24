import {
  applyCitekeyRewrite,
  describeConvertError,
  dropCitationsCoveredByAdjacentCommand,
  getRemTitle,
  planCitekeyRewrite,
  previewRem2TexConvert,
  REM2TEX_FOCUS_CACHE_KEY,
  rewriteRichTextWithCitekeys,
  runParagraphToTexConversion,
  runRem2TexConversion,
  runRem2TexConvert,
} from '../src/lib/rem2tex';
import { code, createFakeKb, heading, pin, ref, suite, todo } from './fake-kb';

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

  return t.failures();
}
