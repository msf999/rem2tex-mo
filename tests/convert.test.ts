import {
  applyCitekeyRewrite,
  planCitekeyRewrite,
  previewRem2TexConvert,
  runRem2TexConvert,
  writeCitekeyRewriteRecord,
  type Rem2TexConversionContext,
  type Rem2TexPinRow,
} from '../src/lib/rem2tex';
import { code, createFakeKb, heading, pin, ref, suite, todo } from './fake-kb';

/**
 * The pin-to-citekey rewrite as a whole: what the planner will and will not touch, what the
 * applier guarantees when the knowledge base moves underneath it, and the end-to-end promise that
 * converting a paper and exporting it produces the same LaTeX as exporting it unconverted.
 *
 * `tests/citekeys.test.ts` owns the pure rewrite of one rem's rich text; this suite owns everything
 * around it.
 */
export async function run(): Promise<number> {
  const t = suite('pin → citekey: planning, applying, previewing');

  /** A paper with one of every rem the planner has to make a decision about. */
  function buildKb() {
    const kb = createFakeKb();
    const { mk } = kb;

    // The Zotero tree the citekeys come from.
    mk('z', ['Zotero'], null);
    mk('items', ['Items'], 'z');
    mk('A', ['smith2020'], 'items');
    mk('B', ['jones2019'], 'items');
    // A passage note INSIDE an item doc: pins there must never be rewritten.
    mk('pass', ['page 4 highlight, see ', pin('B')], 'A');

    const paper = mk('paper', ['A Sample Paper'], null);
    const pre = mk('pre', ['Preamble'], 'paper');
    mk('pre1', [code('\\documentclass{article}')], 'pre');
    mk('preP', ['preamble note with a pin ', pin('A')], 'pre');

    const intro = mk('intro', ['Introduction'], 'paper', heading);
    mk('p1', ['This matters ', pin('A'), '.'], 'intro');
    mk('p2', ['Both ', pin('A'), pin('B'), '.'], 'intro');
    mk('p3', ['Already \\cite{', ref('A'), pin('A'), '}.'], 'intro');
    mk('p4', [code('\\begin{figure}\\cite{x}\\end{figure}')], 'intro');
    mk('p5', ['No pins here at all.'], 'intro');
    mk('p6', ['A local pin ', pin('p5'), ' is navigation, not a citation.'], 'intro');
    mk('img', ['Figure ', { i: 'i', url: 'x.png' }, ' caption ', pin('A')], 'intro');
    const draft = mk('draft', ['Hidden draft ', pin('B')], 'intro');
    const tag = mk('tag', ['Rem2Tex-ignore'], null);
    draft.tags.push(tag._id);
    // An earlier export sitting in the body: Rem2Tex's own output is never rewritten.
    const folder = mk('r2t', ['Rem2Tex'], 'intro');
    mk('oldrun', ['Rem2Tex 09:42 AM 18-04-2026'], folder._id);
    mk('oldpaper', ['Paper with a pin ', pin('A')], 'oldrun');
    // A PARAGRAPH export, which lands directly under its target with no `Rem2Tex` folder above it,
    // so only `isRem2TexOutputRem` can keep the planner out of it.
    const para = mk('para', ['Rem2Tex paragraph 09:42 AM 18-04-2026'], 'p5');
    mk('parabody', ['Exported prose with a pin ', pin('A')], para._id);
    // A powerup property rem: never document content, so never rewritten.
    mk('slot', ['Status with a pin ', pin('A')], 'p5', { isPowerupProperty: async () => true });

    mk('end', ['End'], 'paper');
    mk('end1', [code('\\end{document}')], 'end');

    return kb;
  }

  /** The context the paper export would build for the body rems. */
  const bodyContext = (ignored: string[] = ['draft']): Rem2TexConversionContext =>
    ({
      hierarchyRemIds: new Set([
        'paper', 'pre', 'pre1', 'preP', 'intro', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6',
        'img', 'draft', 'r2t', 'oldrun', 'oldpaper', 'para', 'parabody', 'slot', 'end', 'end1',
      ]),
      ignoredRemIds: new Set(ignored),
      rootRemId: 'paper',
      todoExportMode: 'all',
    }) as unknown as Rem2TexConversionContext;

  // ------------------------------------------------------------------ the planner's scope
  {
    const { rems, plugin } = buildKb();
    const plan = await planCitekeyRewrite(plugin, [rems['intro']], bodyContext());
    const planned = plan.rows.map((r) => r.remId).sort();

    t.equal('only the two convertible rems are planned', planned.join(','), 'p1,p2');
    t.check('a rem whose pin already has its key is left alone', !planned.includes('p3'));
    t.check('a code block is left alone', !planned.includes('p4'));
    t.check('an ignore-tagged rem is left alone', !planned.includes('draft'));
    t.check('an image rem is left alone', !planned.includes('img'));
    t.check('a pin to a rem inside the paper is not a citation', !planned.includes('p6'));
    t.check('Rem2Tex’s own earlier export is left alone', !planned.includes('oldpaper'));
    t.check(
      'and so is a paragraph export, which has no Rem2Tex folder above it',
      !planned.includes('parabody'),
      planned.join(',')
    );
    t.check('a powerup property rem is left alone', !planned.includes('slot'), planned.join(','));
    t.check('the Preamble is not reachable from the body root', !planned.includes('preP'));
    t.equal('both works are named in the plan', [...plan.keys].sort().join(','), 'jones2019,smith2020');
    t.check('every rem under the root was looked at', plan.scanned >= 10, `scanned ${plan.scanned}`);

    const p2 = plan.rows.find((r) => r.remId === 'p2')!;
    t.equal('a row names the keys it would write', p2.keys.join(','), 'smith2020,jones2019');
    t.equal('a row carries a readable before-preview', p2.previewBefore, 'Both ⟨pin⟩⟨pin⟩.');
    t.equal(
      'and an after-preview showing the keys beside their pins',
      p2.previewAfter,
      'Both \\cite{smith2020⟨pin⟩, jones2019⟨pin⟩}.'
    );
    t.equal('a row carries the outline path for the popup', p2.path, 'Introduction');
  }

  // Pins inside the Zotero tree itself are off limits, whatever root you start from. Starting at
  // the passage note itself, so neither the `Zotero` nor the `Items` title can do the work instead
  // of the ancestor walk this is meant to exercise.
  {
    const { rems, plugin } = buildKb();
    const inside = await planCitekeyRewrite(plugin, [rems['pass']], bodyContext([]));
    t.check(
      'a pin in a passage note inside an item doc is never rewritten',
      inside.rows.length === 0,
      JSON.stringify(inside.rows.map((r) => r.remId))
    );
    const fromRoot = await planCitekeyRewrite(plugin, [rems['z']], bodyContext([]));
    t.check('nor is anything else under Zotero', fromRoot.rows.length === 0);
  }

  // Starting at the paper rem must not reach the boundary blocks either.
  {
    const { rems, plugin } = buildKb();
    const plan = await planCitekeyRewrite(plugin, [rems['paper']], bodyContext());
    const ids = plan.rows.map((r) => r.remId);
    t.check('starting at the paper rem still skips Preamble/End', !ids.includes('preP'), ids.join(','));
  }

  // ------------------------------------------------------------------ the applier
  {
    const { rems, plugin } = buildKb();
    const ctx = bodyContext();
    const plan = await planCitekeyRewrite(plugin, [rems['intro']], ctx);

    const progress: Array<[number, number]> = [];
    const applied = await applyCitekeyRewrite(plugin, plan.rows, (done, total) => progress.push([done, total]));

    t.check(
      'every planned row is applied',
      applied.applied.length === 2 && applied.skipped.length === 0 && applied.failed.length === 0,
      JSON.stringify({ skipped: applied.skipped.map((s) => s.reason), failed: applied.failed })
    );
    t.equal('progress is reported once per row', JSON.stringify(progress), '[[1,2],[2,2]]');
    t.check(
      'the write landed in the rem',
      JSON.stringify(rems['p1'].text) === JSON.stringify(plan.rows.find((r) => r.remId === 'p1')!.after)
    );

    const replan = await planCitekeyRewrite(plugin, [rems['intro']], ctx);
    t.check('re-planning after an apply finds nothing to do', replan.rows.length === 0);

    const reapply = await applyCitekeyRewrite(plugin, plan.rows);
    t.check(
      'and re-applying the same plan is refused rather than repeated',
      reapply.applied.length === 0 && reapply.skipped.length === 2,
      JSON.stringify(reapply.skipped.map((s) => s.reason))
    );
  }

  // A rem the author edited between preview and apply must survive untouched.
  {
    const { rems, plugin } = buildKb();
    const plan = await planCitekeyRewrite(plugin, [rems['intro']], bodyContext());
    const row = plan.rows.find((r) => r.remId === 'p1')!;
    const edited = ['Rewritten by hand since the preview ', pin('A'), '.'];
    rems['p1'].text = edited;

    const applied = await applyCitekeyRewrite(plugin, [row]);
    t.equal(
      'a rem edited since the preview is skipped, with a reason',
      applied.skipped.map((s) => s.reason).join(','),
      'edited since the preview'
    );
    t.check("and the author's edit is still there", JSON.stringify(rems['p1'].text) === JSON.stringify(edited));
  }

  // A rem deleted between preview and apply is reported, not thrown.
  {
    const { rems, plugin } = buildKb();
    const plan = await planCitekeyRewrite(plugin, [rems['intro']], bodyContext());
    const row = plan.rows.find((r) => r.remId === 'p1')!;
    delete rems['p1'];
    const applied = await applyCitekeyRewrite(plugin, [row]);
    t.equal(
      'a rem that no longer exists is skipped, with a reason',
      applied.skipped.map((s) => s.reason).join(','),
      'the rem no longer exists'
    );
  }

  // One failing rem must not abandon the rest of the plan.
  {
    const { rems, plugin } = buildKb();
    const plan = await planCitekeyRewrite(plugin, [rems['intro']], bodyContext());
    rems['p1'].setText = async () => {
      throw new Error('setText exploded');
    };
    const applied = await applyCitekeyRewrite(plugin, plan.rows);
    t.check(
      'a rem whose write fails is recorded and the others still land',
      applied.failed.length === 1 && applied.failed[0].row.remId === 'p1' && applied.applied.length === 1,
      JSON.stringify({ failed: applied.failed.map((f) => f.error), applied: applied.applied.map((a) => a.remId) })
    );
  }

  // ------------------------------------------------------------------ the undo record
  {
    const { rems, plugin } = buildKb();
    const plan = await planCitekeyRewrite(plugin, [rems['intro']], bodyContext());
    await applyCitekeyRewrite(plugin, plan.rows);

    const title = await writeCitekeyRewriteRecord(plugin, rems['paper'], plan.rows, new Date(2026, 9, 8, 18, 15));
    t.equal('the record rem is named after the run', title ?? '', 'Rem2Tex rewrite 06:15 PM 08-10-2026');

    const none = await writeCitekeyRewriteRecord(plugin, rems['paper'], [], new Date(2026, 9, 8, 18, 15));
    t.check('nothing applied means no record rem', none === undefined);

    // The record holds the before-text, which contains pins — and must itself be out of scope.
    const record = Object.values(rems).find((r: any) => /^Rem2Tex rewrite /.test(String(r.text?.[0] ?? '')));
    t.check('the record rem exists under the Rem2Tex folder', !!record);
    const replan = await planCitekeyRewrite(plugin, [rems['paper']], bodyContext());
    t.check('and a later plan never rewrites the record itself', replan.rows.length === 0, JSON.stringify(replan.rows.map((r) => r.remId)));
  }

  // ------------------------------------------------------------------ preview
  {
    const kb = buildKb();
    const { rems, plugin, focus } = kb;
    focus(rems['paper']);

    const before = Object.keys(rems).length;
    const preview = await previewRem2TexConvert(plugin, { kind: 'paper', todoExportMode: 'unfinished' });

    t.equal('a paper preview names what it would export', preview.targetTitle, 'A Sample Paper');
    t.equal('it carries the todo mode it was asked for', preview.todoExportMode, 'unfinished');
    t.equal('it lists the rems it would rewrite', preview.pinRows.map((r) => r.remId).sort().join(','), 'p1,p2');
    t.equal('and the works they name', [...preview.pinKeys].sort().join(','), 'jones2019,smith2020');
    t.check('a valid paper is not blocked', !preview.blocked);
    t.check('a preview writes NOTHING', Object.keys(rems).length === before, `${before} → ${Object.keys(rems).length}`);
    t.check(
      'and leaves every rem’s text alone',
      JSON.stringify(rems['p1'].text) === JSON.stringify(['This matters ', pin('A'), '.'])
    );
  }

  // Previewing a rem that is not a paper reports the reason instead of throwing.
  {
    const { rems, plugin, focus } = buildKb();
    focus(rems['p5']);
    const preview = await previewRem2TexConvert(plugin, { kind: 'paper' });
    t.check('a non-paper preview is blocked', preview.blocked);
    t.check(
      'with an error issue explaining why',
      preview.issues.some((i) => i.severity === 'error' && /Preamble/.test(i.message)),
      JSON.stringify(preview.issues)
    );
  }

  // The paragraph kind has no Preamble/End rules, so any rem is a valid target.
  {
    const { rems, plugin, focus } = buildKb();
    focus(rems['intro']);
    const preview = await previewRem2TexConvert(plugin, { kind: 'paragraph' });
    t.check('a paragraph preview works on any rem', !preview.blocked, JSON.stringify(preview.issues));
    t.equal(
      'and still finds the pins under it',
      preview.pinRows.map((r) => r.remId).sort().join(','),
      'p1,p2'
    );
  }

  // ------------------------------------------------------------------ run: convert, then export
  {
    const { rems, plugin, captured, focus } = buildKb();
    focus(rems['paper']);

    const preview = await previewRem2TexConvert(plugin, { kind: 'paper' });
    const result = await runRem2TexConvert(plugin, {
      kind: 'paper',
      todoExportMode: 'all',
      pinRows: preview.pinRows,
    });

    t.check(
      'the run writes the pins it was given',
      result.pinsWritten === 2 && result.pinsSkipped === 0 && result.pinsFailed === 0,
      JSON.stringify(result)
    );
    t.check('and records them for undo', !!result.recordTitle);
    t.check('the paper is exported too', /^Rem2Tex \d\d:\d\d [AP]M /.test(result.outputTitle), result.outputTitle);
    t.check(
      'the exported LaTeX cites both works',
      captured.latex.includes('\\cite{smith2020}') && captured.latex.includes('\\cite{smith2020, jones2019}'),
      captured.latex
    );
    t.check(
      'and never doubles a citation for a kept pin',
      !/\\cite\{[^}]*\\cite/.test(captured.latex) && !/\\cite\{smith2020\}\s*\\cite\{smith2020\}/.test(captured.latex),
      captured.latex
    );
  }

  // The headline promise: converting first changes the rems but not the export.
  {
    const plain = buildKb();
    plain.focus(plain.rems['paper']);
    await runRem2TexConvert(plain.plugin, { kind: 'paper', todoExportMode: 'all' });
    const texWithoutRewrite = plain.captured.latex;

    const converted = buildKb();
    converted.focus(converted.rems['paper']);
    const preview = await previewRem2TexConvert(converted.plugin, { kind: 'paper' });
    await runRem2TexConvert(converted.plugin, {
      kind: 'paper',
      todoExportMode: 'all',
      pinRows: preview.pinRows,
    });

    t.equal(
      'converting the pins leaves the exported LaTeX byte-identical',
      converted.captured.latex,
      texWithoutRewrite
    );
    // The key is written as a REM REFERENCE to the item doc (mo's own citing style), not as literal
    // text, so the rem must now hold: a typed `\\cite{`, a plain reference to the item, and the
    // original pin still beside it.
    const p1 = converted.rems['p1'].text as any[];
    t.check(
      'the rem now holds a typed \\cite{ … }',
      p1.some((e) => e === '\\cite{') && p1.some((e) => e === '}'),
      JSON.stringify(p1)
    );
    t.check(
      'with the citekey as a reference to the item doc, not as text',
      p1.some((e) => e && e.i === 'q' && e._id === 'A' && !e.pin),
      JSON.stringify(p1)
    );
    t.check(
      'and the author’s pin kept, inside the braces',
      p1.some((e) => e && e.i === 'q' && e._id === 'A' && e.pin === true),
      JSON.stringify(p1)
    );
  }

  // A FAILED conversion must say so. It still writes an export rem (Log only), so a caller that
  // only looks at `outputTitle` would report the failure as a success — which is exactly what the
  // popup toast did until 2026-10-08.
  {
    const kb = createFakeKb();
    const { mk, plugin, focus } = kb;
    const paper = mk('paper', ['A Sample Paper'], null);
    mk('pre', ['Preamble'], 'paper'); // no code block underneath → EMPTY_BOUNDARY_BLOCK
    mk('body', ['Some prose.'], 'paper');
    const end = mk('end', ['End'], 'paper');
    mk('end1', [code('\\end{document}')], end._id);
    focus(paper);

    const result = await runRem2TexConvert(plugin, { kind: 'paper', todoExportMode: 'all' });
    t.equal('a failed paper conversion reports status "failed"', result.status, 'failed');
    t.equal('and names the error code', result.errorCode ?? '', 'EMPTY_BOUNDARY_BLOCK');
    t.check('and carries a headline to toast', !!result.errorHeadline, String(result.errorHeadline));
    t.check('while still naming the Log-only export rem', /^Rem2Tex \d\d:\d\d [AP]M /.test(result.outputTitle), result.outputTitle);
  }

  // A successful conversion must report success, so the check above cannot pass by always failing.
  {
    const kb = buildKb();
    kb.focus(kb.rems['paper']);
    const result = await runRem2TexConvert(kb.plugin, { kind: 'paper', todoExportMode: 'all' });
    t.equal('a successful paper conversion reports status "success"', result.status, 'success');
    t.check('with no error code', result.errorCode === undefined, String(result.errorCode));
  }

  // Neutrality inside TODO and `%` COMMENT trees. The original neutrality fixture had neither, and
  // the comment-tree label is built from `flattenRawTitleText`, which ignores references — so a
  // rewritten child used to label itself with a bare `\cite{}` (2026-10-08 audit).
  {
    const buildCommentKb = () => {
      const kb = createFakeKb();
      const { mk } = kb;
      mk('z', ['Zotero'], null);
      mk('items', ['Items'], 'z');
      mk('A', ['smith2020'], 'items');
      mk('B', ['jones2019'], 'items');
      const paper = mk('paper', ['A Sample Paper'], null);
      const pre = mk('pre', ['Preamble'], 'paper');
      mk('pre1', [code('\\documentclass{article}')], pre._id);
      mk('body', ['Body'], 'paper', heading);
      // a todo whose own text cites, with a prose child that also cites (→ a comment-tree label)
      mk('t1', ['read ', pin('A'), ' before revising'], 'body', todo);
      mk('t1c', ['child prose citing ', pin('B')], 't1');
      // a `%` comment rem that cites, with a child that cites
      mk('c1', ['% reviewer asked about ', pin('A')], 'body');
      mk('c1c', ['nested note on ', pin('B')], 'c1');
      mk('p1', ['Ordinary prose citing ', pin('A'), '.'], 'body');
      const end = mk('end', ['End'], 'paper');
      mk('end1', [code('\\end{document}')], end._id);
      return kb;
    };

    const plain = buildCommentKb();
    plain.focus(plain.rems['paper']);
    await runRem2TexConvert(plain.plugin, { kind: 'paper', todoExportMode: 'all' });
    const texPlain = plain.captured.latex;

    const converted = buildCommentKb();
    converted.focus(converted.rems['paper']);
    const commentPreview = await previewRem2TexConvert(converted.plugin, { kind: 'paper' });
    t.equal(
      'the todo, its child, the comment rem and its child are all planned',
      commentPreview.pinRows.map((r) => r.remId).sort().join(','),
      'c1,c1c,p1,t1,t1c'
    );
    await runRem2TexConvert(converted.plugin, {
      kind: 'paper',
      todoExportMode: 'all',
      pinRows: commentPreview.pinRows,
    });

    t.equal('a rewrite inside todo and % comment trees is output-neutral too', converted.captured.latex, texPlain);
    t.check(
      'and no comment-tree label leaks an empty \\cite{}',
      !/\\cite\{\s*\}/.test(converted.captured.latex),
      converted.captured.latex
    );
    t.check(
      'the todo comment still names the work it cites',
      /% TODO \[ \] read \\cite\{smith2020\} before revising/.test(converted.captured.latex),
      converted.captured.latex
    );
  }

  // Neutrality for the SELECTION export, where citation ORDER becomes visible as [1], [2], … and a
  // bibliography is generated from the keys. One of the 2026-10-08 bugs was an order swap, which
  // this path would have renumbered — the paper export could never have shown it.
  {
    const buildSelKb = () => {
      const kb = createFakeKb();
      const { mk } = kb;
      mk('z', ['Zotero'], null);
      mk('items', ['Items'], 'z');
      mk('A', ['smith2020'], 'items');
      mk('B', ['jones2019'], 'items');
      const sel = mk('sel', ['Section'], null, heading);
      // Shapes that exercise first-appearance numbering AND the fixed edge cases.
      mk('s1', ['First ', pin('B'), ' then ', pin('A'), '.'], 'sel');
      mk('s2', [pin('A'), '\\cite{typed2001}', pin('B')], 'sel');
      mk('s3', ['Reuse ', pin('B'), ' once more.'], 'sel');
      mk('s4', ['\\supercite{', pin('A'), '}'], 'sel');
      return kb;
    };

    const plain = buildSelKb();
    plain.focus(plain.rems['sel']);
    await runRem2TexConvert(plain.plugin, { kind: 'selection', selectedRemIds: ['sel'] });
    const texPlain = plain.captured.latex;

    const converted = buildSelKb();
    converted.focus(converted.rems['sel']);
    const selPreview = await previewRem2TexConvert(converted.plugin, {
      kind: 'selection',
      selectedRemIds: ['sel'],
    });
    const selResult = await runRem2TexConvert(converted.plugin, {
      kind: 'selection',
      selectedRemIds: ['sel'],
      pinRows: selPreview.pinRows,
    });

    t.check('the selection preview finds the pins', selPreview.pinRows.length === 4, JSON.stringify(selPreview.pinRows.map((r) => r.remId)));
    t.equal('a rewritten selection export is byte-identical too', converted.captured.latex, texPlain);
    t.check(
      'and it really did number the citations (so the check is not comparing two empty strings)',
      /\[1\]/.test(texPlain) && /\[2\]/.test(texPlain),
      texPlain
    );
    t.check('the citekey writes are reported', selResult.pinsWritten === 4, JSON.stringify(selResult));
  }

  // The preview must actually COLLECT warnings, not merely fail to block on them.
  {
    const kb = buildKb();
    // An image rem with no figure/table child under it is the exporter's standard warning case.
    kb.mk('imgwarn', ['Caption ', { i: 'i', url: 'y.png' }], 'intro');
    kb.rems['imgwarn'].parent = 'intro';
    kb.focus(kb.rems['paper']);
    const preview = await previewRem2TexConvert(kb.plugin, { kind: 'paper' });
    t.check(
      'a preview reports the exporter’s warnings',
      preview.issues.some((i) => i.severity === 'warning'),
      JSON.stringify(preview.issues)
    );
    t.check('and warnings do not block the export', !preview.blocked, JSON.stringify(preview.issues));
  }

  // The todo mode must reach the EXPORT, not just echo back from the preview.
  {
    for (const [mode, shouldAppear] of [['all', true], ['none', false]] as const) {
      const kb = buildKb();
      kb.mk('td', ['a todo that cites nothing'], 'intro', { isTodo: async () => true, getTodoStatus: async () => 'Unfinished' });
      kb.focus(kb.rems['paper']);
      await runRem2TexConvert(kb.plugin, { kind: 'paper', todoExportMode: mode });
      const present = /% TODO \[ \] a todo that cites nothing/.test(kb.captured.latex);
      t.check(
        `todoExportMode '${mode}' reaches the exporter (todo comment ${shouldAppear ? 'present' : 'absent'})`,
        present === shouldAppear,
        kb.captured.latex
      );
    }
  }

  // Omitting pinRows must export without touching a single rem.
  {
    const { rems, plugin, focus } = buildKb();
    focus(rems['paper']);
    const before = JSON.stringify(rems['p1'].text);
    const result = await runRem2TexConvert(plugin, { kind: 'paper', todoExportMode: 'all' });
    t.check('declining the rewrite writes no pins', result.pinsWritten === 0 && !result.recordTitle);
    t.check('and leaves the rem exactly as it was', JSON.stringify(rems['p1'].text) === before);
  }

  return t.failures();
}
