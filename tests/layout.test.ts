import { runRem2TexConversion, isRem2TexConversionError } from '../src/lib/rem2tex';
import { createFakeKb, code, heading, suite } from './fake-kb';

/** Paper layout (Preamble/End anchors, any child as starting point), the Paper/Log output shape, the Log text. */
export async function run(): Promise<number> {
  const t = suite('paper layout, output shape, log');
  const { rems, mk, plugin, captured } = createFakeKb();

  // mo's structure: Paper › Scratchpad, Preamble, Abstract, …, End, Supplementary Information
  const paper = mk('paper', ['Paper'], null);
  mk('scratch', ['Scratchpad'], 'paper');
  mk('scratch1', ['random thoughts & drafts'], 'scratch');
  const pre = mk('pre', ['Preamble'], 'paper');
  mk('pre1', [code('\\documentclass{article}\n\\title{Nitrides}\n\\author{mo}\n\\begin{document}')], 'pre');
  mk('abs', ['Abstract'], 'paper', heading);
  mk('abs1', ['We study nitrides.'], 'abs');
  mk('intro', ['Introduction'], 'paper', heading);
  mk('intro1', ['Renewed interest.'], 'intro');
  mk('end', ['End'], 'paper');
  mk('end1', [code('\\end{document}')], 'end');
  mk('si', ['Supplementary Information'], 'paper', heading); // after End → ignored
  const expected = ['\\documentclass{article}', '\\title{Nitrides}', '\\author{mo}', '\\begin{document}', '', '\\section{Abstract}', '', 'We study nitrides.', '', '\\section{Introduction}', '', 'Renewed interest.', '', '\\end{document}'].join('\n');

  // 1. from the paper rem
  captured.latex = '';
  const res1 = await runRem2TexConversion(plugin, { parentRem: paper });
  t.equal('paper rem: Scratchpad (before Preamble) and post-End rems ignored', captured.latex, expected);
  t.check('result is success without warnings', res1.status === 'success' && res1.warningCount === 0, JSON.stringify(res1));
  {
    const exportRem: any = Object.values(rems).find((r: any) => typeof r.text[0] === 'string' && r.text[0].startsWith('Rem2Tex ') && rems[r.parent]?.text[0] === 'Rem2Tex');
    const folder: any = exportRem && rems[exportRem.parent];
    const kids: any[] = Object.values(rems).filter((r: any) => r.parent === exportRem?._id);
    const paperRem = kids.find((r) => r.text[0] === 'Paper');
    const logRem = kids.find((r) => r.text[0] === 'Log');
    const paperCode: any = Object.values(rems).find((r: any) => r.parent === paperRem?._id);
    const logCode: any = Object.values(rems).find((r: any) => r.parent === logRem?._id);
    t.check('shape: paper rem → Rem2Tex → timestamp rem → Paper → latex block, → Log → text block',
      !!folder && folder.parent === 'paper' && kids.length === 2 && kids[0] === paperRem && kids[1] === logRem && paperCode?.text?.[0]?.language === 'latex' && paperCode.text[0].text === expected && logCode?.text?.[0]?.language === 'text' && logCode.text[0].text.startsWith('Rem2Tex conversion log'),
      JSON.stringify(kids.map((k) => k.text[0])));
  }

  // 2. from the Preamble rem and from a sibling section: same paper, same output
  captured.latex = '';
  await runRem2TexConversion(plugin, { parentRem: pre });
  t.equal('Preamble rem focused: hops to the parent', captured.latex, expected);
  captured.latex = '';
  captured.log = '';
  const resAbs = await runRem2TexConversion(plugin, { parentRem: rems['abs'] });
  t.equal('Abstract (a sibling) focused: converts the parent paper', captured.latex, expected);
  const needles = ['Rem2Tex conversion log', 'command started on its child "Abstract"', 'Ignored before Preamble (1): "Scratchpad"', 'Ignored after End (', '"Supplementary Information"', 'Title: Nitrides', 'Author(s): mo', 'Headings: 2', 'SUCCESS'];
  t.check('log lists setup, structure, preamble metadata, counts and result', resAbs.status === 'success' && needles.every((n) => captured.log.includes(n)), captured.log);

  // 3. phase A errors (toasted): NOT_A_PAPER with a diagnosis of the rem and its parent
  const expectCode = async (name: string, fn: () => Promise<unknown>, codeExpected: string, extra?: (e: any) => boolean) => {
    try {
      await fn();
      t.check(name, false, 'no throw');
    } catch (e: any) {
      t.check(name, isRem2TexConversionError(e) && e.code === codeExpected && (!extra || extra(e)), `got ${isRem2TexConversionError(e) ? `${e.code}: ${e.whatHappened}` : e?.message}`);
    }
  };
  const lonely = mk('lonely', ['Preamble'], null);
  mk('lonely1', [code('x')], 'lonely');
  await expectCode('Preamble with no parent → NOT_A_PAPER', () => runRem2TexConversion(plugin, { parentRem: lonely }), 'NOT_A_PAPER');
  const p2 = mk('p2', ['Paper 2'], null);
  const pre2 = mk('pre2', ['Preamble'], 'p2');
  mk('pre2a', [code('x')], 'pre2');
  mk('p2b', ['Body'], 'p2');
  await expectCode('Preamble focused but no End sibling → NOT_A_PAPER', () => runRem2TexConversion(plugin, { parentRem: pre2 }), 'NOT_A_PAPER');
  const p3 = mk('p3', ['Paper 3'], null);
  mk('p3a', ['Scratchpad'], 'p3');
  mk('p3b', ['End'], 'p3');
  await expectCode('no Preamble anywhere → NOT_A_PAPER', () => runRem2TexConversion(plugin, { parentRem: p3 }), 'NOT_A_PAPER');
  await expectCode('grandchild focused → NOT_A_PAPER names both the rem and its parent', () => runRem2TexConversion(plugin, { parentRem: rems['scratch1'] }), 'NOT_A_PAPER',
    (e) => /its parent "Scratchpad" has no child titled "Preamble"/.test(e.whatHappened));

  // 4. phase B failure: written as a Log-only export, not thrown
  const p5 = mk('p5', ['Paper 5'], null);
  mk('p5pre', ['Preamble'], 'p5');
  mk('p5preSize', ['Size'], 'p5pre');
  mk('p5body', ['body'], 'p5');
  mk('p5end', ['End'], 'p5');
  mk('p5end1', [code('E')], 'p5end');
  captured.latex = 'UNCHANGED';
  captured.log = '';
  const res5 = await runRem2TexConversion(plugin, { parentRem: p5 });
  t.check('empty Preamble → status failed, no Paper rem, Log explains EMPTY_BOUNDARY_BLOCK',
    res5.status === 'failed' && res5.errorCode === 'EMPTY_BOUNDARY_BLOCK' && captured.latex === 'UNCHANGED' && captured.log.includes('FAILED — EMPTY_BOUNDARY_BLOCK') && captured.log.includes('No Paper rem was written'),
    JSON.stringify(res5) + '\n' + captured.log);

  // 5. a warning (image rem without media) is counted and listed
  const p6 = mk('p6', ['Paper 6'], null);
  mk('p6pre', ['Preamble'], 'p6');
  mk('p6pre1', [code('P')], 'p6pre');
  mk('p6img', [{ i: 'i', url: 'x.png' }], 'p6');
  mk('p6end', ['End'], 'p6');
  mk('p6end1', [code('E')], 'p6end');
  captured.log = '';
  const res6 = await runRem2TexConversion(plugin, { parentRem: p6 });
  t.check('image rem without media → success with 1 warning listed in the Log', res6.status === 'success' && res6.warningCount === 1 && /Warnings \(1\)/.test(captured.log) && /REM2TEX WARNING box was inserted/.test(captured.log), JSON.stringify(res6) + '\n' + captured.log);

  // 6. an End before Preamble does not count; the first End after it closes the body
  const p4 = mk('p4', ['Paper 4'], null);
  mk('p4end0', ['End'], 'p4');
  mk('p4pre', ['Preamble'], 'p4');
  mk('p4pre1', [code('P')], 'p4pre');
  mk('p4body', ['body'], 'p4');
  mk('p4end', ['End'], 'p4');
  mk('p4end1', [code('E')], 'p4end');
  captured.latex = '';
  await runRem2TexConversion(plugin, { parentRem: p4 });
  t.equal('an End before Preamble is ignored; the first End after it closes the body', captured.latex, 'P\n\nbody\n\nE');

  // 7. Rem2Tex's own output inside the body is never re-exported (item 4 of the 2026-09-03 batch)
  const p7 = mk('p7', ['Paper 7'], null);
  mk('p7pre', ['Preamble'], 'p7');
  mk('p7pre1', [code('P')], 'p7pre');
  mk('p7sec', ['Section'], 'p7', heading);
  mk('p7prose', ['real prose'], 'p7sec');
  mk('p7old', ['Rem2Tex paragraph 01:00 PM 01-01-2026'], 'p7sec');
  mk('p7oldcode', [code('OLD EXPORT')], 'p7old');
  mk('p7folder', ['Rem2Tex'], 'p7'); // an exports folder that ended up before End
  mk('p7folder1', ['Rem2Tex 02:00 PM 02-02-2026'], 'p7folder');
  mk('p7end', ['End'], 'p7');
  mk('p7end1', [code('E')], 'p7end');
  captured.latex = '';
  captured.log = '';
  const res7 = await runRem2TexConversion(plugin, { parentRem: p7 });
  t.equal('old paragraph export and a misplaced Rem2Tex folder are skipped', captured.latex, 'P\n\n\\section{Section}\n\nreal prose\n\nE');
  t.check('log counts the skipped output rems', res7.status === 'success' && /Earlier Rem2Tex export rems found inside the body and skipped: 2/.test(captured.log), captured.log);

  // 8. silently lost content is warned about (item 5): image-rem children, todo skipped by the mode
  const p8 = mk('p8', ['Paper 8'], null);
  mk('p8pre', ['Preamble'], 'p8');
  mk('p8pre1', [code('P')], 'p8pre');
  mk('p8img', [{ i: 'i', url: 'x.png' }], 'p8');
  mk('p8fig', [code('\\begin{figure}\\end{figure}')], 'p8img');
  mk('p8caption', ['a caption typed as prose'], 'p8img');
  mk('p8imgSize', ['Size'], 'p8img', { isPowerupProperty: async () => true }); // bookkeeping, never counted
  const p8todo = mk('p8todo', ['finished todo'], 'p8', { isTodo: async () => true, getTodoStatus: async () => 'Finished' });
  mk('p8todoStatus', ['Status'], 'p8todo', { isPowerupSlot: async () => true });
  mk('p8lost', ['prose under the finished todo'], 'p8todo');
  mk('p8todo2', ['finished todo with only todo children'], 'p8', { isTodo: async () => true, getTodoStatus: async () => 'Finished' });
  mk('p8todo2a', ['nested todo'], 'p8todo2', { isTodo: async () => true, getTodoStatus: async () => 'Unfinished' });
  mk('p8end', ['End'], 'p8');
  mk('p8end1', [code('E')], 'p8end');
  captured.latex = '';
  captured.log = '';
  const res8 = await runRem2TexConversion(plugin, { parentRem: p8, todoExportMode: 'unfinished' });
  t.equal('image children and the skipped todo are absent from the paper', captured.latex, 'P\n\n\\begin{figure}\\end{figure}\n\nE');
  t.check('exactly two warnings: image-rem child not exported, todo skipped with 1 lost descendant (Status/Size children ignored; todo-only subtree not warned)',
    res8.status === 'success' && res8.warningCount === 2
      && /Image rem .*1 child rem\(s\) that are not figure\/table blocks were not exported.*"a caption typed as prose"/.test(captured.log)
      && /Todo "finished todo" was skipped by the todo mode together with 1 non-todo descendant rem\(s\).*"prose under the finished todo"/.test(captured.log),
    JSON.stringify(res8) + '\n' + captured.log);

  // 9. a childless boundary rem is empty (item 6) — its title is not the block; back text still counts
  const p9 = mk('p9', ['Paper 9'], null);
  mk('p9pre', ['Preamble'], 'p9');
  mk('p9body', ['body'], 'p9');
  mk('p9end', ['End'], 'p9');
  mk('p9end1', [code('E')], 'p9end');
  captured.latex = 'UNCHANGED';
  const res9 = await runRem2TexConversion(plugin, { parentRem: p9 });
  t.check('childless Preamble → EMPTY_BOUNDARY_BLOCK (no Paper rem)', res9.status === 'failed' && res9.errorCode === 'EMPTY_BOUNDARY_BLOCK' && captured.latex === 'UNCHANGED', JSON.stringify(res9));
  rems['p9pre'].backText = [code('\\documentclass{article}')];
  captured.latex = '';
  const res9b = await runRem2TexConversion(plugin, { parentRem: p9 });
  t.check('childless Preamble with a code block on its back text works', res9b.status === 'success' && captured.latex === '\\documentclass{article}\n\nbody\n\nE', JSON.stringify(res9b) + '\n' + captured.latex);

  return t.failures();
}
