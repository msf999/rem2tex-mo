import {
  getRemTitle,
  richTextToString,
  unwrapNestedCitationCommands,
  runRem2TexConversion,
  runParagraphToTexConversion,
  isRem2TexConversionError,
} from '../src/lib/rem2tex';
import { createFakeKb, code, pin, ref, suite } from './fake-kb';

/** Pins, inline references, Zotero citations, nested-citation unwrapping, typed structural errors. */
export async function run(): Promise<number> {
  const t = suite('pins & citations');
  const { rems, mk, plugin } = createFakeKb();

  mk('z', ['Zotero'], null, { isDocument: async () => true });
  mk('items', ['Items'], 'z', { isDocument: async () => true });
  mk('paper1', ['keFirstPrinciplesStudiesElectronic2024'], 'items', { isDocument: async () => true });
  mk('note1', ['a note under the item'], 'paper1');
  mk('handAdded', ['smith2020'], 'items', { isDocument: async () => true }); // added by hand, no powerup
  mk('other', ['Other'], null, { isDocument: async () => true });
  mk('otherItems', ['Items'], 'other', { isDocument: async () => true });
  mk('fake', ['notACitation'], 'otherItems', { isDocument: async () => true });
  mk('root', ['Paper'], null, { isDocument: async () => true });
  mk('fig1', [code('\\begin{figure}\\label{fig:setup}\\end{figure}')], 'root');
  mk('todo1', ['fix the caption'], 'root', { isTodo: async () => true, getTodoStatus: async () => 'Unfinished' });
  mk('concept', ['band gap'], null, { isDocument: async () => true });
  mk('statusSlot', ['Status'], null, { isPowerupSlot: async () => true });

  const ctx = { hierarchyRemIds: new Set(['root', 'fig1', 'todo1']) }; // paper1 is OUTSIDE the hierarchy
  const prose = (text: any[]) => getRemTitle(plugin, { text } as any, ctx as any);
  const comment = (text: any[]) =>
    richTextToString(plugin, text, { hierarchyRemIds: ctx.hierarchyRemIds, todoContentResolvePinsAsText: true } as any);

  const cases: Array<[string, () => Promise<string>, string]> = [
    ["mo's sentence: \\cite{ + pin to Zotero item + }", () => prose(['… \\ce{ZnTiN2} [elaborate]\\cite{', pin('paper1'), '}.']), '… \\ce{ZnTiN2} [elaborate]\\cite{keFirstPrinciplesStudiesElectronic2024}.'],
    ['bare pin to Zotero item → \\cite', () => prose(['see ', pin('paper1'), '.']), 'see \\cite{keFirstPrinciplesStudiesElectronic2024}.'],
    ['inline reference to Zotero item → \\cite too', () => prose(['see ', ref('paper1'), '.']), 'see \\cite{keFirstPrinciplesStudiesElectronic2024}.'],
    ['pin to a note nested under the item → cites the item', () => prose(['see ', pin('note1'), '.']), 'see \\cite{keFirstPrinciplesStudiesElectronic2024}.'],
    ['hand-added item (no powerup) under Zotero/Items → \\cite', () => prose(['see ', pin('handAdded'), '.']), 'see \\cite{smith2020}.'],
    ['two Zotero pins inside one \\cite{} → one key list', () => prose(['\\cite{', pin('paper1'), pin('handAdded'), '}']), '\\cite{keFirstPrinciplesStudiesElectronic2024, smith2020}'],
    ['"Items" that is not under "Zotero" → pin dropped', () => prose(['see ', pin('fake'), '.']), 'see .'],
    ['pin to the Items doc itself → dropped', () => prose(['see ', pin('items'), '.']), 'see .'],
    ['pin to a local todo → dropped from prose', () => prose(['Defects matter', pin('todo1'), '.']), 'Defects matter.'],
    ['pin to a local figure → dropped from prose', () => prose(['as shown ', pin('fig1'), ' below']), 'as shown  below'],
    ['\\ref{ + pin to figure + } → pin dropped, label must be typed', () => prose(['Fig. \\ref{', pin('fig1'), '}']), 'Fig. \\ref{}'],
    ['pin to an unrelated note → dropped', () => prose(['see ', pin('concept'), '.']), 'see .'],
    ['inline reference to an unrelated note → its text', () => prose(['the ', ref('concept'), ' matters']), 'the band gap matters'],
    ['pin to a bookkeeping (Status slot) rem → dropped', () => prose(['x', pin('statusSlot')]), 'x'],
    ['todo comment: pin to local todo → its text', () => comment(['fix ', pin('todo1')]), 'fix fix the caption'],
    ['todo comment: pin to figure → its text (code text)', () => comment(['caption of ', pin('fig1')]), 'caption of \\begin{figure}\\label{fig:setup}\\end{figure}'],
    ['todo comment: Zotero pin still cites', () => comment(['read ', pin('paper1')]), 'read \\cite{keFirstPrinciplesStudiesElectronic2024}'],
    ['todo comment: Status slot ref dropped', () => comment(['Judy: add more', ref('statusSlot')]), 'Judy: add more'],
    ['typed \\cite{abc} untouched', () => prose(['x \\cite{abc} y']), 'x \\cite{abc} y'],
  ];
  for (const [name, fn, expected] of cases) t.equal(name, await fn(), expected);

  const pure: Array<[string, string]> = [
    ['\\cite{\\cite{a}}', '\\cite{a}'],
    ['\\cite{\\cite{a, b}}', '\\cite{a, b}'],
    ['\\cite{\\cite{a}, \\cite{b}}', '\\cite{a, b}'],
    ['\\cite{\\cite{a}\\cite{a}}', '\\cite{a}'],
    ['\\textbf{\\cite{a}}', '\\textbf{\\cite{a}}'],
    ['\\\\cite{\\cite{a}}', '\\\\cite{\\cite{a}}'],
    ['\\cite{unterminated \\cite{a}', '\\cite{unterminated \\cite{a}'],
    ['\\eqref{\\ref{eq:1}}', '\\eqref{eq:1}'],
    ['\\citep*[p. 3]{\\cite{a}}', '\\citep*[p. 3]{a}'],
    ['no citations here', 'no citations here'],
  ];
  for (const [input, expected] of pure) t.equal(`unwrap(${JSON.stringify(input)})`, unwrapNestedCitationCommands(input), expected);

  // Structural errors (phase A) throw NOT_A_PAPER; an empty boundary block (phase B) is a failed result.
  const expectCode = async (name: string, fn: () => Promise<unknown>, codeExpected: string, extra?: (e: any) => boolean) => {
    try {
      await fn();
      t.check(name, false, 'no throw');
    } catch (e: any) {
      t.check(name, isRem2TexConversionError(e) && e.code === codeExpected && (!extra || extra(e)), `got ${isRem2TexConversionError(e) ? `${e.code}: ${e.whatHappened}` : e?.message}`);
    }
  };
  const paperA = mk('pA', ['Paper A'], null); mk('pA1', ['Preamble'], 'pA');
  const paperB = mk('pB', ['Paper B'], null); mk('pB1', ['Intro'], 'pB'); mk('pB2', ['End'], 'pB');
  const paperC = mk('pC', ['Paper C'], null); mk('pC1', ['Preamble'], 'pC'); mk('pC2', ['Intro'], 'pC');
  const paperD = mk('pD', ['Paper D'], null); mk('pD1', ['Preamble'], 'pD'); mk('pD1a', ['Size'], 'pD1'); mk('pDbody', ['body'], 'pD'); mk('pD2', ['End'], 'pD');
  const paperE = mk('pE', ['Paper E'], null); mk('pE1', ['Preamble'], 'pE'); mk('pE2', ['End'], 'pE'); // adjacent: nothing between
  await expectCode('structure: only a Preamble child → NOT_A_PAPER', () => runRem2TexConversion(plugin, { parentRem: paperA }), 'NOT_A_PAPER', (e) => /no child titled "End"/.test(e.whatHappened));
  await expectCode('structure: no Preamble child at all → NOT_A_PAPER', () => runRem2TexConversion(plugin, { parentRem: paperB }), 'NOT_A_PAPER', (e) => /no child titled "Preamble"/.test(e.whatHappened));
  await expectCode('structure: no End → NOT_A_PAPER', () => runRem2TexConversion(plugin, { parentRem: paperC }), 'NOT_A_PAPER');
  await expectCode('structure: Preamble and End adjacent → NOT_A_PAPER', () => runRem2TexConversion(plugin, { parentRem: paperE }), 'NOT_A_PAPER', (e) => /nothing between/.test(e.whatHappened));
  {
    const res = await runRem2TexConversion(plugin, { parentRem: paperD });
    t.check('structure: empty Preamble → result failed, EMPTY_BOUNDARY_BLOCK, export rem written', res.status === 'failed' && res.errorCode === 'EMPTY_BOUNDARY_BLOCK' && /^Rem2Tex \d\d:\d\d/.test(res.outputTitle), JSON.stringify(res));
  }

  // Unexpected error wrapped with source-rem context (paragraph export path), then a happy path.
  const para = mk('para', ['Results'], null, { getFontSize: async () => 'H1' });
  mk('para1', ['fine paragraph'], 'para');
  mk('para2', ['broken rem'], 'para', { getFontSize: async () => { throw new Error('SDK exploded'); } });
  await expectCode('unexpected error → REM_CONVERSION_FAILED with source rem + section', () => runParagraphToTexConversion(plugin, { paragraphRem: para }), 'REM_CONVERSION_FAILED',
    (e) => e.sourceRemTitle === 'broken rem' && e.location?.section === 'Results' && /SDK exploded/.test(e.whatHappened) && Array.isArray(e.sourceRemHierarchy));
  delete rems['para2'];
  const title = await runParagraphToTexConversion(plugin, { paragraphRem: para });
  t.check(`paragraph export returns a timestamped title (${title})`, /^Rem2Tex paragraph \d\d:\d\d [AP]M \d\d-\d\d-\d{4}$/.test(title));

  return t.failures();
}
