import { runParagraphToTexConversion } from '../src/lib/rem2tex';
import { createFakeKb, code, pin, todo, suite } from './fake-kb';

/**
 * `%` comment rems, todo comment trees and escaping, end to end through the paragraph export of a
 * plain (non-heading) root. Outline under test:
 *
 *   root
 *   ├─ Intro prose with 5% & more            → escaped paragraph
 *   ├─ % reviewer 2: tighten this & that      → comment, verbatim
 *   │  ├─ sub-note child                      → " %  - sub-note child"
 *   │  └─ todo child (unfinished)             → " % TODO [ ] …"
 *   ├─ % see [pin→smith2020] for context      → "% see \cite{smith2020} for context"
 *   ├─ todo with a % child                    → "% TODO [ ] …" then " % nested comment"
 *   ├─ code block starting with %             → raw code, NOT a comment; its child is normal prose
 *   │  └─ child prose
 *   ├─ % multi-line first\nsecond line        → two % lines
 *   └─ closing prose
 */
export async function run(): Promise<number> {
  const t = suite('% comment rems & todo trees');
  const { mk, plugin, captured } = createFakeKb();

  mk('z', ['Zotero'], null);
  mk('items', ['Items'], 'z');
  mk('paper1', ['smith2020'], 'items');
  const root = mk('root', ['Root'], null);
  mk('p1', ['Intro prose with 5% & more'], 'root');
  mk('c1', ['% reviewer 2: tighten this & that'], 'root');
  mk('c1a', ['sub-note child'], 'c1');
  mk('c1b', ['fix wording'], 'c1', todo);
  mk('c2', ['% see ', pin('paper1'), ' for context'], 'root');
  mk('t1', ['todo with a % child'], 'root', todo);
  mk('t1a', ['% nested comment'], 't1');
  mk('k1', [{ i: 'm', text: '% not a comment, a code block\n\\begin{table}\\end{table}', code: true, language: 'latex' }], 'root');
  mk('k1a', ['child prose'], 'k1');
  mk('c3', ['% multi-line first\nsecond line'], 'root');
  mk('p2', ['closing prose'], 'root');

  // Children of a prose rem keep outline order (todos are not hoisted since item 8 of the
  // 2026-09-03 batch); comment lines sit tight under their neighbours while any other child starts a
  // new paragraph; depth-1 tree lines get one leading space; a % rem inside a todo tree is its own
  // comment line.
  const expected = [
    'Root',
    '',
    'Intro prose with 5\\% \\& more',
    '',
    '% reviewer 2: tighten this & that',
    ' %  - sub-note child',
    ' % TODO [ ] fix wording',
    '% see \\cite{smith2020} for context',
    '% TODO [ ] todo with a % child',
    ' % nested comment',
    '',
    '% not a comment, a code block',
    '\\begin{table}\\end{table}',
    '',
    'child prose',
    '',
    '% multi-line first',
    '% second line',
    '',
    'closing prose',
  ].join('\n');

  await runParagraphToTexConversion(plugin, { paragraphRem: root });
  t.equal('comment rems end-to-end', captured.latex, expected);

  // Every physical line of a todo comment must start with `%`: a lone newline in the todo text —
  // a soft break, or a pin to a multi-line code block resolved as text — used to leak its
  // continuation lines into the document as real LaTeX (review finding, 2026-09-04).
  const kb2 = createFakeKb();
  const root2 = kb2.mk('root2', ['P'], null);
  kb2.mk('fig', [code('\\begin{figure}\n\\centering\n\\includegraphics{x}\n\\end{figure}')], 'root2');
  kb2.mk('t-multi', ['fix this\nand that'], 'root2', todo);
  kb2.mk('t-pin', ['caption of ', pin('fig')], 'root2', todo);
  kb2.mk('t-outer', ['outer'], 'root2', todo);
  kb2.mk('t-inner', ['nested\nsecond line'], 't-outer', todo);
  await runParagraphToTexConversion(kb2.plugin, { paragraphRem: root2 });
  t.equal(
    'multi-line todo text and a pin to a multi-line code block stay fully commented (top level and nested)',
    kb2.captured.latex,
    [
      'P',
      '',
      '\\begin{figure}',
      '\\centering',
      '\\includegraphics{x}',
      '\\end{figure}',
      '',
      '% TODO [ ] fix this',
      '% and that',
      '% TODO [ ] caption of \\begin{figure}',
      '% \\centering',
      '% \\includegraphics{x}',
      '% \\end{figure}',
      '% TODO [ ] outer',
      ' % TODO [ ] nested',
      ' % second line',
    ].join('\n')
  );
  t.check(
    'no line of the export is uncommented LaTeX carried over from a todo',
    kb2.captured.latex.split('\n').filter((l, i) => i > 6 && l.trim() && !l.trim().startsWith('%')).length === 0,
    kb2.captured.latex
  );
  return t.failures();
}
