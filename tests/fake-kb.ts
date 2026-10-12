/**
 * A tiny in-memory stand-in for the RemNote SDK, enough to drive the exporter end to end:
 * rems with parents/children/tags, `plugin.rem.findOne/createRem/findByName`, and a
 * `plugin.richText.code` that records the last `latex` (Paper) and `text` (Log) blocks written.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type FakeRem = any;

export function createFakeKb() {
  const rems: Record<string, FakeRem> = {};
  const captured = { latex: '', log: '', created: 0 };

  function mk(id: string, text: any[], parent: string | null, extra: Record<string, any> = {}): FakeRem {
    const r: FakeRem = {
      _id: id,
      text,
      parent,
      backText: undefined,
      tags: [] as string[],
      /** `{ powerupCode: { slotCode: richText } }` — what Remzot writes onto a Zotero item doc. */
      props: {} as Record<string, Record<string, any[]>>,
      powerups: [] as string[],
      getChildrenRem: async () => Object.values(rems).filter((x: FakeRem) => x.parent === id),
      getDescendants: async () => {
        const out: FakeRem[] = [];
        const walk = (p: string) => {
          for (const x of Object.values(rems) as FakeRem[]) {
            if (x.parent === p) {
              out.push(x);
              walk(x._id);
            }
          }
        };
        walk(id);
        return out;
      },
      getParentRem: async () => (r.parent ? rems[r.parent] : undefined),
      isDocument: async () => false,
      isTodo: async () => false,
      getTodoStatus: async () => undefined,
      getFontSize: async () => undefined,
      hasPowerup: async (code: string) => r.powerups.includes(code),
      getPowerupProperty: async (code: string, slot: string) =>
        (r.props[code]?.[slot] ?? []).map((el: any) => (typeof el === 'string' ? el : el.text ?? '')).join(''),
      getPowerupPropertyAsRichText: async (code: string, slot: string) => r.props[code]?.[slot] ?? [],
      setPowerupProperty: async (code: string, slot: string, value: any[]) => {
        if (!r.powerups.includes(code)) r.powerups.push(code);
        r.props[code] = { ...(r.props[code] ?? {}), [slot]: value };
      },
      /** Records `collapse()` so a test can assert the Log is folded away. */
      collapsed: false,
      collapse: async () => { r.collapsed = true; },
      expand: async () => { r.collapsed = false; },
      isPowerupProperty: async () => false,
      isPowerupPropertyListItem: async () => false,
      isPowerupSlot: async () => false,
      isSlot: async () => false,
      setText: async (t: any[]) => {
        r.text = t;
      },
      setParent: async (p: any) => {
        r.parent = p === null || p === undefined ? null : typeof p === 'string' ? p : p._id;
      },
      getTagRems: async () => r.tags.map((t: string) => rems[t]),
      taggedRem: async () => Object.values(rems).filter((x: FakeRem) => x.tags.includes(id)),
      addTag: async (t: any) => {
        r.tags.push(typeof t === 'string' ? t : t._id);
      },
      removeTag: async (tagId: string) => {
        r.tags = r.tags.filter((t: string) => t !== tagId);
      },
      ...extra,
    };
    rems[id] = r;
    return r;
  }

  /** The rem the focus chain resolves to; set with `focus(rem)` before calling an entry point. */
  let focused: FakeRem | undefined;
  /** The rem open in the focused pane, for the `getOpenPaneRemId` fallback. */
  let openPane: FakeRem | undefined;
  const session = new Map<string, unknown>();

  const plugin: any = {
    // Enough of the focus chain for `getFocusedParentRem` to resolve a target.
    focus: { getFocusedRem: async () => focused },
    editor: { getSelectedRem: async () => undefined, getSelection: async () => undefined },
    window: {
      getFocusedPaneId: async () => (openPane ? 'pane-1' : undefined),
      getOpenPaneRemId: async () => openPane?._id,
    },
    // A REAL in-memory session store: the focus cache that survives the Omnibar lives here, and a
    // no-op stub could never catch a bug in it (2026-10-12).
    storage: {
      setSession: async (key: string, value: unknown) => {
        if (value === undefined) session.delete(key);
        else session.set(key, value);
      },
      getSession: async (key: string) => session.get(key),
    },
    rem: {
      findOne: async (id: string) => rems[id],
      createRem: async () => mk(`new${++captured.created}`, [], null),
      findByName: async (name: any[], parentId: string | null = null) =>
        Object.values(rems).find(
          (r: FakeRem) => r.text[0] === name[0] && (r.parent ?? null) === (parentId ?? null)
        ),
    },
    richText: {
      code: (text: string, language: string) => {
        if (language === 'latex') captured.latex = text;
        else captured.log = text;
        return { value: async () => [{ i: 'm', text, code: true, language }] };
      },
    },
  };

  return {
    rems,
    mk,
    plugin,
    captured,
    session,
    focus: (rem: FakeRem | undefined) => { focused = rem; },
    openInPane: (rem: FakeRem | undefined) => { openPane = rem; },
  };
}

/** A `latex` code-block text element. */
export const code = (text: string) => ({ i: 'm', text, code: true, language: 'latex' });
/** A pin (the small pin icon) to `id`. */
export const pin = (id: string) => ({ i: 'q', _id: id, pin: true });
/** An inline rem reference (renders the target's name as words) to `id`. */
export const ref = (id: string) => ({ i: 'q', _id: id });
/**
 * A reference whose target no longer exists. RemNote keeps the deleted rem's breadcrumb, which is
 * what makes a lost citation recoverable — `deadRef('Zotero | Items | smith2020')`.
 */
export const deadRef = (remembered: string, opts: { pin?: boolean } = {}) => ({
  i: 'q',
  _id: 'deleted-' + remembered.replace(/\W+/g, '-'),
  ...(opts.pin ? { pin: true } : {}),
  textOfDeletedRem: remembered.split('|').flatMap((part, i) => (i === 0 ? [part.trim()] : [' | ', part.trim()])),
});
/** Remzot's powerup code, so a fake item doc can carry real-looking metadata slots. */
export const ZOTERO_ITEM_POWERUP = 'zotero-item';
/** Extra props that make a fake rem an unfinished todo. */
export const todo = { isTodo: async () => true, getTodoStatus: async () => 'Unfinished' };
/** Extra props that make a fake rem an H1 heading. */
export const heading = { getFontSize: async () => 'H1' };

/** Collects PASS/FAIL lines for one suite and counts failures. */
export function suite(title: string) {
  let failures = 0;
  console.log(`\n## ${title}`);
  return {
    check(name: string, ok: boolean, detail = ''): void {
      if (!ok) failures += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n${detail}`}`);
    },
    equal(name: string, got: string, expected: string): void {
      const ok = got === expected;
      if (!ok) failures += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n--- got ---\n${got}\n--- expected ---\n${expected}`}`
      );
    },
    failures: () => failures,
  };
}
