import { runRem2TexConversion, runParagraphToTexConversion, getRemTitle } from '../src/lib/rem2tex';
import { createFakeKb, code, suite } from './fake-kb';

/** Follow-ups to the bare-string escaping fix: boundary blocks, plain-text media, artefact tolerance, item titles. */
export async function run(): Promise<number> {
  const t = suite('regressions after the bare-string fix');
  const { mk, plugin, captured } = createFakeKb();

  // (a) mixed boundary: plain-text \documentclass next to a real code block → code wins, plain line
  //     surfaced as a % REM2TEX comment and a warning; Size bookkeeping child skipped
  const paper = mk('paper', ['Paper'], null);
  const pre = mk('pre', ['Preamble'], 'paper');
  mk('pre1', ['\\documentclass{article}'], 'pre');
  mk('pre2', [code('\\usepackage{amsmath}\n\\begin{document}')], 'pre');
  mk('preSize', ['Size'], 'pre', { isPowerupProperty: async () => true });
  mk('body', ['Hello & welcome'], 'paper');
  const end = mk('end', ['End'], 'paper');
  mk('end1', [code('\\end{document}')], 'end');
  const resA = await runRem2TexConversion(plugin, { parentRem: paper });
  t.check('(a) success with 1 warning about the dropped plain line', resA.status === 'success' && resA.warningCount === 1 && /Plain-text rem under Preamble/.test(captured.log), JSON.stringify(resA) + '\n' + captured.log);
  t.equal('(a) mixed boundary keeps code and surfaces the plain line as a % REM2TEX comment', captured.latex,
    ['\\usepackage{amsmath}', '\\begin{document}', '% REM2TEX: plain-text rem under Preamble not exported (code blocks take precedence): \\documentclass{article}', '', 'Hello \\& welcome', '', '\\end{document}'].join('\n'));

  // (b) image rem whose figure child is plain text → figure emitted, no warning box
  // (c) code block with a stray bare-string 'latex' artefact line stays a code block (not escaped)
  const para = mk('para', ['P'], null);
  mk('img', [{ i: 'i', url: 'x.png' }], 'para');
  mk('img1', ['\\begin{figure}\\includegraphics{x}\\end{figure}'], 'img');
  mk('cb', [code('\\newcommand{\\R}{\\mathbb{R}} % reals'), '\nlatex'], 'para');
  await runParagraphToTexConversion(plugin, { paragraphRem: para });
  t.equal('(b)+(c) plain-text figure child accepted; stray latex artefact does not flip a code block into prose', captured.latex,
    ['P', '', '\\begin{figure}\\includegraphics{x}\\end{figure}', '', '\\newcommand{\\R}{\\mathbb{R}} % reals'].join('\n'));

  // (d) Zotero item whose title is only a pin → key from the pinned rem's text, not rem_<id>
  mk('z', ['Zotero'], null);
  mk('items', ['Items'], 'z');
  mk('concept', ['bandgap2019'], null);
  mk('itemPinTitle', [{ i: 'q', _id: 'concept', pin: true }], 'items');
  const title = await getRemTitle(plugin, { text: ['see ', { i: 'q', _id: 'itemPinTitle', pin: true }] } as any, { hierarchyRemIds: new Set(['para']) } as any);
  t.equal('(d) item title that is only a pin resolves to the pinned text as key', title, 'see \\cite{bandgap2019}');

  void pre;
  return t.failures();
}
