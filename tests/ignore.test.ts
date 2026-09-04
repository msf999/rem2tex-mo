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

  // Fast path (item 7): with no top-level tag rem, nothing is checked and everything exports.
  delete rems['tag'];
  for (const r of Object.values(rems) as any[]) r.tags = [];
  t.check('no tag rem yet', (await findIgnoreTagRem(plugin)) === undefined);
  captured.latex = '';
  captured.log = '';
  await runRem2TexConversion(plugin, { parentRem: paper });
  t.check('no tag rem → nothing skipped', captured.latex.includes('draft prose') && captured.latex.includes('hidden paragraph') && /Rems skipped by the Rem2Tex-ignore tag \(with their subtrees\): 0/.test(captured.log), captured.latex);

  // toggle: created once at top level; add; add again (reuse); remove — each state exported correctly
  const r1 = await toggleIgnoreTag(plugin, p1);
  const tagRem: any = await findIgnoreTagRem(plugin);
  t.check('toggle on an untagged rem creates the tag rem (top level) and adds it', r1 === 'added' && !!tagRem && tagRem.text[0] === REM2TEX_IGNORE_TAG && tagRem.parent === null && p1.tags.includes(tagRem._id), JSON.stringify({ r1, tags: p1.tags }));
  captured.latex = '';
  await runRem2TexConversion(plugin, { parentRem: paper });
  t.check('a rem tagged through the toggle is skipped (reverse lookup)', !captured.latex.includes('visible paragraph') && captured.latex.includes('draft prose'), captured.latex);
  const r2 = await toggleIgnoreTag(plugin, sec1);
  const tagRem2: any = await findIgnoreTagRem(plugin);
  t.check('second toggle reuses the existing tag rem', r2 === 'added' && tagRem2._id === tagRem._id && sec1.tags.includes(tagRem._id));
  const r3 = await toggleIgnoreTag(plugin, p1);
  t.check('toggle on a tagged rem removes the tag', r3 === 'removed' && !p1.tags.includes(tagRem._id));
  captured.latex = '';
  await runRem2TexConversion(plugin, { parentRem: paper });
  t.check('after removal the rem exports again; the still-tagged section stays hidden', captured.latex.includes('visible paragraph') && !captured.latex.includes('kept prose'), captured.latex);

  // Only the top-level tag rem counts: a same-named tag rem nested elsewhere is not honoured —
  // and the toggle command agrees with that, instead of "removing" the inert look-alike and
  // claiming the rem exports again (review finding, 2026-09-04).
  mk('nestedTag', [REM2TEX_IGNORE_TAG], 'sec3');
  const p3 = mk('p3', ['tagged with a nested tag rem'], 'sec3');
  p3.tags.push('nestedTag');
  captured.latex = '';
  await runRem2TexConversion(plugin, { parentRem: paper });
  t.check('a nested (non-top-level) tag rem is ignored by design', captured.latex.includes('tagged with a nested tag rem'), captured.latex);
  const r4 = await toggleIgnoreTag(plugin, p3);
  t.check('toggle on a rem carrying only a nested look-alike tag ADDS the canonical tag', r4 === 'added' && p3.tags.includes(tagRem._id) && p3.tags.includes('nestedTag'), JSON.stringify({ r4, tags: p3.tags }));
  captured.latex = '';
  await runRem2TexConversion(plugin, { parentRem: paper });
  t.check('and the rem is then actually hidden', !captured.latex.includes('tagged with a nested tag rem'), captured.latex);

  // An ignore-tagged figure/table child of an image rem is skipped and listed (review finding).
  const imgPaper = mk('ip', ['Image paper'], null);
  mk('ippre', ['Preamble'], 'ip');
  mk('ippre1', [code('P')], 'ippre');
  mk('ipimg', [{ i: 'i', url: 'x.png' }], 'ip');
  mk('ipfigA', [code('\\begin{figure}A\\end{figure}')], 'ipimg');
  const hiddenFig = mk('ipfigB', [code('\\begin{figure}B-old-version\\end{figure}')], 'ipimg');
  hiddenFig.tags.push(tagRem._id);
  mk('ipend', ['End'], 'ip');
  mk('ipend1', [code('E')], 'ipend');
  captured.latex = '';
  captured.log = '';
  const resImg = await runRem2TexConversion(plugin, { parentRem: imgPaper });
  t.equal('a tagged figure child of an image rem is not exported', captured.latex, 'P\n\n\\begin{figure}A\\end{figure}\n\nE');
  t.check('and it is listed in the Log as skipped by the tag', resImg.status === 'success' && /Skipped by Rem2Tex-ignore \(1\)/.test(captured.log) && captured.log.includes('figure/table blocks: 1'), captured.log);

  return t.failures();
}
