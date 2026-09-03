import { runRem2TexConversion, toggleIgnoreTag, findIgnoreTagRem, REM2TEX_IGNORE_TAG } from '../src/lib/rem2tex';
import { createFakeKb, code, todo, heading, suite } from './fake-kb';

/** The `Rem2Tex-ignore` tag: skipping with subtrees everywhere, the log listing, the toggle command's helper. */
export async function run(): Promise<number> {
  const t = suite('Rem2Tex-ignore tag');
  const { rems, mk, plugin, captured } = createFakeKb();

  mk('tag', [REM2TEX_IGNORE_TAG], null); // existing tag rem
  const paper = mk('paper', ['Paper'], null);
  const pre = mk('pre', ['Preamble'], 'paper');
  mk('pre1', [code('\\documentclass{article}')], 'pre');
  const preNote = mk('pre2', ['% private preamble note'], 'pre');
  preNote.tags.push('tag');
  const sec1 = mk('sec1', ['Kept section'], 'paper', heading);
  mk('sec1a', ['kept prose'], 'sec1');
  const sec2 = mk('sec2', ['Draft section'], 'paper', heading);
  sec2.tags.push('tag');
  mk('sec2a', ['draft prose'], 'sec2');
  mk('sec3', ['Mixed section'], 'paper', heading);
  const p1 = mk('p1', ['visible paragraph'], 'sec3');
  const p2 = mk('p2', ['hidden paragraph'], 'sec3');
  p2.tags.push('tag');
  mk('p2a', ['hidden child'], 'p2');
  const t1 = mk('t1', ['hidden todo'], 'sec3', todo);
  t1.tags.push('tag');
  mk('t2', ['kept todo'], 'sec3', todo);
  const t2a = mk('t2a', ['hidden tree child'], 't2');
  t2a.tags.push('tag');
  mk('t2b', ['kept tree child'], 't2');
  const c1 = mk('c1', ['% hidden comment'], 'sec3');
  c1.tags.push('tag');
  const end = mk('end', ['End'], 'paper');
  mk('end1', [code('\\end{document}')], 'end');

  const res = await runRem2TexConversion(plugin, { parentRem: paper });
  // Under a heading, children keep outline order.
  const expected = ['\\documentclass{article}', '', '\\section{Kept section}', '', 'kept prose', '', '\\section{Mixed section}', '', 'visible paragraph', '', '% TODO [ ] kept todo', ' %  - kept tree child', '', '\\end{document}'].join('\n');
  t.equal('tagged section / paragraph / todo (mode all) / comment / tree child / preamble note all skipped with subtrees', captured.latex, expected);
  const names = ['"% private preamble note"', '"Draft section"', '"hidden paragraph"', '"hidden todo"', '"hidden tree child"', '"% hidden comment"'];
  t.check('log lists every skipped rem', res.status === 'success' && /Skipped by Rem2Tex-ignore \(6\)/.test(captured.log) && names.every((n) => captured.log.includes(n)) && /Rems skipped by the Rem2Tex-ignore tag \(with their subtrees\): 6/.test(captured.log), captured.log);

  // toggle: no tag rem in a fresh KB → created once; add; then remove
  delete rems['tag'];
  for (const r of Object.values(rems) as any[]) r.tags = [];
  t.check('no tag rem yet', (await findIgnoreTagRem(plugin)) === undefined);
  const r1 = await toggleIgnoreTag(plugin, p1);
  const tagRem: any = await findIgnoreTagRem(plugin);
  t.check('toggle on an untagged rem creates the tag rem and adds it', r1 === 'added' && !!tagRem && tagRem.text[0] === REM2TEX_IGNORE_TAG && p1.tags.includes(tagRem._id), JSON.stringify({ r1, tags: p1.tags }));
  const r2 = await toggleIgnoreTag(plugin, sec1);
  const tagRem2: any = await findIgnoreTagRem(plugin);
  t.check('second toggle reuses the existing tag rem', r2 === 'added' && tagRem2._id === tagRem._id && sec1.tags.includes(tagRem._id));
  const r3 = await toggleIgnoreTag(plugin, p1);
  t.check('toggle on a tagged rem removes the tag', r3 === 'removed' && !p1.tags.includes(tagRem._id));

  // case-insensitive match
  mk('oddtag', ['rem2tex-IGNORE'], null);
  const p3 = mk('p3', ['case test'], 'sec3');
  p3.tags.push('oddtag');
  captured.latex = '';
  await runRem2TexConversion(plugin, { parentRem: paper });
  t.check('tag title matched case-insensitively', !captured.latex.includes('case test') && captured.latex.includes('visible paragraph'), captured.latex);

  return t.failures();
}
