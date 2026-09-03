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
      isPowerupProperty: async () => false,
      isPowerupPropertyListItem: async () => false,
      isPowerupSlot: async () => false,
      isSlot: async () => false,
      setText: async (t: any[]) => {
        r.text = t;
      },
      setParent: async (p: any) => {
        r.parent = typeof p === 'string' ? p : p._id;
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

  const plugin: any = {
    rem: {
      findOne: async (id: string) => rems[id],
      createRem: async () => mk(`new${++captured.created}`, [], null),
      findByName: async (name: any[]) =>
        Object.values(rems).find((r: FakeRem) => r.text[0] === name[0] && r.parent === null),
    },
    richText: {
      code: (text: string, language: string) => {
        if (language === 'latex') captured.latex = text;
        else captured.log = text;
        return { value: async () => [{ i: 'm', text, code: true, language }] };
      },
    },
  };

  return { rems, mk, plugin, captured };
}

/** A `latex` code-block text element. */
export const code = (text: string) => ({ i: 'm', text, code: true, language: 'latex' });
/** A pin (the small pin icon) to `id`. */
export const pin = (id: string) => ({ i: 'q', _id: id, pin: true });
/** An inline rem reference (renders the target's name as words) to `id`. */
export const ref = (id: string) => ({ i: 'q', _id: id });
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
