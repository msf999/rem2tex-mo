import {
  dropCitationsCoveredByAdjacentCommand,
  getRemTitle,
  rewriteRichTextWithCitekeys,
} from '../src/lib/rem2tex';
import { code, createFakeKb, pin, ref, suite } from './fake-kb';

/**
 * The pin-to-citekey rewrite writes `\cite{key}` into the rem and KEEPS the pin, so the pin's own
 * generated citation has to stop counting. These are the exporter-side guarantees that makes true.
 */
export async function run(): Promise<number> {
  const t = suite('citekeys written beside a kept pin');

  // ------------------------------------------------- the pure drop pass
  const drop = dropCitationsCoveredByAdjacentCommand;
  const pairs: Array<[string, string, string]> = [
    ['a wrapper swallows the pin it already names', '\\supercite{smith2020}\\cite{smith2020}', '\\supercite{smith2020}'],
    ['and so does \\citeauthor, whose printed word must survive', 'As \\citeauthor{smith2020}\\cite{smith2020} showed.', 'As \\citeauthor{smith2020} showed.'],
    ['\\nocite stays invisible instead of becoming a visible citation', '\\nocite{a}\\cite{a}', '\\nocite{a}'],
    ['the pin may come FIRST (a hand-written <pin>\\supercite{k})', '\\cite{smith2020}\\supercite{smith2020}', '\\supercite{smith2020}'],
    ['options on the wrapper do not block it', '\\supercite[p. 3]{smith2020}\\cite{smith2020}', '\\supercite[p. 3]{smith2020}'],
    ['a merged key list covers both pins, across whitespace', '\\cite{a, b}\\cite{a} \\cite{b}', '\\cite{a, b}'],
    ['and covers them when written separately', '\\supercite{a, b}\\cite{a}\\cite{b}', '\\supercite{a, b}'],
    ['a DIFFERENT key is never dropped', '\\supercite{smith2020}\\cite{jones2019}', '\\supercite{smith2020}\\cite{jones2019}'],
    ['two distinct generated citations are left for the merge', '\\cite{a}\\cite{b}', '\\cite{a}\\cite{b}'],
    ['Bug 1 input is invisible to it (argument is not a plain key list)', '\\cite{\\cite{k}}', '\\cite{\\cite{k}}'],
    ['real words between them block it', '\\supercite{k} text \\cite{k}', '\\supercite{k} text \\cite{k}'],
    ['an empty argument covers nothing', '\\cite{}\\cite{a}', '\\cite{}\\cite{a}'],
    ['a non-citation command covers nothing', '\\textbf{x}\\cite{a}', '\\textbf{x}\\cite{a}'],
    ['an escaped percent is not mistaken for a command', '100\\% \\cite{a}', '100\\% \\cite{a}'],
    ['text with no citations is returned untouched', 'no citations here', 'no citations here'],
  ];
  pairs.push(
    // A soft line break between the typed key and the pin: `/^\s*$/` treats a newline as blank, so
    // the gap is still swallowed — but the line structure around it must survive.
    ['a newline between a wrapper and the citation it covers', '\\supercite{k}\n\\cite{k}', '\\supercite{k}'],
    ['a newline does not let a DIFFERENT key be dropped', '\\supercite{k}\n\\cite{other}', '\\supercite{k}\n\\cite{other}'],
    ['a blank line between them still covers', '\\supercite{k}\n\n\\cite{k}', '\\supercite{k}']
  );
  for (const [name, input, expected] of pairs) {
    t.equal(name, drop(input), expected);
    t.equal(`  ...and re-running it changes nothing (${name.slice(0, 28)}…)`, drop(drop(input)), expected);
  }

  // ------------------------------------------------- through the real export path
  const { mk, plugin } = createFakeKb();
  mk('z', ['Zotero'], null);
  mk('items', ['Items'], 'z');
  mk('A', ['smith2020'], 'items');
  mk('B', ['jones2019'], 'items');
  mk('body', ['Body'], null);
  const ctx = { hierarchyRemIds: new Set(['body']) } as any;
  const prose = (text: any[]) => getRemTitle(plugin, { text } as any, ctx as any);

  t.equal(
    'a written citekey followed by its kept pin exports once',
    await prose(['See \\cite{smith2020}', pin('A'), '.']),
    'See \\cite{smith2020}.'
  );
  t.equal(
    'the same for a \\supercite wrapper — the case that used to double',
    await prose(['text\\supercite{smith2020}', pin('A'), '.']),
    'text\\supercite{smith2020}.'
  );
  t.equal(
    'a combined key list with both pins kept exports once',
    await prose(['See \\cite{smith2020, jones2019}', pin('A'), pin('B'), '.']),
    'See \\cite{smith2020, jones2019}.'
  );
  t.equal(
    'a kept pin for a work the text does NOT name still cites it',
    await prose(['See \\cite{smith2020}', pin('B'), '.']),
    'See \\cite{smith2020, jones2019}.'
  );
  t.equal(
    'the un-rewritten form still exports exactly as before',
    await prose(['See ', pin('A'), ' and ', pin('B'), '.']),
    'See \\cite{smith2020} and \\cite{jones2019}.'
  );
  t.equal(
    "Bug 1's sentence is unchanged by the new pass",
    await prose(['… [elaborate]\\cite{', pin('A'), '}.']),
    '… [elaborate]\\cite{smith2020}.'
  );

  // ------------------------------------------------- the pure rewrite
  // The citekey is written as a REFERENCE to the item doc (which renders as the citekey and stays
  // clickable), matching how the author already cites by hand: `\cite{` + ref + `}`.
  const TARGET: Record<string, { itemDocId: string; key: string }> = {
    A: { itemDocId: 'A', key: 'smith2020' },
    B: { itemDocId: 'B', key: 'jones2019' },
    passage: { itemDocId: 'A', key: 'smith2020' }, // a highlight inside smith2020
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

  const rewrites: Array<[string, any[], string]> = [
    ['a bare pin moves inside a new command, beside its key', ['See ', pin('A'), '.'], 'See \\cite{{ref:A}<pin:A>}.'],
    ['each pin sits beside its OWN key', ['See ', pin('A'), pin('B'), '.'], 'See \\cite{{ref:A}<pin:A>, {ref:B}<pin:B>}.'],
    ['pins separated only by a space group too', ['See ', pin('A'), ' ', pin('B'), '.'], 'See \\cite{{ref:A}<pin:A>, {ref:B}<pin:B>}.'],
    ['a word between them keeps them separate', ['See ', pin('A'), ' and ', pin('B'), '.'], 'See \\cite{{ref:A}<pin:A>} and \\cite{{ref:B}<pin:B>}.'],
    ['an existing \\supercite wrapper is kept, pin stays put', ['t\\supercite{', pin('A'), '}.'], 't\\supercite{{ref:A}<pin:A>}.'],
    ['two pins inside one command are comma-separated', ['\\cite{', pin('A'), pin('B'), '}'], '\\cite{{ref:A}<pin:A>, {ref:B}<pin:B>}'],
    ['a separator you already typed is not doubled', ['\\cite{', pin('A'), ', ', pin('B'), '}'], '\\cite{{ref:A}<pin:A>, {ref:B}<pin:B>}'],
    ['the SAME paper twice: one key, both pins', ['Twice ', pin('A'), pin('A'), '.'], 'Twice \\cite{{ref:A}<pin:A><pin:A>}.'],
    ['...even with a space between them', ['Twice ', pin('A'), ' ', pin('A'), '.'], 'Twice \\cite{{ref:A}<pin:A><pin:A>}.'],
    ['...and two passages of the same paper', ['Both ', pin('passage'), pin('A'), '.'], 'Both \\cite{{ref:A}<pin:passage><pin:A>}.'],
    ['interleaved A B A groups by paper', ['Mix ', pin('A'), pin('B'), pin('A'), '.'], 'Mix \\cite{{ref:A}<pin:A><pin:A>, {ref:B}<pin:B>}.'],
    ['a free pin joins the key already named', ['\\cite{', ref('A'), pin('A'), '}', pin('A')], '\\cite{{ref:A}<pin:A><pin:A>}'],
    ['a typed key in the argument is preserved', ['\\cite{other2000', pin('A'), '}'], '\\cite{other2000, {ref:A}<pin:A>}'],
    ['a pin to a PASSAGE references the paper', ['See ', pin('passage'), '.'], 'See \\cite{{ref:A}<pin:passage>}.'],
    ['an already-converted rem is left alone', ['See \\cite{', ref('A'), pin('A'), '}.'], '(no change)'],
    ['a later pin joins the existing command', ['\\cite{', ref('A'), pin('A'), '}', pin('B')], '\\cite{{ref:A}<pin:A>, {ref:B}<pin:B>}'],
    ['an earlier pin keeps its place in the key list', ['See ', pin('B'), '\\cite{', ref('A'), pin('A'), '}'], 'See \\cite{{ref:B}<pin:B>, {ref:A}<pin:A>}'],
    ['a pin inside \\ref{} is never touched', ['Fig. \\ref{', pin('A'), '}'], '(no change)'],
    ['a non-plain argument is left alone', ['\\cite{\\textbf{x}', pin('A'), '}'], '(no change)'],
    ['a non-Zotero pin is never touched', ['See ', pin('ZZZ'), '.'], '(no change)'],
    ['a rem holding any code element is skipped', [code('\\cite{x}'), pin('A')], '(no change)'],
    ['a rem with no pins is skipped', ['Just prose \\cite{typed}.'], '(no change)'],
    ['an unbalanced brace (mid-edit) is left alone', ['\\cite{', pin('A')], '(no change)'],
  ];
  for (const [name, before, expected] of rewrites) {
    const after = rewriteRichTextWithCitekeys(before, targetFor);
    t.equal(name, show(after), expected);
    if (after) t.check(`  ...and re-running it is a no-op (${name.slice(0, 30)}…)`, rewriteRichTextWithCitekeys(after, targetFor) === undefined);
  }

  // Every pin survives, always — the pin is the only thing that returns to the exact passage.
  for (const [name, before] of rewrites.map(([n, b]) => [n, b] as [string, any[]])) {
    const after = rewriteRichTextWithCitekeys(before, targetFor);
    if (!after) continue;
    const count = (a: any[]) => a.filter((e: any) => e && e.i === 'q' && e.pin === true).length;
    t.check(`  ...and no pin is lost (${name.slice(0, 30)}…)`, count(after) === count(before));
  }

  // The invariant that protects the author's document: untouched elements are the SAME objects,
  // so formatting, maths, images, clozes and the pin's own optional fields cannot be lost.
  const boldRun = { i: 'm', text: 'bold bit', b: true };
  const mathRun = { i: 'x', text: 'E_g' };
  const spliced = rewriteRichTextWithCitekeys(['See ', boldRun, ' ', mathRun, ' ', pin('A'), '.'], targetFor)!;
  t.check('untouched elements are carried through BY REFERENCE', spliced.includes(boldRun) && spliced.includes(mathRun));

  // ------------------------------------------------- the whole point: output neutrality
  const neutral: Array<[string, any[]]> = [
    ['bare pin', ['See ', pin('A'), '.']],
    ['adjacent pins', ['See ', pin('A'), pin('B'), '.']],
    ['pins split by a space', ['See ', pin('A'), ' ', pin('B'), '.']],
    ['pins split by a word', ['See ', pin('A'), ' and ', pin('B'), '.']],
    ['\\supercite{ + pin + }', ['t\\supercite{', pin('A'), '}.']],
    ['\\citep{ + pin + }', ['t\\citep{', pin('A'), '}.']],
    ['\\nocite{ + pin + }', ['\\nocite{', pin('A'), '}']],
    ['\\citeauthor{ + pin + }', ['As \\citeauthor{', pin('A'), '} showed.']],
    ['two pins in one command', ['\\cite{', pin('A'), pin('B'), '}']],
    ['a pin inside \\textbf', ['\\textbf{x ', pin('A'), '}']],
    ['escaping around a pin', ['5% & more ', pin('A'), '.']],
    ['maths beside a pin', [{ i: 'x', text: 'E_g' }, ' ', pin('A'), '.']],
    ['a bold run beside a pin', [{ i: 'm', text: 'bold', b: true }, ' ', pin('A'), '.']],
  ];
  for (const [name, before] of neutral) {
    const after = rewriteRichTextWithCitekeys(before, targetFor);
    const texBefore = await prose(before);
    const texAfter = after ? await prose(after) : texBefore;
    t.equal(`output-neutral: ${name}`, texAfter, texBefore);
  }

  // ---------------------------------------- pins are MOVED, never rebuilt (identity, not just count)
  // The whole reason the splice carries elements by reference: a pin can hold optional fields
  // (`aliasId`, `content`, `showFullName`) that a rebuilt `{i:'q',_id,pin:true}` would silently drop.
  {
    const richPin = { i: 'q', _id: 'A', pin: true, aliasId: 'alias-1', showFullName: true };
    const shapes: Array<[string, unknown[]]> = [
      ['a free pin', ['Text ', richPin, '.']],
      ['a pin inside a typed command', ['\\cite{', richPin, '}']],
      ['a pin beside a typed key', ['\\cite{other2000, ', richPin, '}']],
      ['a pin on each side of a command', [richPin, '\\cite{a}', richPin]],
    ];
    for (const [name, before] of shapes) {
      const after = rewriteRichTextWithCitekeys(before, targetFor);
      const kept = (after ?? before).filter((e) => e === richPin).length;
      const expected = before.filter((e) => e === richPin).length;
      t.check(
        `the pin object itself survives, not a copy: ${name}`,
        kept === expected,
        `kept ${kept} of ${expected} by reference; after = ${JSON.stringify(after)}`
      );
      t.check(
        `  ...and no look-alike pin was fabricated: ${name}`,
        (after ?? before).filter((e: any) => e && e.i === 'q' && e.pin === true).length === expected,
        JSON.stringify(after)
      );
    }
  }

  // ---------------------------------------- the four neutrality bugs found by the 2026-10-08 audit
  // Each of these exported DIFFERENTLY after a rewrite until it was fixed. They are the cases the
  // original 13 output-neutral shapes missed, so they are pinned here by name.
  const auditCases: Array<[string, unknown[], string]> = [
    // Two commands' braces inside ONE text element: the splice used to be keyed by element index,
    // so the second insertion overwrote the first one's offset — fusing `a` onto `keyB`.
    ['a pin on each side of a typed command', [pin('A'), '\\cite{a}', pin('B')], '\\cite{smith2020, a, jones2019}'],
    // A prepend and an insert landing on the same point used to come out in the wrong order.
    ['a pin before AND inside one command', [pin('A'), '\\cite{', pin('B'), '}'], '\\cite{smith2020, jones2019}'],
    // Absorbing the pin would stretch `p. 3` over a work it was never written for.
    ['a free pin beside a postnote command', ['\\cite[p. 3]{other2000}', pin('A')], '\\cite[p. 3]{other2000}\\cite{smith2020}'],
    ['a free pin beside a prenote+postnote command', ['\\cite[see][p. 3]{other2000}', pin('A')], '\\cite[see][p. 3]{other2000}\\cite{smith2020}'],
    // ...but a pin the author put INSIDE such a command stays there: they chose that note.
    ['a pin inside a postnote command keeps the note', ['\\cite[p. 3]{', pin('A'), '}'], '\\cite[p. 3]{smith2020}'],
  ];
  for (const [name, before, expected] of auditCases) {
    const after = rewriteRichTextWithCitekeys(before, targetFor);
    t.equal(`audit case exports correctly: ${name}`, await prose(before), expected);
    t.equal(
      `  ...and still does after the rewrite: ${name}`,
      after ? await prose(after) : await prose(before),
      expected
    );
  }

  // The one deliberate exception: a typed key fused to a pin with no comma exports as a single
  // mangled key TODAY (`\cite{other2000smith2020}`). The rewrite separates them, which changes the
  // output — for the better. Pinned here so the difference stays intentional.
  const fused = ['\\cite{other2000', pin('A'), '}'];
  t.equal('today a comma-less typed key + pin fuses into one bad key', await prose(fused), '\\cite{other2000smith2020}');
  t.equal(
    'and the rewrite corrects it to two keys',
    await prose(rewriteRichTextWithCitekeys(fused, targetFor)!),
    '\\cite{other2000, smith2020}'
  );

  return t.failures();
}
