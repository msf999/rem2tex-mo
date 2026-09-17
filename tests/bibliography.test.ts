import {
  isRem2TexConversionError,
  renumberCitations,
  runSelectionToTexConversion,
} from '../src/lib/rem2tex';
import { createFakeKb, code, pin, ref, suite, todo, ZOTERO_ITEM_POWERUP } from './fake-kb';

/** Remzot writes Authors as one reference per author, separated by a literal single space. */
const authorsSlot = (...authorRemIds: string[]) =>
  authorRemIds.flatMap((id, i) => (i === 0 ? [ref(id)] : [' ', ref(id)]));

/** The Date slot is a nested reference PATH: ‹2008›-‹07›-‹31›. */
const dateSlot = (...partRemIds: string[]) =>
  partRemIds.flatMap((id, i) => (i === 0 ? [ref(id)] : ['-', ref(id)]));

/**
 * The numbered selection export: `[1]`-style citations, the biblatex-shaped bibliography built from
 * Remzot's item properties, missing-metadata reporting, and where the export rem is parented.
 */
let walkProps = 0;

export async function run(): Promise<number> {
  const t = suite('numbered citations & bibliography');

  // ---------------------------------------------------------------- pure renumbering
  const renumber = (s: string) => renumberCitations(s).latex;
  t.equal('single citation becomes [1]', renumber('See \\cite{a}.'), 'See [1].');
  t.equal(
    'numbers follow order of FIRST citation, and repeat',
    renumber('\\cite{b} then \\cite{a} then \\cite{b}.'),
    '[1] then [2] then [1].'
  );
  t.equal('a merged key list becomes one bracket', renumber('\\cite{a, b}'), '[1, 2]');
  t.equal(
    'every citation command family is renumbered',
    renumber('\\citep{a} \\textcite{b} \\parencite{a}'),
    '[1] [2] [1]'
  );
  t.equal(
    '\\supercite keeps its superscript',
    renumber('text\\supercite{a}.'),
    'text\\textsuperscript{[1]}.'
  );
  t.equal('a postnote rides inside the brackets', renumber('\\cite[p. 3]{a}'), '[1, p. 3]');
  t.equal('a prenote too', renumber('\\cite[see][p. 3]{a}'), '[see 1, p. 3]');
  t.equal('\\citenum prints the bare number', renumber('\\citenum{a}'), '1');
  t.equal('\\nocite prints nothing but still numbers', renumber('x\\nocite{a}y \\cite{a}'), 'xy [1]');
  t.equal(
    'a comment-only citation keeps its key and burns no number',
    renumber('% TODO read \\cite{z}\n\\cite{a}'),
    '% TODO read \\cite{z}\n[1]'
  );
  t.equal(
    'but a comment DOES show the number of a work the body cites',
    renumber('\\cite{a}\n% TODO reread \\cite{a}'),
    '[1]\n% TODO reread [1]'
  );
  t.equal(
    'order is body-first: the comment above a citation still follows it',
    renumber('% see \\cite{a}\nBody \\cite{a}.'),
    '% see [1]\nBody [1].'
  );
  t.equal(
    'a mixed command in a comment is left whole rather than half-numbered',
    renumber('\\cite{a}\n% \\cite{a, onlyHere}'),
    '[1]\n% \\cite{a, onlyHere}'
  );
  t.equal(
    'a trailing comment on a code line is left alone',
    renumber('\\cite{a} text % see \\cite{z}'),
    '[1] text % see \\cite{z}'
  );
  t.equal('an escaped \\%  does not start a comment', renumber('5\\% of \\cite{a}'), '5\\% of [1]');
  t.equal('an empty \\cite{} is left visible', renumber('\\cite{}'), '\\cite{}');
  t.equal('a duplicated key inside one command collapses', renumber('\\cite{a, a}'), '[1]');
  t.equal('non-citation commands are untouched', renumber('\\ref{fig:1} \\textbf{x}'), '\\ref{fig:1} \\textbf{x}');
  t.equal(
    '\\citeauthor / \\citeyear print words, so they are left as typed',
    renumber('As \\citeauthor{a} showed in \\citeyear{a}, \\cite{a} holds.'),
    'As \\citeauthor{a} showed in \\citeyear{a}, [1] holds.'
  );
  t.check(
    'but their key still earns a bibliography entry',
    JSON.stringify(renumberCitations('\\citeauthor{onlyHere}').keys) === JSON.stringify(['onlyHere'])
  );
  t.check(
    'every word-printing command registers its key, none of them silently ignored',
    ['citeauthor', 'citeyear', 'citeyearpar', 'citedate', 'citetitle', 'Citeauthor', 'Citeyear'].every(
      (command) => {
        const r = renumberCitations(`See \\${command}{k}.`);
        return r.keys.length === 1 && r.latex === `See \\${command}{k}.`;
      }
    )
  );
  t.check(
    'renumberCitations reports the keys in number order',
    JSON.stringify(renumberCitations('\\cite{b} \\cite{a}').keys) === JSON.stringify(['b', 'a'])
  );

  // ---------------------------------------------------------------- entry punctuation
  // These go through the real export, so the checks below stand in for the builder's edge cases.

  // ---------------------------------------------------------------- a knowledge base
  const { rems, mk, plugin, captured } = createFakeKb();

  mk('z', ['Zotero'], null);
  mk('items', ['Items'], 'z');
  mk('authors', ['Authors'], 'z');
  mk('dates', ['Dates'], 'z');
  mk('pubs', ['Publications'], 'z');

  // Remzot's lookup rems: authors are named "Last, First"; date parts are their own rems.
  mk('a-alk', ['Alkauskas, Audrius'], 'authors');
  mk('a-bro', ['Broqvist, Peter'], 'authors');
  mk('a-pas', ['Pasquarello, Alfredo'], 'authors');
  mk('a-arr', ['Arrigoni, Marco'], 'authors');
  mk('a-mad', ['Madsen, Georg K. H.'], 'authors');
  mk('a-azu', ['Azuhata, T.'], 'authors');
  mk('a-two', ['Second, A.'], 'authors');
  mk('a-three', ['Third, B.'], 'authors');
  mk('a-four', ['Fourth, C.'], 'authors');
  mk('y2008', ['2008'], 'dates');
  mk('m07', ['07'], 'dates');
  mk('y1995', ['1995'], 'dates');
  mk('m03', ['03'], 'dates');
  mk('y2021', ['2021'], 'dates');
  mk('p-prl', ['Physical Review Letters'], 'pubs');
  mk('p-jpcm', ['Journal of Physics: Condensed Matter'], 'pubs');

  // Three synced item docs and one hand-added, property-less one.
  const alkauskas = mk('alk2008', ['alkauskasDefectEnergy2008'], 'items');
  await alkauskas.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'title', [
    'Defect Energy Levels in Density Functional Calculations: Alignment and Band Gap Problem',
  ]);
  await alkauskas.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'authors', authorsSlot('a-alk', 'a-bro', 'a-pas'));
  await alkauskas.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'publication', [ref('p-prl')]);
  await alkauskas.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'year', dateSlot('y2008', 'm07'));
  await alkauskas.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'doi', ['10.1103/PhysRevLett.101.046405']);

  const arrigoni = mk('arr2021', ['arrigoniSpinney2021'], 'items');
  await arrigoni.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'title', ['Spinney: Post-Processing of Calculations']);
  await arrigoni.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'authors', authorsSlot('a-arr', 'a-mad'));
  await arrigoni.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'year', dateSlot('y2021'));

  const azuhata = mk('azu1995', ['azuhataPolarized1995'], 'items');
  await azuhata.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'title', ['Polarized Raman Spectra in GaN']);
  await azuhata.setPowerupProperty(
    ZOTERO_ITEM_POWERUP,
    'authors',
    authorsSlot('a-azu', 'a-two', 'a-three', 'a-four')
  );
  await azuhata.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'publication', [ref('p-jpcm')]);
  await azuhata.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'year', dateSlot('y1995', 'm03'));

  mk('bare2020', ['bareItem2020'], 'items'); // hand-added: under Items, but no properties at all

  // An item whose ONLY field is the DOI: the entry must not open with a stray separator.
  const doiOnly = mk('doi2015', ['doiOnly2015'], 'items');
  await doiOnly.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'doi', ['10.1000/only']);

  // No DOI but a Link(s): the entry falls back to the URL. Remzot's Link slot references a link rem
  // whose visible text is a PRETTIFIED address; the real one is in the built-in `b`/URL slot.
  const linkRem = mk('linkrem', ['example.org/paper a'], null);
  await linkRem.setPowerupProperty('b', 'URL', ['https://example.org/paper-a?x=1']);
  const linked = mk('link2016', ['linkedItem2016'], 'items');
  await linked.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'title', ['An Item With Only A Link']);
  await linked.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'authors', authorsSlot('a-arr'));
  await linked.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'link', [ref('linkrem')]);

  // A title that already ends a sentence must never take a second period (biblatex's \\isdot).
  const question = mk('q2019', ['questionTitle2019'], 'items');
  await question.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'title', ['Is X the New Y?']);
  await question.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'doi', ['10.1000/q']);
  const dotted = mk('d2018', ['dottedTitle2018'], 'items');
  await dotted.setPowerupProperty(ZOTERO_ITEM_POWERUP, 'title', ['A Study.']);


  // A doc whose metadata is ONLY reachable by the child walk — the state of a knowledge base with no
  // Remzot installed, where the powerup route throws. Its Type reference must not become the URL.
  mk('types', ['Types'], 'z');
  mk('t-book', ['Book'], 'types');
  mk('walkLink', ['walkRem.example/paper b'], null, {
    getPowerupProperty: async (code: string, slot: string) =>
      code === 'b' && slot === 'URL' ? 'https://walk.example/paper-b' : '',
  });
  const walked = mk('walk2014', ['walkOnly2014'], 'items', {
    // No `zotero-item` powerup at all: every getPowerupPropertyAsRichText read comes back empty.
    getPowerupPropertyAsRichText: async () => [],
  });
  const prop = (back: any[]) => {
    const r = mk(`prop${back.length}${Math.round(back.length)}${walkProps++}`, [], 'walk2014', {
      isPowerupProperty: async () => true,
    });
    r.backText = back;
    return r;
  };
  prop(['A Walked Title']);
  prop([ref('t-book')]);          // Type — must be ignored, not read as the URL
  prop(authorsSlot('a-arr'));     // Authors
  prop([ref('walkLink')]);        // Link(s)

  // ---------------------------------------------------------------- one rem, exported
  mk('doc', ['Section'], null);
  mk('p1', ['Prose citing ', pin('alk2008'), ' and ', pin('arr2021'), '.'], 'doc');
  mk('p2', ['Again ', pin('alk2008'), ', plus \\cite{bareItem2020} and \\cite{unknownKey2019}.'], 'doc');
  mk('p3', ['Four authors: ', pin('azu1995'), '.'], 'doc');
  mk('p4', ['DOI only: ', pin('doi2015'), '.'], 'doc');
  mk('p5', ['Question title ', pin('q2019'), ' and dotted ', pin('d2018'), '.'], 'doc');
  mk('p6', ['Hand-typed \\cite{smith_2020}.'], 'doc');
  mk('p7', ['Link only: ', pin('link2016'), '.'], 'doc');
  mk('p8', ['Child-walk only: ', pin('walk2014'), '.'], 'doc');
  mk('t1', ['read ', pin('alk2008')], 'doc', todo);

  const single = await runSelectionToTexConversion(plugin, { selectedRemIds: ['doc'] });
  const latex = captured.latex;

  t.check('one selected rem exports', single.remCount === 1, JSON.stringify(single));
  t.check('eleven distinct works cited', single.citationCount === 11, `got ${single.citationCount}`);
  t.check(
    'three of them have no usable metadata',
    single.missingMetadataCount === 3,
    `got ${single.missingMetadataCount}`
  );
  t.check(
    'the result names what was exported, so a stale selection is visible in the toast',
    JSON.stringify(single.exportedTitles) === JSON.stringify(['Section']),
    JSON.stringify(single.exportedTitles)
  );

  t.check(
    'body citations are numbered in first-appearance order',
    latex.includes('Prose citing [1] and [2].'),
    latex
  );
  t.check(
    'a repeated work keeps its number',
    latex.includes('Again [1], plus [3] and [4].'),
    latex
  );
  t.check('the four-author work is [5]', latex.includes('Four authors: [5].'), latex);
  t.check(
    'a % TODO citing a work the body also cites shows that work\'s number',
    latex.includes('% TODO [ ] read [1]'),
    latex
  );

  t.check(
    'entry 1 reproduces the biblatex numeric shape',
    latex.includes(
      '[1] Audrius Alkauskas, Peter Broqvist, and Alfredo Pasquarello. "Defect Energy Levels in ' +
        'Density Functional Calculations: Alignment and Band Gap Problem". In: Physical ' +
        'Review Letters (July 2008). doi: 10.1103/PhysRevLett.101.046405.'
    ),
    latex
  );
  t.check(
    'two authors join with "and"; a missing journal and DOI just drop out',
    latex.includes(
      '[2] Marco Arrigoni and Georg K. H. Madsen. "Spinney: Post-Processing of Calculations" (2021).'
    ),
    latex
  );
  t.check(
    'more than three authors truncate to "et al." with no doubled period',
    latex.includes(
      '[5] T. Azuhata et al. "Polarized Raman Spectra in GaN". In: Journal of Physics: ' +
        'Condensed Matter (Mar. 1995).'
    ),
    latex
  );
  t.check(
    'an item doc with empty properties says so',
    latex.includes('[3] bareItem2020. [Rem2Tex: no metadata — its Zotero properties are empty;'),
    latex
  );
  t.check(
    'a citekey with no item doc at all says so',
    latex.includes(
      '[4] unknownKey2019. [Rem2Tex: no metadata — no item titled "unknownKey2019" was found under Zotero/Items.]'
    ),
    latex
  );
  t.check(
    'an entry whose only field is the DOI opens with the DOI, not a separator',
    latex.includes('[6] doi: 10.1000/only.'),
    latex
  );
  t.check(
    'a title ending in "?" takes no extra period before the next field',
    latex.includes('"Is X the New Y?" doi: 10.1000/q.'),
    latex
  );
  t.check(
    'a title ending in "." is not doubled at the end of the entry',
    /\[\d+\] "A Study\."\n/.test(latex + '\n'),
    latex
  );
  t.check(
    'an underscore in a hand-typed key is escaped in BOTH halves of the note',
    latex.includes('smith\\_2020. [Rem2Tex: no metadata — no item titled "smith\\_2020"'),
    latex
  );
  t.check(
    'an item with no DOI but a link prints its real URL, not the link rem\'s prettified text',
    latex.includes('Marco Arrigoni. "An Item With Only A Link". url: https://example.org/paper-a?x=1.'),
    latex
  );
  t.check(
    'the child-walk route reads a doc with no powerup, and files Type as Type, not as the URL',
    latex.includes('Marco Arrigoni. "A Walked Title". url: https://walk.example/paper-b.'),
    latex
  );
  t.check('the bibliography is introduced by a comment heading', latex.includes('% ---------------- Bibliography ----------------'), latex);

  // The export rem hangs under the single selected rem, as its last child.
  const exportRem = Object.values(rems).find((r: any) => /^Rem2Tex selection /.test(r.text?.[0] ?? ''));
  t.check('single-rem export is a CHILD of the selected rem', exportRem?.parent === 'doc', String(exportRem?.parent));
  t.check('the export title is what the result reported', exportRem?.text?.[0] === single.outputTitle);

  // ---------------------------------------------------------------- several rems, exported
  const kb2 = createFakeKb();
  kb2.mk('z', ['Zotero'], null);
  kb2.mk('items', ['Items'], 'z');
  kb2.mk('parent', ['Parent'], null);
  kb2.mk('s1', ['First selected.'], 'parent');
  kb2.mk('s2', ['Second selected.'], 'parent');
  kb2.mk('s3', ['Not selected.'], 'parent');

  const multi = await runSelectionToTexConversion(kb2.plugin, { selectedRemIds: ['s2', 's1'] });
  t.check('two selected rems export', multi.remCount === 2, JSON.stringify(multi));
  t.equal(
    'siblings come out in OUTLINE order, not selection order',
    kb2.captured.latex,
    'First selected.\n\nSecond selected.'
  );
  const sister = Object.values(kb2.rems).find((r: any) => /^Rem2Tex selection /.test(r.text?.[0] ?? ''));
  t.check('multi-rem export is a SISTER of the selection', sister?.parent === 'parent', String(sister?.parent));

  // A rem nested inside another selected rem must not be serialized twice.
  const kb3 = createFakeKb();
  kb3.mk('z', ['Zotero'], null);
  kb3.mk('items', ['Items'], 'z');
  kb3.mk('outer', ['Outer.'], null);
  kb3.mk('inner', ['Inner.'], 'outer');
  const nested = await runSelectionToTexConversion(kb3.plugin, { selectedRemIds: ['outer', 'inner'] });
  t.check('a selected descendant is dropped, not exported twice', nested.remCount === 1, JSON.stringify(nested));
  t.equal('and its text appears exactly once', kb3.captured.latex, 'Outer.\n\nInner.');

  // ---------------------------------------------------------------- nothing to export
  const kb4 = createFakeKb();
  kb4.mk('empty', [], null);
  let code4 = '';
  try {
    await runSelectionToTexConversion(kb4.plugin, { selectedRemIds: ['empty'] });
  } catch (error) {
    code4 = isRem2TexConversionError(error) ? error.code : 'UNTYPED';
  }
  t.equal('an empty rem throws NOTHING_TO_EXPORT', code4, 'NOTHING_TO_EXPORT');

  // A code block keeps its citations renumbered too (it is real document content).
  const kb5 = createFakeKb();
  kb5.mk('z', ['Zotero'], null);
  kb5.mk('items', ['Items'], 'z');
  kb5.mk('k', ['keyOnly2020'], 'items');
  kb5.mk('fig', [code('\\begin{figure}\\caption{From \\cite{keyOnly2020}}\\end{figure}')], null);
  await runSelectionToTexConversion(kb5.plugin, { selectedRemIds: ['fig'] });
  t.check(
    'a citation inside a code block is numbered',
    kb5.captured.latex.includes('\\caption{From [1]}'),
    kb5.captured.latex
  );

  return t.failures();
}
