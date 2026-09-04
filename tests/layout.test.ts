import { runRem2TexConversion, runParagraphToTexConversion, isRem2TexConversionError } from '../src/lib/rem2tex';
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
  // The box's own message must be escaped in ONE pass: chaining replaces used to mangle the
  // `\textbackslash{}` it inserted into `\textbackslash\{\}` (found in live testing, 2026-09-04).
  t.check('the REM2TEX WARNING box escapes its message without breaking \\textbackslash{}',
    captured.latex.includes('\\textbackslash{}begin\\{figure\\}') && !captured.latex.includes('\\textbackslash\\{\\}'),
    captured.latex);

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
  // The Structure section must not count a skipped export among the body rems (2026-09-04).
  t.check('Structure lists only converted body rems and names the skipped exports separately',
    /Body rems \(1\): "Section"/.test(captured.log) && /Ignored inside the body — earlier Rem2Tex exports \(1\): "Rem2Tex"/.test(captured.log),
    captured.log);

  // 8. silently lost content is warned about (item 5): image-rem children, todo skipped by the mode
  const p8 = mk('p8', ['Paper 8'], null);
  mk('p8pre', ['Preamble'], 'p8');
  mk('p8pre1', [code('P')], 'p8pre');
  mk('p8img', ['Figure 1: the setup ', { i: 'i', url: 'x.png' }], 'p8');
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
  t.check('three warnings: the image rem\'s own caption, its non-media child, and the skipped todo (Status/Size children ignored; todo-only subtree not warned)',
    res8.status === 'success' && res8.warningCount === 3
      && /its own text was not exported.*"Figure 1: the setup"/.test(captured.log)
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

  // 10. Rem2Tex's own output never re-enters an export, wherever it sits (review findings, 2026-09-04)
  const p10 = mk('p10', ['Paper 10'], null);
  const p10pre = mk('p10pre', ['Preamble'], 'p10');
  mk('p10pre1', [code('\\documentclass{article}')], 'p10pre');
  const oldPara = mk('p10old', ['Rem2Tex paragraph 01:00 PM 01-01-2026'], 'p10pre'); // a check-run left under Preamble
  mk('p10oldcode', [code('\\documentclass{article}\nSTALE')], 'p10old');
  const p10todo = mk('p10todo', ['fix the intro'], 'p10', { isTodo: async () => true, getTodoStatus: async () => 'Unfinished' });
  mk('p10todonote', ['sub note'], 'p10todo');
  const oldPara2 = mk('p10old2', ['Rem2Tex paragraph 02:00 PM 02-02-2026'], 'p10todo'); // and one under a todo
  mk('p10old2code', [code('OLD')], oldPara2._id);
  mk('p10end', ['End'], 'p10');
  mk('p10end1', [code('\\end{document}')], 'p10end');
  captured.latex = '';
  captured.log = '';
  const res10 = await runRem2TexConversion(plugin, { parentRem: p10 });
  t.equal('an old paragraph export under Preamble / under a todo is never folded back in', captured.latex,
    ['\\documentclass{article}', '', '% TODO [ ] fix the intro', ' %  - sub note', '', '\\end{document}'].join('\n'));
  t.check('both skipped exports are counted in the Log', res10.status === 'success' && /Earlier Rem2Tex export rems found inside the body and skipped: 2/.test(captured.log), captured.log);
  void oldPara;

  // 11. Paragraph export with nothing to emit reports why instead of writing an empty block
  const expectThrow = async (name: string, fn: () => Promise<unknown>, codeExpected: string) => {
    try {
      await fn();
      t.check(name, false, 'no throw');
    } catch (e: any) {
      t.check(name, isRem2TexConversionError(e) && e.code === codeExpected, `got ${isRem2TexConversionError(e) ? e.code : e?.message}`);
    }
  };
  await expectThrow('paragraph export on one of Rem2Tex\'s own export rems → NOTHING_TO_EXPORT', () => runParagraphToTexConversion(plugin, { paragraphRem: oldPara2 }), 'NOTHING_TO_EXPORT');
  await expectThrow('paragraph export on an empty rem → NOTHING_TO_EXPORT', () => runParagraphToTexConversion(plugin, { paragraphRem: mk('blank', [''], null) }), 'NOTHING_TO_EXPORT');

  // 12. A boundary rem's back-text code block counts even when the rem has children (review finding)
  const p11 = mk('p11', ['Paper 11'], null);
  const p11pre = mk('p11pre', ['Preamble'], 'p11');
  p11pre.backText = [code('\\documentclass{article}')];
  mk('p11note', ['journal template v2'], 'p11pre'); // a plain note child used to win over the back text
  mk('p11body', ['body'], 'p11');
  mk('p11end', ['End'], 'p11');
  mk('p11end1', [code('E')], 'p11end');
  captured.latex = '';
  captured.log = '';
  const res11 = await runRem2TexConversion(plugin, { parentRem: p11 });
  t.check('back-text code block wins over a plain note child, which is kept as a % REM2TEX comment',
    res11.status === 'success' && captured.latex.startsWith('\\documentclass{article}\n% REM2TEX: plain-text rem under Preamble') && captured.latex.includes('journal template v2') && captured.latex.endsWith('body\n\nE'),
    captured.latex);

  // 13. A heading with no title is not counted and is warned about (Log matches the paper)
  const p12 = mk('p12', ['Paper 12'], null);
  mk('p12pre', ['Preamble'], 'p12');
  mk('p12pre1', [code('P')], 'p12pre');
  const emptyHeading = mk('p12h', [''], 'p12', heading);
  mk('p12hchild', ['orphaned prose'], emptyHeading._id);
  mk('p12end', ['End'], 'p12');
  mk('p12end1', [code('E')], 'p12end');
  captured.latex = '';
  captured.log = '';
  const res12 = await runRem2TexConversion(plugin, { parentRem: p12 });
  t.check('empty-titled heading: no \\section, not counted, warned',
    res12.status === 'success' && !captured.latex.includes('\\section') && /Headings: 0/.test(captured.log) && /Heading rem with no title/.test(captured.log) && captured.latex.includes('orphaned prose'),
    JSON.stringify(res12) + '\n' + captured.latex + '\n' + captured.log);

  return t.failures();
}
