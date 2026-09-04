import type { ReactRNPlugin, PluginRem as Rem } from '@remnote/plugin-sdk';

const REQUIRED_PREAMBLE_NAME = 'Preamble';
const REQUIRED_END_NAME = 'End';
const HEADING_COMMANDS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
export type Rem2TexTodoExportMode = 'all' | 'unfinished' | 'none';
export type Rem2TexConversionContext = {
  hierarchyRemIds: Set<string>;
  /** Root rem where /rem2tex was launched; used for relative error hierarchy paths. */
  rootRemId?: string;
  /** Controls whether todos are emitted as `% TODO ...` comments. */
  todoExportMode?: Rem2TexTodoExportMode;
  /**
   * Rem IDs whose subtrees are skipped during serialization (e.g. prior “paragraph export”
   * nodes stored under the source rem so they are not re-emitted as body text).
   */
  skipRemSubtreeIds?: Set<string>;
  /** Paper conversions record what happened here; the paragraph command has no log. */
  log?: Rem2TexLog;
  /** Rems tagged `Rem2Tex-ignore` (see `loadIgnoredRemIds`); undefined = no tag rem exists. */
  ignoredRemIds?: Set<string>;
};

/** Best-effort `\title`, `\author`, `\documentclass{…}` from raw preamble text (for the log). */
export function parsePreambleLatexMetadata(preamble: string): {
  title: string;
  author: string;
  documentClass: string;
} {
  const documentClass =
    preamble.match(/\\documentclass(?:\[[^\]]*\])?\s*\{([^}]+)\}/)?.[1]?.trim() ?? '';
  const titleM = preamble.match(/\\title\s*\{([^}]*)\}/);
  const authorM = preamble.match(/\\author\s*\{([^}]*)\}/);
  return {
    title: titleM?.[1]?.trim() ?? '',
    author: authorM?.[1]?.trim() ?? '',
    documentClass,
  };
}

/** Enclosing `\section` / `\subsection` titles of the rem being converted (for error reports). */
export type Rem2TexOutlineLocation = {
  section?: string;
  subsection?: string;
};

export type Rem2TexConversionErrorOptions = {
  code: string;
  headline: string;
  whatHappened: string;
  technicalDetail?: string;
  location?: Rem2TexOutlineLocation;
  sourceRemId?: string;
  sourceRemTextPreview?: string;
  /** Display title of the rem being converted (may differ from preview text). */
  sourceRemTitle?: string;
  /** Hierarchy path from paper root to source rem (excluding root). */
  sourceRemHierarchy?: string[];
  hints?: string[];
};

/**
 * Structured export failure. Phase A errors (no focused rem, not a paper) are thrown to the command
 * and toasted; phase B errors (boundary blocks, body conversion) are written into the Log block of
 * the export rem. `REM_CONVERSION_FAILED` wraps unexpected errors with the failing rem's context
 * (`enrichConversionErrorWithSourceRem`).
 */
export class Rem2TexConversionError extends Error {
  readonly code: string;
  readonly headline: string;
  readonly whatHappened: string;
  readonly technicalDetail?: string;
  readonly location?: Rem2TexOutlineLocation;
  readonly sourceRemId?: string;
  readonly sourceRemTextPreview?: string;
  readonly sourceRemTitle?: string;
  readonly sourceRemHierarchy?: string[];
  readonly hints: string[];

  constructor(opts: Rem2TexConversionErrorOptions) {
    const parts = [opts.whatHappened, opts.technicalDetail].filter(
      (p): p is string => typeof p === 'string' && p.length > 0
    );
    super(parts.join(' ') || opts.headline);
    this.name = 'Rem2TexConversionError';
    this.code = opts.code;
    this.headline = opts.headline;
    this.whatHappened = opts.whatHappened;
    this.technicalDetail = opts.technicalDetail;
    this.location = opts.location;
    this.sourceRemId = opts.sourceRemId;
    this.sourceRemTextPreview = opts.sourceRemTextPreview;
    this.sourceRemTitle = opts.sourceRemTitle;
    this.sourceRemHierarchy = opts.sourceRemHierarchy;
    this.hints = opts.hints ?? [];
  }
}

export function isRem2TexConversionError(e: unknown): e is Rem2TexConversionError {
  return e instanceof Rem2TexConversionError;
}

/** Hints for failures that are not one of the typed, user-fixable conversion errors. */
const GENERIC_ERROR_HINTS = [
  'This is not one of the known authoring problems. Copy this log and share it when asking for help.',
  'Retry once; if it stops at the same place again, run `/rem2tex-paragraph` on the section named above to narrow it down.',
];

/**
 * Human-readable record of one paper conversion. Written as a `text` code block next to the Paper
 * block under the export rem, so the outline itself is the audit trail (there is no popup).
 */
export class Rem2TexLog {
  readonly startedAt = new Date();
  readonly warnings: string[] = [];
  readonly counts = {
    headings: 0,
    paragraphs: 0,
    codeBlocks: 0,
    mediaBlocks: 0,
    todoComments: 0,
    todosSkipped: 0,
    commentRems: 0,
    citations: 0,
    pinsDropped: 0,
    /** Rem2Tex's own export rems / folder found inside the body and skipped. */
    outputRemsSkipped: 0,
  };
  readonly citationKeys = new Set<string>();
  /** Rems (title + path) skipped because they carry the `Rem2Tex-ignore` tag. */
  readonly ignoredRems: string[] = [];
  private readonly sections: Array<{ title: string; lines: string[] }> = [];

  section(title: string): void {
    this.sections.push({ title, lines: [] });
  }

  ignored(description: string): void {
    this.ignoredRems.push(description);
  }

  info(line: string): void {
    if (this.sections.length === 0) this.section('General');
    this.sections[this.sections.length - 1].lines.push(line);
  }

  warn(line: string): void {
    this.warnings.push(line);
  }

  citation(citeCommand: string): void {
    this.counts.citations += 1;
    const key = citeCommand.match(/\\cite\{([^}]*)\}/)?.[1]?.trim();
    if (key) this.citationKeys.add(key);
  }

  pinDropped(): void {
    this.counts.pinsDropped += 1;
  }

  toText(result: { status: 'success'; latexLineCount: number } | { status: 'failed'; error: unknown }): string {
    const out: string[] = ['Rem2Tex conversion log', '======================'];
    out.push(`Started:  ${toOutputTimestamp(this.startedAt)}`);
    out.push(`Duration: ${((Date.now() - this.startedAt.getTime()) / 1000).toFixed(1)} s`);
    for (const s of this.sections) {
      out.push('', s.title, '-'.repeat(s.title.length));
      for (const line of s.lines) out.push(`- ${line}`);
    }
    const c = this.counts;
    out.push('', 'Conversion summary', '------------------');
    out.push(`- Headings: ${c.headings}`);
    out.push(`- Paragraphs: ${c.paragraphs}; raw code blocks: ${c.codeBlocks}; figure/table blocks: ${c.mediaBlocks}`);
    out.push(
      `- Citations: ${c.citations}${this.citationKeys.size > 0 ? ` (keys: ${[...this.citationKeys].join(', ')})` : ''}`
    );
    out.push(`- Pins dropped from prose (not Zotero items): ${c.pinsDropped}`);
    out.push(`- Todo comments: ${c.todoComments} exported, ${c.todosSkipped} skipped by the todo mode`);
    out.push(`- % comment rems: ${c.commentRems}`);
    out.push(`- Rems skipped by the ${REM2TEX_IGNORE_TAG} tag (with their subtrees): ${this.ignoredRems.length}`);
    if (c.outputRemsSkipped > 0) {
      out.push(`- Earlier Rem2Tex export rems found inside the body and skipped: ${c.outputRemsSkipped}`);
    }
    if (this.ignoredRems.length > 0) {
      const ignoredTitle = `Skipped by ${REM2TEX_IGNORE_TAG} (${this.ignoredRems.length})`;
      out.push('', ignoredTitle, '-'.repeat(ignoredTitle.length));
      for (const r of this.ignoredRems) out.push(`- ${r}`);
    }
    const warningsTitle = `Warnings (${this.warnings.length})`;
    out.push('', warningsTitle, '-'.repeat(warningsTitle.length));
    if (this.warnings.length === 0) out.push('- none');
    for (const w of this.warnings) out.push(`- ${w}`);
    out.push('', 'Result', '------');
    if (result.status === 'success') {
      out.push(
        `- SUCCESS${this.warnings.length > 0 ? ` with ${this.warnings.length} warning(s)` : ''}: ${result.latexLineCount} line(s) of LaTeX in the Paper rem's code block.`
      );
    } else {
      out.push(...formatFailureForLog(result.error));
      out.push('- No Paper rem was written.');
    }
    return out.join('\n');
  }
}

function formatFailureForLog(error: unknown): string[] {
  const lines: string[] = [];
  if (!isRem2TexConversionError(error)) {
    lines.push(`- FAILED: ${normalizeUnknownError(error)}`);
    lines.push('  Suggestions:');
    for (const h of GENERIC_ERROR_HINTS) lines.push(`    • ${h}`);
    return lines;
  }
  lines.push(`- FAILED — ${error.code}: ${error.headline}`);
  lines.push(`  ${error.whatHappened}`);
  if (error.location?.section || error.location?.subsection) {
    lines.push('  Where in the outline:');
    if (error.location.section) lines.push(`    Section: ${error.location.section}`);
    if (error.location.subsection) lines.push(`    Subsection: ${error.location.subsection}`);
  }
  if (error.sourceRemTitle || error.sourceRemId || error.sourceRemTextPreview) {
    lines.push('  Rem being converted when it failed:');
    if (error.sourceRemTitle) lines.push(`    Title: ${error.sourceRemTitle}`);
    if (error.sourceRemHierarchy && error.sourceRemHierarchy.length > 0) {
      lines.push(`    Path: ${error.sourceRemHierarchy.join(' > ')}`);
    }
    if (error.sourceRemId) lines.push(`    Rem id: ${error.sourceRemId}`);
    if (error.sourceRemTextPreview) {
      lines.push(`    Text (pins shown as ⟨pin⟩): ${error.sourceRemTextPreview.replace(/\n/g, ' ')}`);
    }
  }
  if (error.technicalDetail) {
    lines.push('  Technical detail:');
    for (const t of error.technicalDetail.split('\n')) lines.push(`    ${t}`);
  }
  const hints = error.hints.length > 0 ? error.hints : GENERIC_ERROR_HINTS;
  lines.push('  Suggestions:');
  for (const h of hints) lines.push(`    • ${h}`);
  return lines;
}

export type Rem2TexRunOptions = {
  /** The paper rem, or any of its children (e.g. its `Preamble`); defaults to the focused rem. */
  parentRem?: Rem;
  todoExportMode?: Rem2TexTodoExportMode;
  /** Command name, recorded in the log. */
  commandLabel?: string;
};

export type Rem2TexRunResult = {
  status: 'success' | 'failed';
  /** Title of the export rem (`Rem2Tex HH:MM AM/PM DD-MM-YYYY`) holding the Paper and Log code blocks. */
  outputTitle: string;
  warningCount: number;
  /** Set when `status` is 'failed'. */
  errorCode?: string;
  errorHeadline?: string;
};

export type Rem2TexParagraphRunOptions = {
  /** Rem to convert; defaults to the focused / selected rem. */
  paragraphRem?: Rem;
};

function isFormattingMetadataLabel(value: string): boolean {
  const normalized = value.trim();
  if (normalized === 'Size' || /^H[1-6]$/.test(normalized)) return true;

  // Common RemNote code block UI metadata keys that should never
  // appear in exported TeX output.
  return normalized === 'BoundHeight' || normalized === 'Language';
}

function isCodeMetadataArtifactLine(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  if (isFormattingMetadataLabel(normalized)) return true;

  const lower = normalized.toLowerCase();
  // Common trailing artifacts seen in RemNote code rich-text payloads.
  return lower === 'true' || lower === 'false' || lower === 'latex' || lower === 'language';
}

function stripTrailingCodeMetadataArtifacts(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 0 && isCodeMetadataArtifactLine(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines.join('\n').trim();
}

function wrapRemnoteMath(text: string, preferDisplay = false): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Preserve already-delimited math snippets.
  if (
    (trimmed.startsWith('$$') && trimmed.endsWith('$$')) ||
    (trimmed.startsWith('$') && trimmed.endsWith('$')) ||
    (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) ||
    (trimmed.startsWith('\\[') && trimmed.endsWith('\\]'))
  ) {
    return trimmed;
  }

  return preferDisplay ? `$$${trimmed}$$` : `$${trimmed}$`;
}

export function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) return maybeMessage;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function toOutputTimestamp(now: Date = new Date()): string {
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  const hours24 = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  const hours = String(hours12).padStart(2, '0');
  return `${hours}:${minutes} ${meridiem} ${day}-${month}-${year}`;
}

/** Direct child rems created by “Paragraph to TeX” (title + code subtree). */
function isParagraphExportRootRem(rem: Rem): boolean {
  const t = flattenRawTitleText(rem.text).trim();
  return /^Rem2Tex paragraph\b/i.test(t);
}

/**
 * Rem2Tex's own output — the `Rem2Tex` folder and any `Rem2Tex <timestamp>` /
 * `Rem2Tex paragraph <timestamp>` export rem — is never input: such rems are skipped with their
 * subtrees wherever an export finds them (an old paragraph export left under a section, the folder
 * itself when a paragraph export is run on a paper rem).
 */
function isRem2TexOutputRem(rem: Rem): boolean {
  const t = flattenRawTitleText(rem.text).trim();
  return t === 'Rem2Tex' || /^Rem2Tex( paragraph)? \d\d:\d\d [AP]M \d\d-\d\d-\d{4}$/.test(t);
}

async function collectParagraphExportSkipRemIds(paragraphRem: Rem): Promise<Set<string>> {
  const skip = new Set<string>();
  const children = await paragraphRem.getChildrenRem();
  for (const child of children) {
    if (!isParagraphExportRootRem(child)) continue;
    skip.add(child._id);
    for (const d of await child.getDescendants()) {
      skip.add(d._id);
    }
  }
  return skip;
}

/** Same shape as full-paper export: titled rem + LaTeX code child. */
async function createParagraphLatexExport(
  plugin: ReactRNPlugin,
  paragraphRem: Rem,
  latex: string
): Promise<string> {
  const outputTitle = `Rem2Tex paragraph ${toOutputTimestamp()}`;
  const outputRem = await plugin.rem.createRem();
  if (!outputRem) {
    throw new Error('Failed to create paragraph export rem.');
  }
  await outputRem.setText([outputTitle]);
  await outputRem.setParent(paragraphRem);

  const codeRem = await plugin.rem.createRem();
  if (!codeRem) {
    throw new Error('Failed to create paragraph export code rem.');
  }
  await codeRem.setParent(outputRem);
  await codeRem.setText(await plugin.richText.code(latex, 'latex').value());

  return outputTitle;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  let cursor = index - 1;
  while (cursor >= 0 && text[cursor] === '\\') {
    backslashes += 1;
    cursor -= 1;
  }
  return backslashes % 2 === 1;
}

function findMatchingGroup(text: string, start: number, open: string, close: string): number {
  if (text[start] !== open) return -1;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (char === open && !isEscaped(text, i)) {
      depth += 1;
    } else if (char === close && !isEscaped(text, i)) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function findInlineMathEnd(text: string, start: number, delimiter: '$' | '$$'): number {
  let cursor = start + delimiter.length;
  while (cursor < text.length) {
    if (text.startsWith(delimiter, cursor) && !isEscaped(text, cursor)) {
      return cursor + delimiter.length;
    }
    cursor += 1;
  }
  return -1;
}

type LatexEnvironmentToken = {
  kind: 'begin' | 'end';
  name: string;
  tokenEnd: number;
};

function parseLatexEnvironmentToken(text: string, start: number): LatexEnvironmentToken | undefined {
  const match = text.slice(start).match(/^\\(begin|end)\s*\{\s*([^\}\s]+)\s*\}/);
  if (!match) return undefined;
  return {
    kind: match[1] as 'begin' | 'end',
    name: match[2],
    tokenEnd: start + match[0].length,
  };
}

function findLatexEnvironmentEnd(text: string, start: number): number {
  const startToken = parseLatexEnvironmentToken(text, start);
  if (!startToken || startToken.kind !== 'begin') return -1;

  const envName = startToken.name;
  let depth = 1;
  let cursor = startToken.tokenEnd;

  while (cursor < text.length) {
    const nextSlash = text.indexOf('\\', cursor);
    if (nextSlash === -1) break;

    const token = parseLatexEnvironmentToken(text, nextSlash);
    if (token && token.name === envName) {
      if (token.kind === 'begin') depth += 1;
      if (token.kind === 'end') depth -= 1;
      if (depth === 0) return token.tokenEnd;
      cursor = token.tokenEnd;
      continue;
    }

    cursor = nextSlash + 1;
  }

  return -1;
}

function consumeLatexCommand(text: string, start: number): number {
  if (text[start] !== '\\') return start;
  const nextChar = text[start + 1];
  if (!nextChar) return start + 1;

  // Keep escaped literal symbols untouched (e.g., \%, \_, \\).
  if (!/[A-Za-z]/.test(nextChar)) return start + 2;

  let cursor = start + 1;
  while (cursor < text.length && /[A-Za-z]/.test(text[cursor])) {
    cursor += 1;
  }
  if (text[cursor] === '*') cursor += 1;

  // Consume attached [] and {} argument groups.
  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor])) {
      cursor += 1;
    }
    if (text[cursor] === '[') {
      const end = findMatchingGroup(text, cursor, '[', ']');
      if (end === -1) break;
      cursor = end;
      continue;
    }
    if (text[cursor] === '{') {
      const end = findMatchingGroup(text, cursor, '{', '}');
      if (end === -1) break;
      cursor = end;
      continue;
    }
    break;
  }

  return cursor;
}

function escapePlainTextSegment(segment: string): string {
  const map: Record<string, string> = {
    '{': '\\{',
    '}': '\\}',
    '$': '\\$',
    '&': '\\&',
    '#': '\\#',
    '%': '\\%',
    '_': '\\_',
    '^': '\\textasciicircum{}',
  };

  let result = '';
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];
    const next = segment[i + 1];

    // Preserve already escaped literals in plain text.
    if (char === '\\' && next && /[\\{}$&#%_^]/.test(next)) {
      result += `${char}${next}`;
      i += 1;
      continue;
    }

    if (char === '\\') {
      result += '\\textbackslash{}';
      continue;
    }

    result += map[char] ?? char;
  }
  return result;
}

function normalizeMathEnvironmentSpacing(text: string): string {
  const mathEnvironments = new Set([
    'equation',
    'equation*',
    'align',
    'align*',
    'gather',
    'gather*',
    'multline',
    'multline*',
  ]);

  return text.replace(
    /\\begin\{([A-Za-z*]+)\}([\s\S]*?)\\end\{\1\}/g,
    (match: string, envName: string, body: string) => {
      if (!mathEnvironments.has(envName)) return match;

      let normalizedBody = body
        // RemNote can introduce extra blank lines before labels in math envs.
        .replace(/\n[ \t]*\n([ \t]*\\label\{)/g, '\n$1')
        // Avoid runaway blank lines in math blocks.
        .replace(/\n{3,}/g, '\n\n');

      // If lines inside a math environment are individually wrapped with
      // $...$ or $$...$$, unwrap them to avoid nested math delimiters.
      normalizedBody = normalizedBody
        .split('\n')
        .map((line) => {
          const inlineWrapped = line.match(/^(\s*)\$(?!\$)(.+?)\$(\s*)$/);
          if (inlineWrapped) return `${inlineWrapped[1]}${inlineWrapped[2]}${inlineWrapped[3]}`;

          const displayWrapped = line.match(/^(\s*)\$\$(.+?)\$\$(\s*)$/);
          if (displayWrapped) return `${displayWrapped[1]}${displayWrapped[2]}${displayWrapped[3]}`;

          return line;
        })
        .join('\n');

      return `\\begin{${envName}}${normalizedBody}\\end{${envName}}`;
    }
  );
}

function escapeLatex(text: string): string {
  const normalizedText = normalizeMathEnvironmentSpacing(text);
  let result = '';
  let cursor = 0;
  let plainStart = 0;

  const flushPlain = (end: number): void => {
    if (end > plainStart) {
      result += escapePlainTextSegment(normalizedText.slice(plainStart, end));
    }
  };

  while (cursor < normalizedText.length) {
    let protectedEnd = -1;

    if (normalizedText.startsWith('\\begin', cursor)) {
      protectedEnd = findLatexEnvironmentEnd(normalizedText, cursor);
    } else if (normalizedText.startsWith('\\[', cursor)) {
      const end = normalizedText.indexOf('\\]', cursor + 2);
      if (end !== -1) protectedEnd = end + 2;
    } else if (normalizedText.startsWith('\\(', cursor)) {
      const end = normalizedText.indexOf('\\)', cursor + 2);
      if (end !== -1) protectedEnd = end + 2;
    } else if (normalizedText.startsWith('$$', cursor) && !isEscaped(normalizedText, cursor)) {
      protectedEnd = findInlineMathEnd(normalizedText, cursor, '$$');
    } else if (normalizedText[cursor] === '$' && !isEscaped(normalizedText, cursor)) {
      protectedEnd = findInlineMathEnd(normalizedText, cursor, '$');
    } else if (normalizedText[cursor] === '\\') {
      protectedEnd = consumeLatexCommand(normalizedText, cursor);
    }

    if (protectedEnd > cursor) {
      flushPlain(cursor);
      result += normalizedText.slice(cursor, protectedEnd);
      cursor = protectedEnd;
      plainStart = cursor;
      continue;
    }

    cursor += 1;
  }

  flushPlain(normalizedText.length);
  return result;
}

type FlattenOptions = {
  codeOnly?: boolean;
  /** Ids of the rem being exported and all its descendants; references into it are never citations. */
  hierarchyRemIds?: Set<string>;
  /**
   * Set while flattening a *linked* rem's text (nested resolution): references inside it resolve to
   * plain text instead of `\cite{}`, so citations never nest.
   */
  suppressExternalCitationWrap?: boolean;
  /**
   * Set by `todoComment` and `commentRemLines` (and when resolving a Zotero item title): inside a
   * `%` comment line, non-Zotero pins show the pinned rem's text (a comment never reaches the
   * compiled document) instead of being dropped as in body prose.
   */
  todoContentResolvePinsAsText?: boolean;
  /** Counts citations / dropped pins for the conversion log. */
  log?: Rem2TexLog;
};

const DIAGNOSTIC_PREVIEW_MAX = 1400;

/** Truncate for UI / clipboard; full structure preserved up to max chars. */
function truncateDiagnosticPreview(s: string, max = DIAGNOSTIC_PREVIEW_MAX): string {
  const normalized = s.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

/** Strip RemNote-injected `query:` snippets from diagnostic previews (same noise as export). */
function sanitizeDiagnosticExcerpt(s: string): string {
  return s
    .replace(/^query:\s*/i, '')
    .replace(/\s+query:\s+/gi, ' ')
    .trim();
}

/**
 * Builds a readable preview of rem rich text without resolving pins (shows ⟨pin⟩).
 * Used when reporting which paragraph triggered a pin validation error.
 */
function buildDiagnosticRemTextPreview(element: unknown, depth = 0): string {
  if (depth > 12) return '';
  if (typeof element === 'string') return element;
  if (element === null || element === undefined) return '';
  if (Array.isArray(element)) {
    return element.map((c) => buildDiagnosticRemTextPreview(c, depth + 1)).join('');
  }
  if (typeof element !== 'object') return '';
  const entry = element as Record<string, unknown>;

  if (entry.i === 'x' && typeof entry.text === 'string') {
    const isDisplay = entry.block === true;
    return wrapRemnoteMath(entry.text, isDisplay);
  }
  if (entry.i === 'q') {
    return '⟨pin⟩';
  }
  if (entry.i === 'i') {
    return '⟨image⟩';
  }
  if (typeof entry.text === 'string') {
    const isPlainTextNode = entry.i === 'm' || entry.i === undefined;
    if (!isPlainTextNode) return '';
    if (isFormattingMetadataLabel(entry.text)) return '';
    return entry.text;
  }
  if (entry.textOfDeletedRem !== undefined) {
    return buildDiagnosticRemTextPreview(entry.textOfDeletedRem, depth + 1);
  }
  return '';
}

function isPinOnlyDiagnosticPreview(value: string): boolean {
  const normalized = value.trim();
  return /^(\u27e8pin\u27e9|<pin>|\u2039pin\u203a)$/i.test(normalized);
}

async function isTodoHeadingMetadataChild(rem: Rem): Promise<boolean> {
  const childHeadingStyle = await rem.getFontSize();
  if (childHeadingStyle !== undefined) return false;
  const children = await rem.getChildrenRem();
  if (children.length > 0) return false;
  const preview = sanitizeDiagnosticExcerpt(buildDiagnosticRemTextPreview(rem.text));
  return isPinOnlyDiagnosticPreview(preview);
}

function isCodeTextElement(entry: Record<string, unknown>): boolean {
  return entry.code === true || typeof entry.language === 'string';
}

/** Text of a reference that is RemNote bookkeeping (powerup slot names), never author content. */
function isBookkeepingReferenceText(text: string): boolean {
  return isFormattingMetadataLabel(text) || text.trim() === 'Status';
}

function toLatexCitation(referenceText: string): string {
  const trimmed = referenceText.trim();
  if (!trimmed) return '';
  if (/^\\cite\{.+\}$/.test(trimmed)) return trimmed;

  const citationKey = trimmed
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9:_-]/g, '');
  if (!citationKey) return '';
  return `\\cite{${citationKey}}`;
}

function normalizeAdjacentCitations(text: string): string {
  if (!text.includes('\\cite{')) return text;

  const citationPattern = /\\cite\{([^}]*)\}/g;
  const matches: Array<{ start: number; end: number; keys: string[] }> = [];
  let match: RegExpExecArray | null;

  while ((match = citationPattern.exec(text)) !== null) {
    const keys = match[1]
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      keys,
    });
  }

  if (matches.length < 2) return text;

  let output = '';
  let cursor = 0;
  let i = 0;

  while (i < matches.length) {
    const groupStart = matches[i].start;
    output += text.slice(cursor, groupStart);

    const aggregatedKeys: string[] = [];
    const seenKeys = new Set<string>();
    let groupEnd = matches[i].end;

    const addKeys = (keys: string[]) => {
      for (const key of keys) {
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          aggregatedKeys.push(key);
        }
      }
    };

    addKeys(matches[i].keys);

    let j = i + 1;
    while (j < matches.length) {
      const between = text.slice(groupEnd, matches[j].start);
      if (!/^\s*$/.test(between)) break;
      addKeys(matches[j].keys);
      groupEnd = matches[j].end;
      j += 1;
    }

    // The merged citations were separated by whitespace only; drop it (the text after the group
    // still starts with its own spacing), so no stray double/trailing spaces are emitted.
    output += `\\cite{${aggregatedKeys.join(', ')}}`;
    cursor = groupEnd;
    i = j;
  }

  output += text.slice(cursor);
  return output;
}

/** Citation commands an author may type around a pin; the pin itself resolves to `\cite{key}`. */
const CITATION_WRAPPER_COMMANDS = new Set([
  'cite',
  'citep',
  'citet',
  'citealp',
  'citealt',
  'citeauthor',
  'citeyear',
  'citeyearpar',
  'citenum',
  'parencite',
  'textcite',
  'autocite',
  'footcite',
  'footcitetext',
  'supercite',
  'smartcite',
  'nocite',
  'Cite',
  'Parencite',
  'Textcite',
  'Autocite',
]);

/**
 * Reference commands. Nothing generates `\ref{}` from a pin any more (2026-09-03 design), so this
 * set only normalises a typed `\eqref{\ref{x}}`-style nesting.
 */
const REFERENCE_WRAPPER_COMMANDS = new Set([
  'ref',
  'eqref',
  'pageref',
  'autoref',
  'nameref',
  'vref',
  'cref',
  'Cref',
  'crefrange',
  'Crefrange',
]);

/**
 * Authors write `\cite{` + pin-to-Zotero-item + `}` so the pin is a real link in RemNote. The pin
 * alone already exports as `\cite{key}`, which would yield `\cite{\cite{key}}`. Inside the argument
 * of a typed citation (or reference) command, unwrap the inner command(s) so only the key(s) remain
 * (`\cite{a, \cite{b}}` → `\cite{a, b}`).
 */
export function unwrapNestedCitationCommands(text: string): string {
  if (!text.includes('\\cite{') && !text.includes('\\ref{')) return text;

  let result = '';
  let cursor = 0;

  while (cursor < text.length) {
    const slash = text.indexOf('\\', cursor);
    if (slash === -1) break;

    let nameEnd = slash + 1;
    while (nameEnd < text.length && /[A-Za-z]/.test(text[nameEnd])) nameEnd += 1;
    const name = text.slice(slash + 1, nameEnd);
    const family = CITATION_WRAPPER_COMMANDS.has(name)
      ? 'cite'
      : REFERENCE_WRAPPER_COMMANDS.has(name)
        ? 'ref'
        : undefined;

    if (!family || isEscaped(text, slash)) {
      result += text.slice(cursor, slash + 1);
      cursor = slash + 1;
      continue;
    }

    let argStart = nameEnd;
    if (text[argStart] === '*') argStart += 1;
    while (text[argStart] === '[') {
      const optEnd = findMatchingGroup(text, argStart, '[', ']');
      if (optEnd === -1) break;
      argStart = optEnd;
    }
    if (text[argStart] !== '{') {
      result += text.slice(cursor, argStart);
      cursor = argStart;
      continue;
    }

    const argEnd = findMatchingGroup(text, argStart, '{', '}');
    if (argEnd === -1) {
      result += text.slice(cursor, argStart + 1);
      cursor = argStart + 1;
      continue;
    }

    const inner = text.slice(argStart + 1, argEnd - 1);
    const innerCommand = family === 'cite' ? 'cite' : 'ref';
    const adjacentInner = new RegExp(`\\}\\s*\\\\${innerCommand}\\{`, 'g');
    const singleInner = new RegExp(`\\\\${innerCommand}\\{([^{}]*)\\}`, 'g');
    let unwrapped = inner
      // `\cite{a} \cite{b}` inside the argument → one key list, then strip the wrappers.
      .replace(adjacentInner, ', ')
      .replace(singleInner, '$1');

    // When the argument is now a plain key list, dedupe it (the same pin twice → one key).
    if (unwrapped !== inner && /^[^{}\\]*$/.test(unwrapped)) {
      const seen = new Set<string>();
      const keys = unwrapped
        .split(',')
        .map((key) => key.trim())
        .filter((key) => key.length > 0 && !seen.has(key) && (seen.add(key), true));
      unwrapped = keys.join(', ');
    }

    result += text.slice(cursor, argStart + 1) + unwrapped + '}';
    cursor = argEnd;
  }

  result += text.slice(cursor);
  return result;
}

/** Remzot keeps the library under a `Zotero` root with an `Items` child holding one doc per item. */
const ZOTERO_ROOT_TITLE = 'Zotero';
const ZOTERO_ITEMS_TITLE = 'Items';
const ZOTERO_ANCESTOR_WALK_MAX = 64;

function rawTitleEquals(rem: Rem, expected: string): boolean {
  return flattenRawTitleText(rem.text).trim() === expected;
}

/**
 * The only references Rem2Tex turns into citations are those pointing at (or inside) an item doc
 * under `Zotero/Items` — the tree Remzot maintains, which mo may also add to by hand before a sync
 * (so no powerup tag is required). Walks up from `rem`; returns the item doc (the direct child of
 * `Items` on the path, possibly `rem` itself) or undefined.
 */
async function findZoteroItemDoc(plugin: ReactRNPlugin, rem: Rem): Promise<Rem | undefined> {
  let candidate: Rem = rem;
  let parent: Rem | undefined = rem.parent ? await plugin.rem.findOne(rem.parent) : undefined;
  let hops = 0;
  while (parent && hops < ZOTERO_ANCESTOR_WALK_MAX) {
    if (rawTitleEquals(parent, ZOTERO_ITEMS_TITLE)) {
      const grandparent = parent.parent ? await plugin.rem.findOne(parent.parent) : undefined;
      if (grandparent && rawTitleEquals(grandparent, ZOTERO_ROOT_TITLE)) {
        return candidate;
      }
    }
    candidate = parent;
    parent = parent.parent ? await plugin.rem.findOne(parent.parent) : undefined;
    hops += 1;
  }
  return undefined;
}

/** RemNote bookkeeping rems (powerup properties / slots, e.g. a todo's `Status`) never export. */
async function isBookkeepingRem(rem: Rem): Promise<boolean> {
  try {
    const flags = await Promise.all([
      rem.isPowerupProperty(),
      rem.isPowerupPropertyListItem(),
      rem.isPowerupSlot(),
      rem.isSlot(),
    ]);
    return flags.some((flag) => flag === true);
  } catch {
    return false;
  }
}

function flattenRawTitleText(element: unknown, depth = 0): string {
  if (depth > 8 || element === null || element === undefined) return '';
  if (typeof element === 'string') return element;
  if (Array.isArray(element)) return element.map((item) => flattenRawTitleText(item, depth + 1)).join('');
  if (typeof element !== 'object') return '';

  const entry = element as Record<string, unknown>;
  if ((entry.i === 'm' || entry.i === undefined) && typeof entry.text === 'string') {
    return entry.text;
  }
  return '';
}

/** `\cite{key}` for a Zotero item doc — its title is the citekey (Remzot names item docs that way). */
async function zoteroCitationForItem(
  plugin: ReactRNPlugin,
  itemDoc: Rem,
  options: FlattenOptions,
  seenRemIds: Set<string>,
  depth: number
): Promise<string> {
  const rawTitle = flattenRawTitleText(itemDoc.text).trim();
  const title =
    rawTitle ||
    (
      await flattenRichTextElement(
        plugin,
        itemDoc.text,
        { ...options, suppressExternalCitationWrap: true, todoContentResolvePinsAsText: true },
        new Set(seenRemIds),
        depth + 1
      )
    ).trim();
  return toLatexCitation(title) || `\\cite{rem_${itemDoc._id}}`;
}

async function flattenRichTextElement(
  plugin: ReactRNPlugin,
  element: unknown,
  options: FlattenOptions = {},
  seenRemIds: Set<string> = new Set(),
  depth = 0
): Promise<string> {
  if (depth > 12) return '';
  // Bare strings are plain text (SDK: `string & { i?: undefined }`); code is only ever a text
  // element carrying `code: true`, so in code-only mode a bare string contributes nothing.
  if (typeof element === 'string') return options.codeOnly ? '' : element;
  if (element === null || element === undefined) return '';

  if (Array.isArray(element)) {
    let flattened = '';
    for (const child of element) {
      flattened += await flattenRichTextElement(plugin, child, options, seenRemIds, depth + 1);
    }
    return flattened;
  }

  if (typeof element !== 'object') return '';
  const entry = element as Record<string, unknown>;

  // RemNote LaTeX rich-text elements.
  if (entry.i === 'x' && typeof entry.text === 'string') {
    if (options.codeOnly) return '';
    const isDisplay = entry.block === true;
    return wrapRemnoteMath(entry.text, isDisplay);
  }

  // Rem reference / pin elements.
  if (entry.i === 'q' && typeof entry._id === 'string') {
    // In code-only mode, rem references are usually formatting metadata
    // (e.g. heading size controls) rather than code content.
    if (options.codeOnly) {
      return '';
    }
    if (seenRemIds.has(entry._id)) {
      return '';
    }
    const linkedRem = await plugin.rem.findOne(entry._id);
    if (!linkedRem) {
      return '';
    }
    const nextSeen = new Set(seenRemIds);
    nextSeen.add(entry._id);

    // 1. A reference (pin or inline) to an item under `Zotero/Items` is a citation. References
    //    into the export hierarchy itself never are, and nested resolution never cites.
    const isInsideHierarchy = options.hierarchyRemIds?.has(entry._id) === true;
    if (!isInsideHierarchy && !options.suppressExternalCitationWrap) {
      const zoteroItemDoc = await findZoteroItemDoc(plugin, linkedRem);
      if (zoteroItemDoc) {
        const citation = await zoteroCitationForItem(plugin, zoteroItemDoc, options, nextSeen, depth);
        options.log?.citation(citation);
        return citation;
      }
    }

    // 2. Powerup bookkeeping rems (e.g. a todo's Status slot) never export.
    if (await isBookkeepingRem(linkedRem)) {
      return '';
    }

    // 3. Any other *pin* is the author's own navigation/reminder (todo, figure, note): nothing in
    //    body prose; the pinned rem's text inside a `% TODO` comment line.
    const isPin = entry.pin === true;
    if (isPin && !options.todoContentResolvePinsAsText) {
      options.log?.pinDropped();
      return '';
    }

    // 4. Inline references (and pins inside todo comments) resolve to the target's visible text.
    const linkedText = (
      await flattenRichTextElement(
        plugin,
        linkedRem.text,
        { ...options, suppressExternalCitationWrap: true },
        nextSeen,
        depth + 1
      )
    ).trim();
    if (isBookkeepingReferenceText(linkedText)) {
      return '';
    }
    return linkedText;
  }

  if (typeof entry.text === 'string') {
    // Only serialize plain text nodes; skip non-text payload nodes that may
    // carry query/search context blobs.
    const isPlainTextNode = entry.i === 'm' || entry.i === undefined;
    if (!isPlainTextNode) {
      return '';
    }
    if (options.codeOnly && !isCodeTextElement(entry)) {
      return '';
    }
    return entry.text;
  }

  // Some rich text payloads nest fallback text for deleted/aliased Rem refs.
  if (entry.textOfDeletedRem !== undefined) {
    return flattenRichTextElement(plugin, entry.textOfDeletedRem, options, seenRemIds, depth + 1);
  }

  return '';
}

export async function richTextToString(
  plugin: ReactRNPlugin,
  text?: unknown,
  options: FlattenOptions = {}
): Promise<string> {
  if (text === null || text === undefined) return '';
  const flattened = await flattenRichTextElement(plugin, text, options);
  const trimmed = flattened.trim();
  if (/^query:/i.test(trimmed)) {
    return '';
  }
  if (isFormattingMetadataLabel(trimmed)) {
    return '';
  }
  // Merge adjacent pins into one \cite first (so `\cite{` pin pin `}` becomes one key list), then
  // unwrap generated \cite/\ref commands nested inside a typed one, then merge again in case the
  // unwrap left two typed citations adjacent.
  const merged = normalizeAdjacentCitations(trimmed);
  const unwrapped = unwrapNestedCitationCommands(merged);
  return unwrapped === merged ? merged : normalizeAdjacentCitations(unwrapped);
}

export async function getRemTitle(
  plugin: ReactRNPlugin,
  rem: Rem,
  context?: Rem2TexConversionContext
): Promise<string> {
  return richTextToString(plugin, rem.text, {
    hierarchyRemIds: context?.hierarchyRemIds,
  });
}

async function getBoundaryBlock(
  plugin: ReactRNPlugin,
  boundaryRem: Rem,
  label: string,
  context: Rem2TexConversionContext
): Promise<string> {
  const children = await boundaryRem.getChildrenRem();
  const codeLines: string[] = [];
  const plainLines: string[] = [];

  const collectDescendantText = async (rem: Rem): Promise<void> => {
    // Powerup bookkeeping rems (a heading's Size, a todo's Status) are never boundary content.
    if (await isBookkeepingRem(rem)) return;
    if (await isIgnoredRem(plugin, rem, context)) return;
    // Nor is Rem2Tex's own output: a paragraph export left under Preamble would otherwise fold a
    // second \documentclass / \begin{document} into the boundary block.
    if (isRem2TexOutputRem(rem)) {
      if (context.log) context.log.counts.outputRemsSkipped += 1;
      return;
    }

    const codeLine = await richTextToString(plugin, rem.text, { codeOnly: true });
    const codeBackLine = await richTextToString(plugin, rem.backText, { codeOnly: true });

    if (codeLine) codeLines.push(codeLine);
    if (codeBackLine) codeLines.push(codeBackLine);

    // Fallback for users who place plain text rather than a code block.
    if (!codeLine && !codeBackLine) {
      const fallbackLine = await richTextToString(plugin, rem.backText ?? rem.text, {
        hierarchyRemIds: context.hierarchyRemIds,
      });
      if (fallbackLine) plainLines.push(fallbackLine);
    }

    const nestedChildren = await rem.getChildrenRem();
    for (const child of nestedChildren) {
      await collectDescendantText(child);
    }
  };

  // The boundary rem's own back text always counts: it holds the block when the rem has no
  // children, and must not be lost just because a note (or a bookkeeping rem) sits under it.
  const ownBackCode = await richTextToString(plugin, boundaryRem.backText, { codeOnly: true });
  if (ownBackCode) {
    codeLines.push(ownBackCode);
  }

  for (const child of children) {
    await collectDescendantText(child);
  }
  if (!ownBackCode) {
    // Plain-text fallback for the boundary rem itself. Its FRONT text is the "Preamble" / "End"
    // title, never the block (until 2026-09-03 that title was exported as the preamble).
    const ownBackPlain = await richTextToString(plugin, boundaryRem.backText, {
      hierarchyRemIds: context.hierarchyRemIds,
    });
    if (ownBackPlain) plainLines.push(ownBackPlain);
  }

  // Code blocks take precedence over plain text. When both exist, the plain lines are not lost
  // silently: they are appended as `% REM2TEX:` comment lines so the author sees them in the .tex.
  const selectedLines = codeLines.length > 0 ? codeLines : plainLines;
  const droppedPlainLines =
    codeLines.length > 0
      ? plainLines
          .flatMap((line) => line.split('\n'))
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !isCodeMetadataArtifactLine(line))
      : [];
  const blockText = stripTrailingCodeMetadataArtifacts(selectedLines.join('\n').trim());
  let normalizedBlockText = blockText
    .split('\n')
    .filter((line) => !isFormattingMetadataLabel(line))
    .join('\n')
    .trim();
  if (normalizedBlockText && droppedPlainLines.length > 0) {
    for (const line of droppedPlainLines) {
      context.log?.warn(
        `Plain-text rem under ${label} not exported because ${label} also has a code block (code takes precedence); it was appended as a % REM2TEX comment: ${line.slice(0, 120)}`
      );
    }
    const notes = droppedPlainLines.map(
      (line) =>
        `% REM2TEX: plain-text rem under ${label} not exported (code blocks take precedence): ${line.slice(0, 200)}`
    );
    normalizedBlockText = `${normalizedBlockText}\n${notes.join('\n')}`;
  }
  if (!normalizedBlockText) {
    throw new Rem2TexConversionError({
      code: 'EMPTY_BOUNDARY_BLOCK',
      headline: `The "${label}" block is empty`,
      whatHappened: `${label} is empty. Add a code block underneath it.`,
      hints: [
        `Put the LaTeX for "${label}" in a code block rem nested under the "${label}" rem (plain text works as a fallback).`,
        'Only code-block text is used when any exists; make sure the block is not just RemNote metadata lines.',
      ],
    });
  }

  return normalizedBlockText;
}

type PaperLayout = {
  preambleRem: Rem;
  endRem: Rem;
  /** Children strictly between Preamble and End, in outline order (never empty). */
  bodyRems: Rem[];
  /** Children before Preamble (a Scratchpad, notes) — ignored. */
  ignoredBefore: Rem[];
  /** Children after End (Supplementary Information, earlier exports) — ignored. */
  ignoredAfter: Rem[];
};

/**
 * A paper is a rem whose children contain a `Preamble`, an `End` after it, and at least one rem
 * between them. Children before Preamble and after End are ignored. `anchorRem`, when it is one of
 * the children and is itself titled Preamble, is the Preamble used (so running on a specific
 * Preamble rem anchors on that rem); otherwise the first child titled Preamble is.
 */
async function findPaperLayout(
  plugin: ReactRNPlugin,
  paperRem: Rem,
  anchorRem?: Rem
): Promise<PaperLayout | undefined> {
  const children = await paperRem.getChildrenRem();
  if (children.length < 3) return undefined;

  let preambleIndex = -1;
  if (anchorRem && anchorRem._id !== paperRem._id) {
    const anchorIndex = children.findIndex((child) => child._id === anchorRem._id);
    if (anchorIndex !== -1 && (await getRemTitle(plugin, children[anchorIndex])) === REQUIRED_PREAMBLE_NAME) {
      preambleIndex = anchorIndex;
    }
  }
  if (preambleIndex === -1) {
    for (let i = 0; i < children.length; i += 1) {
      if ((await getRemTitle(plugin, children[i])) === REQUIRED_PREAMBLE_NAME) {
        preambleIndex = i;
        break;
      }
    }
  }
  if (preambleIndex === -1) return undefined;

  let endIndex = -1;
  for (let i = preambleIndex + 1; i < children.length; i += 1) {
    if ((await getRemTitle(plugin, children[i])) === REQUIRED_END_NAME) {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1 || endIndex - preambleIndex < 2) return undefined;

  return {
    preambleRem: children[preambleIndex],
    endRem: children[endIndex],
    bodyRems: children.slice(preambleIndex + 1, endIndex),
    ignoredBefore: children.slice(0, preambleIndex),
    ignoredAfter: children.slice(endIndex + 1),
  };
}

/** One-line diagnosis of why `rem` is not a paper (for the NOT_A_PAPER toast). */
async function explainNotAPaper(
  plugin: ReactRNPlugin,
  rem: Rem,
  anchorRem?: Rem
): Promise<string> {
  const children = await rem.getChildrenRem();
  const titles: string[] = [];
  for (const child of children) titles.push(await getRemTitle(plugin, child));
  // Mirror findPaperLayout: when the command was started on a `Preamble` child, that rem is the
  // anchor, so the diagnosis must be about it and not about the first Preamble in the outline.
  let preambleIndex = -1;
  if (anchorRem) {
    const anchorIndex = children.findIndex((child) => child._id === anchorRem._id);
    if (anchorIndex !== -1 && titles[anchorIndex] === REQUIRED_PREAMBLE_NAME) preambleIndex = anchorIndex;
  }
  if (preambleIndex === -1) preambleIndex = titles.indexOf(REQUIRED_PREAMBLE_NAME);
  if (preambleIndex === -1) return `no child titled "${REQUIRED_PREAMBLE_NAME}"`;
  const endIndex = titles.indexOf(REQUIRED_END_NAME, preambleIndex + 1);
  if (endIndex === -1) {
    return anchorRem && preambleIndex === children.findIndex((child) => child._id === anchorRem._id)
      ? `no child titled "${REQUIRED_END_NAME}" after this "${REQUIRED_PREAMBLE_NAME}"`
      : `no child titled "${REQUIRED_END_NAME}" after "${REQUIRED_PREAMBLE_NAME}"`;
  }
  if (endIndex - preambleIndex < 2) {
    return `nothing between "${REQUIRED_PREAMBLE_NAME}" and "${REQUIRED_END_NAME}"`;
  }
  return `a "${REQUIRED_PREAMBLE_NAME}"/"${REQUIRED_END_NAME}" pair that does not enclose the rem the command started on`;
}

/**
 * Where is the paper? The focused rem itself when it is a paper (see `findPaperLayout`), otherwise
 * its parent when that is one — so the command works from the paper rem or from any of its children
 * (Preamble, Abstract, …). Anything else is a typed `NOT_A_PAPER` error for the command to toast.
 */
export async function resolvePaperRoot(
  plugin: ReactRNPlugin,
  focusedRem: Rem
): Promise<{ paperRem: Rem; layout: PaperLayout }> {
  const own = await findPaperLayout(plugin, focusedRem);
  if (own) return { paperRem: focusedRem, layout: own };

  const parent = focusedRem.parent ? await plugin.rem.findOne(focusedRem.parent) : undefined;
  if (parent) {
    const viaParent = await findPaperLayout(plugin, parent, focusedRem);
    if (viaParent) return { paperRem: parent, layout: viaParent };
  }

  const focusedTitle = (await getRemTitle(plugin, focusedRem)).trim() || '(untitled)';
  const ownReason = await explainNotAPaper(plugin, focusedRem);
  const parentReason = parent
    ? `its parent "${(await getRemTitle(plugin, parent)).trim() || '(untitled)'}" has ${await explainNotAPaper(plugin, parent, focusedRem)}`
    : 'it has no parent';
  throw new Rem2TexConversionError({
    code: 'NOT_A_PAPER',
    headline: 'Not a paper',
    whatHappened: `"${focusedTitle}" has ${ownReason}, and ${parentReason}.`,
    hints: [
      `A paper is a rem with children "${REQUIRED_PREAMBLE_NAME}" … "${REQUIRED_END_NAME}" and at least one rem between them; run the command on that rem or on any of those children.`,
    ],
  });
}

export async function getFocusedParentRem(plugin: ReactRNPlugin): Promise<Rem> {
  const focusedRem = await plugin.focus.getFocusedRem();
  if (focusedRem) return focusedRem;

  const selected = await plugin.editor.getSelectedRem();
  const selectedRemId = selected?.remIds?.[0];
  if (selectedRemId) {
    const selectedRem = await plugin.rem.findOne(selectedRemId);
    if (!selectedRem) {
      throw new Rem2TexConversionError({
        code: 'INACCESSIBLE_REM',
        headline: 'The selected rem is not accessible to this plugin',
        whatHappened: 'The selected rem is not accessible to this plugin.',
        hints: ['Check the plugin permissions in Settings → Plugins, then focus the paper rem and retry.'],
      });
    }
    return selectedRem;
  }

  const focusedPaneId = await plugin.window.getFocusedPaneId();
  const paneRemId = await plugin.window.getOpenPaneRemId(focusedPaneId);
  if (paneRemId) {
    const paneRem = await plugin.rem.findOne(paneRemId);
    if (paneRem) return paneRem;
  }

  throw new Rem2TexConversionError({
    code: 'NO_FOCUSED_REM',
    headline: 'No focused rem',
    whatHappened: 'No focused rem found. Open or focus the Paper rem before running Rem2Tex.',
    hints: [
      'Click the paper rem (or its "Preamble" rem) so it is focused, or select it, then run the command again.',
    ],
  });
}

async function todoComment(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<string> {
  const status = await rem.getTodoStatus();
  const marker = status === 'Finished' ? '[X]' : '[ ]';
  const text = await richTextToString(plugin, rem.text, {
    hierarchyRemIds: context.hierarchyRemIds,
    todoContentResolvePinsAsText: true,
    log: context.log,
  });
  const cleaned = stripTodoCommentArtifactCitations(text);
  if (!cleaned) return `% TODO ${marker}`;
  // Every physical line must carry its own `%`. A lone newline survives the whitespace collapse
  // above (a soft line break, or a pin to a multi-line code block resolved as text), and an
  // unprefixed continuation line would otherwise be emitted as real LaTeX body content.
  const [first, ...rest] = cleaned.split(/\r?\n/);
  const lines = [`% TODO ${marker} ${first}`.trimEnd()];
  for (const line of rest) {
    const trimmed = line.trim();
    if (trimmed.length > 0) lines.push(`% ${trimmed}`);
  }
  return lines.join('\n');
}

async function shouldExportTodoAsComment(
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<boolean> {
  const mode = context.todoExportMode ?? 'all';
  if (mode === 'none') return false;
  if (mode === 'all') return true;
  const status = await rem.getTodoStatus();
  return status !== 'Finished';
}

/** Spaces before each `%` per nesting depth (depth 1 = first level under root todo). */
const TODO_COMMENT_DEPTH_SPACES = 1;
const TODO_COMMENT_LABEL_MAX = 240;

/** RemNote todo status pins often serialize as `\\cite{Status}`; strip from comment-only output. */
function stripTodoCommentArtifactCitations(text: string): string {
  return text
    .replace(/\\cite\{Status\}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function getCommentTreeLabel(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<string> {
  let raw = flattenRawTitleText(rem.text).trim();
  if (!raw) {
    const diag = sanitizeDiagnosticExcerpt(buildDiagnosticRemTextPreview(rem.text));
    if (isPinOnlyDiagnosticPreview(diag)) return '';
    raw = diag.replace(/\s+/g, ' ').trim();
  }
  raw = stripTodoCommentArtifactCitations(raw);
  const single = raw.replace(/\s+/g, ' ').trim();
  if (!single) return '';
  if (single.length <= TODO_COMMENT_LABEL_MAX) return single;
  return `${single.slice(0, TODO_COMMENT_LABEL_MAX - 1)}…`;
}

function leadingSpacesForTodoCommentDepth(depth: number): string {
  return ' '.repeat(Math.max(0, depth) * TODO_COMMENT_DEPTH_SPACES);
}

/**
 * The ignore tag: the **top-level** rem titled exactly `Rem2Tex-ignore` (the toggle command creates
 * it there). Tagging a rem with it hides the rem and its subtree from every export.
 */
export const REM2TEX_IGNORE_TAG = 'Rem2Tex-ignore';

/**
 * Ids of every rem tagged with the top-level `Rem2Tex-ignore` rem, fetched once per conversion via
 * the tag's reverse lookup (`taggedRem`). `undefined` when no such tag rem exists — then no
 * per-rem check happens at all, so authors who never use the tag pay nothing.
 */
async function loadIgnoredRemIds(plugin: ReactRNPlugin): Promise<Set<string> | undefined> {
  try {
    const tagRem = await findIgnoreTagRem(plugin);
    if (!tagRem) return undefined;
    return new Set((await tagRem.taggedRem()).map((rem) => rem._id));
  } catch {
    return undefined;
  }
}

/**
 * A rem tagged `Rem2Tex-ignore` is skipped together with its whole subtree, in every todo mode and
 * wherever it sits (body, todo/comment trees, Preamble/End descendants). Skips are listed in the
 * log. Membership comes from `context.ignoredRemIds` (see `loadIgnoredRemIds`) — no SDK call here.
 */
async function isIgnoredRem(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<boolean> {
  if (!context.ignoredRemIds?.has(rem._id)) return false;
  if (context.log) {
    const title = flattenRawTitleText(rem.text).trim() || (await getRemTitle(plugin, rem, context)).trim() || '(untitled)';
    let path: string | undefined;
    try {
      path = (await getRelativeSourceRemHierarchy(plugin, rem, context))?.join(' > ');
    } catch {
      path = undefined;
    }
    context.log.ignored(`"${title}"${path && path !== title ? ` (${path})` : ''}`);
  }
  return true;
}

/** The KB's canonical `Rem2Tex-ignore` tag rem: the TOP-LEVEL one, which is what exports honour. */
export async function findIgnoreTagRem(plugin: ReactRNPlugin): Promise<Rem | undefined> {
  return plugin.rem.findByName([REM2TEX_IGNORE_TAG], null);
}

/**
 * Add the `Rem2Tex-ignore` tag to `rem` (creating the tag rem on first use) or remove it when it is
 * already there. Backs the "Toggle Rem2Tex-ignore" command so the tag name need not be remembered.
 * Add-vs-remove is decided against the SAME rem exports honour (the top-level tag), so the toast can
 * never claim a rem "exports again" when a look-alike tag nested elsewhere never hid it.
 */
export async function toggleIgnoreTag(plugin: ReactRNPlugin, rem: Rem): Promise<'added' | 'removed'> {
  const canonical = await findIgnoreTagRem(plugin);
  if (canonical) {
    const tagged = (await rem.getTagRems()).some((tag) => tag._id === canonical._id);
    if (tagged) {
      await rem.removeTag(canonical._id);
      return 'removed';
    }
    await rem.addTag(canonical);
    return 'added';
  }
  // No top-level tag rem yet: create it, so later exports (and this command) can find it by name.
  const created = await plugin.rem.createRem();
  if (!created) {
    throw new Error(`Could not create the "${REM2TEX_IGNORE_TAG}" tag rem.`);
  }
  await created.setText([REM2TEX_IGNORE_TAG]);
  await rem.addTag(created);
  return 'added';
}

/**
 * A rem whose text begins with `%` (and is not a code block) is a LaTeX comment, exported like a
 * todo: verbatim, with its subtree as an indented comment tree. Decided from the raw rich text, so
 * it costs no lookups; a leading pin/reference means "not a comment".
 */
function isCommentRem(rem: Rem): boolean {
  const elements: unknown[] = Array.isArray(rem.text) ? rem.text : [];
  for (const element of elements) {
    if (typeof element === 'string') {
      if (!element.trim()) continue;
      return element.trimStart().startsWith('%');
    }
    if (element && typeof element === 'object') {
      const entry = element as Record<string, unknown>;
      if ((entry.i === 'm' || entry.i === undefined) && typeof entry.text === 'string') {
        if (!entry.text.trim()) continue;
        if (isCodeTextElement(entry)) return false;
        return entry.text.trimStart().startsWith('%');
      }
    }
    return false;
  }
  return false;
}

/**
 * The comment line(s) for a `%` rem: pins resolve as in todo comments, nothing is LaTeX-escaped,
 * and every line of a multi-line text carries its own `%`.
 */
async function commentRemLines(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<string> {
  const text = (
    await richTextToString(plugin, rem.text, {
      hierarchyRemIds: context.hierarchyRemIds,
      todoContentResolvePinsAsText: true,
      log: context.log,
    })
  ).replace(/\\cite\{Status\}/gi, '');
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line, index) => index === 0 || line.length > 0)
    .map((line) => (line.startsWith('%') ? line : `% ${line}`));
  return lines.length > 0 ? lines.join('\n') : '%';
}

/** Push a (possibly multi-line) `%` comment with `depth` leading spaces before each `%`. */
function emitIndentedCommentBlock(output: string[], raw: string, depth: number): void {
  const lead = leadingSpacesForTodoCommentDepth(depth);
  for (const line of raw.split(/\r?\n/)) {
    const rest = line.startsWith('%') ? line.slice(1) : line;
    output.push(`${lead}%${rest}`);
  }
}

/** Emit direct children of a todo / `%` comment rem as indented `%` comment lines and recurse. */
async function emitTodoChildrenAsCommentTree(
  plugin: ReactRNPlugin,
  parentRem: Rem,
  output: string[],
  context: Rem2TexConversionContext,
  depth: number
): Promise<void> {
  const children = await parentRem.getChildrenRem();
  const lead = leadingSpacesForTodoCommentDepth(depth);
  for (const child of children) {
    if (await isTodoHeadingMetadataChild(child)) {
      continue;
    }
    if (context.skipRemSubtreeIds?.has(child._id)) {
      continue;
    }
    // Rem2Tex's own exports are never comment-tree content either (a paragraph export under a
    // todo would otherwise be re-emitted, and grow, on every run).
    if (isRem2TexOutputRem(child)) {
      if (context.log) context.log.counts.outputRemsSkipped += 1;
      continue;
    }
    if (await isIgnoredRem(plugin, child, context)) {
      continue;
    }
    const childIsHeading = (await child.getFontSize()) !== undefined;
    const childIsTodo = await child.isTodo();
    if (childIsTodo && !childIsHeading) {
      if (await shouldExportTodoAsComment(child, context)) {
        if (context.log) context.log.counts.todoComments += 1;
        emitIndentedCommentBlock(output, await todoComment(plugin, child, context), depth);
        await emitTodoChildrenAsCommentTree(plugin, child, output, context, depth + 1);
      } else {
        await noteSkippedTodo(plugin, child, context);
      }
    } else if (!childIsHeading && isCommentRem(child)) {
      if (context.log) context.log.counts.commentRems += 1;
      emitIndentedCommentBlock(output, await commentRemLines(plugin, child, context), depth);
      await emitTodoChildrenAsCommentTree(plugin, child, output, context, depth + 1);
    } else {
      const label = await getCommentTreeLabel(plugin, child, context);
      if (label.length > 0) {
        output.push(`${lead}%  - ${label}`);
      }
      await emitTodoChildrenAsCommentTree(plugin, child, output, context, depth + 1);
    }
  }
}

async function getRemBodyText(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<{ text: string; fromCodeBlock: boolean }> {
  const codeText = await richTextToString(plugin, rem.text, { codeOnly: true });
  const plainText = await richTextToString(plugin, rem.text, {
    hierarchyRemIds: context.hierarchyRemIds,
    log: context.log,
  });

  // Only treat content as raw code when the code-only extraction matches
  // the full text extraction (modulo known metadata label lines). This avoids
  // dropping inline LaTeX/citation fragments in normal prose rems.
  const normalizeForCodeComparison = (value: string): string =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !isCodeMetadataArtifactLine(line))
      .join('\n');

  const normalizedCode = normalizeForCodeComparison(codeText);
  const normalizedPlain = normalizeForCodeComparison(plainText);

  if (normalizedCode && normalizedCode === normalizedPlain) {
    return { text: codeText, fromCodeBlock: true };
  }
  return { text: plainText, fromCodeBlock: false };
}

/**
 * Attach "where it failed" context (the rem being converted, its outline location, hierarchy path
 * and text preview) to an error thrown while serialising that rem. A `Rem2TexConversionError` only
 * gets its missing fields filled, so the innermost rem wins; anything else (an SDK failure, a bug)
 * is wrapped as `REM_CONVERSION_FAILED` so the popup can still point at the rem.
 */
async function enrichConversionErrorWithSourceRem(
  plugin: ReactRNPlugin,
  error: unknown,
  rem: Rem,
  context: Rem2TexConversionContext,
  location?: Rem2TexOutlineLocation
): Promise<Rem2TexConversionError> {
  const existing = isRem2TexConversionError(error) ? error : undefined;
  // An error that already names a rem is final: filling its *missing* fields from an enclosing rem
  // would mix identities (title of the parent next to the id of the child, for a child whose own
  // title is empty). Only the outline location may still be added.
  if (existing && existing.sourceRemId) {
    if (existing.location || !location) return existing;
    return new Rem2TexConversionError({
      code: existing.code,
      headline: existing.headline,
      whatHappened: existing.whatHappened,
      technicalDetail: existing.technicalDetail,
      location,
      sourceRemId: existing.sourceRemId,
      sourceRemTextPreview: existing.sourceRemTextPreview,
      sourceRemTitle: existing.sourceRemTitle,
      sourceRemHierarchy: existing.sourceRemHierarchy,
      hints: existing.hints,
    });
  }

  // Never let the diagnostics themselves throw: the original failure is what matters.
  let fallbackTitle: string | undefined = flattenRawTitleText(rem.text).trim() || undefined;
  if (!fallbackTitle) {
    try {
      fallbackTitle = (await getRemTitle(plugin, rem, context)).trim() || undefined;
    } catch {
      fallbackTitle = undefined;
    }
  }
  const fallbackExcerpt = truncateDiagnosticPreview(
    sanitizeDiagnosticExcerpt(buildDiagnosticRemTextPreview(rem.text))
  );
  let fallbackHierarchy: string[] | undefined;
  try {
    fallbackHierarchy = await getRelativeSourceRemHierarchy(plugin, rem, context);
  } catch {
    fallbackHierarchy = undefined;
  }

  if (existing) {
    return new Rem2TexConversionError({
      code: existing.code,
      headline: existing.headline,
      whatHappened: existing.whatHappened,
      technicalDetail: existing.technicalDetail,
      location: existing.location ?? location,
      sourceRemId: existing.sourceRemId ?? rem._id,
      sourceRemTextPreview: existing.sourceRemTextPreview ?? fallbackExcerpt,
      sourceRemTitle: existing.sourceRemTitle ?? fallbackTitle,
      sourceRemHierarchy: existing.sourceRemHierarchy ?? fallbackHierarchy,
      hints: existing.hints,
    });
  }

  const stack =
    error instanceof Error && typeof error.stack === 'string'
      ? error.stack.split('\n').slice(0, 6).join('\n')
      : undefined;
  return new Rem2TexConversionError({
    code: 'REM_CONVERSION_FAILED',
    headline: 'Rem2Tex hit an unexpected error while converting a rem',
    whatHappened: normalizeUnknownError(error),
    technicalDetail: stack,
    location,
    sourceRemId: rem._id,
    sourceRemTextPreview: fallbackExcerpt,
    sourceRemTitle: fallbackTitle,
    sourceRemHierarchy: fallbackHierarchy,
    hints: [
      'The "Source rem" above is the rem Rem2Tex was converting when this happened. Check it for unusual content (a broken reference, an odd embed) and retry.',
      'If it keeps failing there, copy the full report and share it when asking for help.',
    ],
  });
}

async function getRelativeSourceRemHierarchy(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<string[] | undefined> {
  const chain: Rem[] = [];
  let current: Rem | undefined = rem;
  while (current) {
    chain.unshift(current);
    if (context.rootRemId && current._id === context.rootRemId) break;
    if (!current.parent) break;
    current = await plugin.rem.findOne(current.parent);
  }

  let working = chain;
  if (
    context.rootRemId &&
    working.length > 0 &&
    working[0]._id === context.rootRemId
  ) {
    working = working.slice(1);
  }

  const parts: string[] = [];
  for (const item of working) {
    const label = flattenRawTitleText(item.text).trim() || (await getRemTitle(plugin, item, context)).trim();
    if (label.length > 0) {
      parts.push(label.length > 120 ? `${label.slice(0, 119)}…` : label);
    }
  }
  return parts.length > 0 ? parts : undefined;
}

function hasImageTokenInRichText(element: unknown): boolean {
  if (element === null || element === undefined) return false;

  if (Array.isArray(element)) {
    for (const child of element) {
      if (hasImageTokenInRichText(child)) return true;
    }
    return false;
  }

  if (typeof element === 'string') {
    return false;
  }

  if (typeof element !== 'object') return false;
  const entry = element as Record<string, unknown>;

  if (entry.i === 'i') {
    return true;
  }

  if (entry.textOfDeletedRem !== undefined) {
    return hasImageTokenInRichText(entry.textOfDeletedRem);
  }

  return false;
}

function inferMediaTypeFromLatex(codeText: string): 'figure' | 'table' | undefined {
  if (/\\begin\s*\{\s*figure\s*\}/.test(codeText)) return 'figure';
  if (/\\begin\s*\{\s*table\s*\}/.test(codeText)) return 'table';
  return undefined;
}

async function getMediaCodeBlocksFromImmediateChildren(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<{ blocks: string[]; nonMediaChildren: Rem[] }> {
  const hierarchyRemIds = context.hierarchyRemIds;
  const children = await rem.getChildrenRem();
  const blocks: string[] = [];
  const nonMediaChildren: Rem[] = [];

  for (const child of children) {
    if (await isBookkeepingRem(child)) continue;
    // The ignore tag hides a media child like any other rem (and is listed in the Log).
    if (await isIgnoredRem(plugin, child, context)) continue;
    let found = false;
    const fromText = await richTextToString(plugin, child.text, { codeOnly: true });
    const sanitizedFromText = fromText ? stripTrailingCodeMetadataArtifacts(fromText) : '';
    if (sanitizedFromText && inferMediaTypeFromLatex(sanitizedFromText)) {
      blocks.push(sanitizedFromText);
      found = true;
    }

    const fromBackText = await richTextToString(plugin, child.backText, { codeOnly: true });
    const sanitizedFromBackText = fromBackText ? stripTrailingCodeMetadataArtifacts(fromBackText) : '';
    if (sanitizedFromBackText && inferMediaTypeFromLatex(sanitizedFromBackText)) {
      blocks.push(sanitizedFromBackText);
      found = true;
    }

    // A figure/table environment pasted as plain text (no code block) still counts as media.
    if (!found) {
      const plain = await richTextToString(plugin, child.text, { hierarchyRemIds });
      if (plain && inferMediaTypeFromLatex(plain)) {
        blocks.push(plain);
        found = true;
      }
    }
    if (!found) nonMediaChildren.push(child);
  }

  return { blocks, nonMediaChildren };
}

/** Hierarchy path for a log line; never throws (diagnostics must not mask the export). */
async function safeHierarchyPath(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<string | undefined> {
  try {
    return (await getRelativeSourceRemHierarchy(plugin, rem, context))?.join(' > ');
  } catch {
    return undefined;
  }
}

function quoteTitles(rems: Rem[], max = 5): string {
  const titles = rems.slice(0, max).map((r) => `"${flattenRawTitleText(r.text).trim() || '(untitled)'}"`);
  if (rems.length > max) titles.push(`… and ${rems.length - max} more`);
  return titles.join(', ');
}

/** Count a todo skipped by the todo mode and warn when non-todo content vanishes with it. */
async function noteSkippedTodo(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<void> {
  const log = context.log;
  if (!log) return;
  log.counts.todosSkipped += 1;
  const lost: Rem[] = [];
  for (const descendant of await rem.getDescendants()) {
    if (await descendant.isTodo()) continue;
    if (await isBookkeepingRem(descendant)) continue;
    if (!flattenRawTitleText(descendant.text).trim()) continue;
    lost.push(descendant);
  }
  if (lost.length === 0) return;
  const title = flattenRawTitleText(rem.text).trim() || '(untitled)';
  let path: string | undefined;
  try {
    path = (await getRelativeSourceRemHierarchy(plugin, rem, context))?.join(' > ');
  } catch {
    path = undefined;
  }
  log.warn(
    `Todo "${title}"${path && path !== title ? ` (${path})` : ''} was skipped by the todo mode together with ${lost.length} non-todo descendant rem(s), now missing from the paper: ${quoteTitles(lost)}`
  );
}

function buildVisibleWarningBlock(message: string): string {
  const escapedMessage = message
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/_/g, '\\_')
    .replace(/%/g, '\\%')
    .replace(/&/g, '\\&')
    .replace(/#/g, '\\#')
    .replace(/\$/g, '\\$')
    .replace(/\^/g, '\\textasciicircum{}');

  return [
    '\\begin{center}',
    '\\fbox{\\begin{minipage}{0.95\\linewidth}',
    '\\textbf{REM2TEX WARNING}',
    '',
    escapedMessage,
    '\\end{minipage}}',
    '\\end{center}',
  ].join('\n');
}

function toOutlineLocation(
  sectionTitle?: string,
  subsectionTitle?: string
): Rem2TexOutlineLocation | undefined {
  if (subsectionTitle) return { section: sectionTitle ?? 'Unknown', subsection: subsectionTitle };
  if (sectionTitle) return { section: sectionTitle };
  return undefined;
}

async function serializeNode(
  plugin: ReactRNPlugin,
  rem: Rem,
  currentHeadingLevel: number,
  output: string[],
  context: Rem2TexConversionContext,
  currentSectionTitle?: string,
  currentSubsectionTitle?: string
): Promise<void> {
  if (context.skipRemSubtreeIds?.has(rem._id)) {
    return;
  }
  if (isRem2TexOutputRem(rem)) {
    if (context.log) context.log.counts.outputRemsSkipped += 1;
    return;
  }
  if (await isIgnoredRem(plugin, rem, context)) {
    return;
  }

  const headingStyle = await rem.getFontSize();
  const isHeading = headingStyle !== undefined;
  const isTodo = await rem.isTodo();
  // If a rem is both heading and todo, treat it as heading-only.
  if (isTodo && !isHeading) {
    if (await shouldExportTodoAsComment(rem, context)) {
      if (context.log) context.log.counts.todoComments += 1;
      output.push(await todoComment(plugin, rem, context));
      await emitTodoChildrenAsCommentTree(plugin, rem, output, context, 1);
    } else {
      await noteSkippedTodo(plugin, rem, context);
    }
    return;
  }

  const hasImageToken = hasImageTokenInRichText(rem.text) || hasImageTokenInRichText(rem.backText);
  if (hasImageToken) {
    const { blocks: mediaBlocks, nonMediaChildren } = await getMediaCodeBlocksFromImmediateChildren(
      plugin,
      rem,
      context
    );
    if (context.log && nonMediaChildren.length > 0) {
      const imageTitle = flattenRawTitleText(rem.text).trim() || '(image rem)';
      let path: string | undefined;
      try {
        path = (await getRelativeSourceRemHierarchy(plugin, rem, context))?.join(' > ');
      } catch {
        path = undefined;
      }
      context.log.warn(
        `Image rem "${imageTitle}"${path && path !== imageTitle ? ` (${path})` : ''}: ${nonMediaChildren.length} child rem(s) that are not figure/table blocks were not exported (only figure/table code blocks under an image rem are): ${quoteTitles(nonMediaChildren)}`
      );
    }
    if (mediaBlocks.length === 0) {
      const remTitle = await getRemTitle(plugin, rem, context);
      const warningText = remTitle
        ? `Image rem "${remTitle}" must include at least one child code block containing \\begin{figure} or \\begin{table}.`
        : 'Image rem must include at least one child code block containing \\begin{figure} or \\begin{table}.';
      if (context.log) {
        const path = (await getRelativeSourceRemHierarchy(plugin, rem, context))?.join(' > ');
        context.log.warn(`${warningText} A REM2TEX WARNING box was inserted instead.${path ? ` (at: ${path})` : ''}`);
      }
      output.push(buildVisibleWarningBlock(warningText));
      output.push('');
      return;
    }
    if (context.log) context.log.counts.mediaBlocks += mediaBlocks.length;
    for (const mediaBlock of mediaBlocks) {
      output.push(mediaBlock);
      output.push('');
    }
    return;
  }

  // A `%` rem is a LaTeX comment: emitted verbatim in outline order with its subtree as a comment
  // tree, exactly like a todo — in every todo mode, because the author wrote the `%` themselves.
  if (!isHeading && isCommentRem(rem)) {
    if (context.log) context.log.counts.commentRems += 1;
    output.push(await commentRemLines(plugin, rem, context));
    await emitTodoChildrenAsCommentTree(plugin, rem, output, context, 1);
    return;
  }

  const outlineLocation = toOutlineLocation(currentSectionTitle, currentSubsectionTitle);
  let titleResult: { text: string; fromCodeBlock: boolean };
  try {
    titleResult = await getRemBodyText(plugin, rem, context);
  } catch (error) {
    throw await enrichConversionErrorWithSourceRem(plugin, error, rem, context, outlineLocation);
  }
  let { text: title, fromCodeBlock } = titleResult;
  if (isHeading && isTodo) {
    // A todo heading carries RemNote's Status reference. `isBookkeepingRem` already drops it, but
    // strip any leftover `\cite{Status}` too — keeping the RESOLVED title so math and Zotero
    // citations inside a heading+todo survive (the raw text would discard them).
    const cleanedTitle = stripTodoCommentArtifactCitations(title);
    if (cleanedTitle !== title) {
      title = cleanedTitle;
      fromCodeBlock = false;
    }
    if (!title.trim()) {
      const rawTodoHeadingTitle = flattenRawTitleText(rem.text).trim();
      if (rawTodoHeadingTitle.length > 0) {
        title = rawTodoHeadingTitle;
        fromCodeBlock = false;
      }
    }
  }
  if (isHeading) {
    const headingLevel = Math.min(currentHeadingLevel + 1, HEADING_COMMANDS.length);
    const command = HEADING_COMMANDS[headingLevel - 1];
    if (title) {
      // Counted only when a sectioning command is actually emitted, so the Log matches the paper.
      if (context.log) context.log.counts.headings += 1;
      output.push(`\\${command}{${escapeLatex(title)}}`);
      output.push('');
    } else if (context.log) {
      const path = await safeHierarchyPath(plugin, rem, context);
      context.log.warn(
        `Heading rem with no title${path ? ` (${path})` : ''}: no \\${command} was emitted, but its children were exported.`
      );
    }

    const children = await rem.getChildrenRem();
    const nextSectionTitle = headingLevel === 1 ? title : currentSectionTitle;
    const nextSubsectionTitle =
      headingLevel === 1 ? undefined : headingLevel === 2 ? title : currentSubsectionTitle;
    for (const child of children) {
      if (isTodo && (await isTodoHeadingMetadataChild(child))) {
        continue;
      }
      try {
        await serializeNode(
          plugin,
          child,
          headingLevel,
          output,
          context,
          nextSectionTitle,
          nextSubsectionTitle
        );
      } catch (error) {
        throw await enrichConversionErrorWithSourceRem(
          plugin,
          error,
          child,
          context,
          toOutlineLocation(nextSectionTitle, nextSubsectionTitle)
        );
      }
    }
    return;
  }

  if (title) {
    if (context.log) {
      if (fromCodeBlock) context.log.counts.codeBlocks += 1;
      else context.log.counts.paragraphs += 1;
    }
    output.push(fromCodeBlock ? title : escapeLatex(title));
  }

  // Children in outline order (since 2026-09-03; todo children used to be hoisted above their
  // prose siblings). Todo and `%` comment lines sit tight under whatever precedes them; any other
  // child starts a new paragraph, i.e. gets a blank line before it.
  const children = await rem.getChildrenRem();
  let emittedAny = Boolean(title);
  for (const child of children) {
    // Everything about a child runs inside its own try, so any failure — reading its font size or
    // todo status, building its comment tree — is reported against THAT child, not this parent.
    try {
      if (await isIgnoredRem(plugin, child, context)) continue;
      const childIsHeading = (await child.getFontSize()) !== undefined;
      if ((await child.isTodo()) && !childIsHeading) {
        if (await shouldExportTodoAsComment(child, context)) {
          if (context.log) context.log.counts.todoComments += 1;
          output.push(await todoComment(plugin, child, context));
          await emitTodoChildrenAsCommentTree(plugin, child, output, context, 1);
          emittedAny = true;
        } else {
          await noteSkippedTodo(plugin, child, context);
        }
        continue;
      }
      const childIsComment = !childIsHeading && isCommentRem(child);
      if (!childIsComment && output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      await serializeNode(
        plugin,
        child,
        currentHeadingLevel,
        output,
        context,
        currentSectionTitle,
        currentSubsectionTitle
      );
      emittedAny = true;
    } catch (error) {
      throw await enrichConversionErrorWithSourceRem(plugin, error, child, context, outlineLocation);
    }
  }

  // Close the paragraph so the next sibling starts on its own.
  if (emittedAny && output.length > 0 && output[output.length - 1] !== '') {
    output.push('');
  }
}

async function getOrCreateRem2TexRoot(
  plugin: ReactRNPlugin,
  parent: Rem
): Promise<Rem> {
  const children = await parent.getChildrenRem();
  for (const child of children) {
    const childTitle = (flattenRawTitleText(child.text).trim() || (await getRemTitle(plugin, child)).trim());
    if (childTitle === 'Rem2Tex') {
      return child;
    }
  }

  const rem2TexRoot = await plugin.rem.createRem();
  if (!rem2TexRoot) {
    throw new Error('Failed to create Rem2Tex exports root rem.');
  }
  await rem2TexRoot.setText(['Rem2Tex']);
  await rem2TexRoot.setParent(parent);
  return rem2TexRoot;
}

const LOG_CODE_LANGUAGE = 'text';
const PAPER_REM_TITLE = 'Paper';
const LOG_REM_TITLE = 'Log';

/** A titled rem under `parent` holding one code-block child (`Paper` → latex, `Log` → text). */
async function createTitledCodeBlockRem(
  plugin: ReactRNPlugin,
  parent: Rem,
  title: string,
  code: string,
  language: string
): Promise<void> {
  const titledRem = await plugin.rem.createRem();
  if (!titledRem) {
    throw new Error(`Failed to create the "${title}" rem.`);
  }
  await titledRem.setText([title]);
  await titledRem.setParent(parent);

  const codeRem = await plugin.rem.createRem();
  if (!codeRem) {
    throw new Error(`Failed to create the "${title}" code block rem.`);
  }
  await codeRem.setParent(titledRem);
  await codeRem.setText(await plugin.richText.code(code, language).value());
}

/**
 * `Rem2Tex` folder (created once under the paper rem) → `Rem2Tex <timestamp>` export rem →
 * `Paper` rem with a `latex` code block child (omitted when the conversion failed) and `Log` rem
 * with a `text` code block child — titled rems so the two are told apart at a glance.
 */
async function createOutputRem(
  plugin: ReactRNPlugin,
  parent: Rem,
  latex: string | undefined,
  logText: string,
  startedAt: Date
): Promise<string> {
  const rem2TexRoot = await getOrCreateRem2TexRoot(plugin, parent);
  const outputTitle = `Rem2Tex ${toOutputTimestamp(startedAt)}`;
  const outputRem = await plugin.rem.createRem();
  if (!outputRem) {
    throw new Error('Failed to create output rem.');
  }
  await outputRem.setText([outputTitle]);
  await outputRem.setParent(rem2TexRoot);

  if (latex !== undefined) {
    await createTitledCodeBlockRem(plugin, outputRem, PAPER_REM_TITLE, latex, 'latex');
  }
  await createTitledCodeBlockRem(plugin, outputRem, LOG_REM_TITLE, logText, LOG_CODE_LANGUAGE);

  return outputTitle;
}

function describeTodoMode(mode: Rem2TexTodoExportMode): string {
  if (mode === 'none') return 'todos are not exported (a skipped todo takes its whole subtree with it)';
  if (mode === 'unfinished') return 'only unfinished todos are exported as % TODO comments';
  return 'all todos are exported as % TODO comments';
}

async function titlesForLog(plugin: ReactRNPlugin, rems: Rem[], context: Rem2TexConversionContext): Promise<string> {
  const MAX = 12;
  const LABEL_MAX = 120;
  const titles: string[] = [];
  for (const rem of rems.slice(0, MAX)) {
    // Fold and cap like every other log label: a top-level code block would otherwise dump its
    // whole multi-line text into the Log's structure line.
    const raw = (await getRemTitle(plugin, rem, context)).replace(/\s+/g, ' ').trim() || '(untitled)';
    titles.push(`"${raw.length > LABEL_MAX ? `${raw.slice(0, LABEL_MAX - 1)}…` : raw}"`);
  }
  if (rems.length > MAX) titles.push(`… and ${rems.length - MAX} more`);
  return titles.join(', ');
}

/**
 * Convert the paper and write `Rem2Tex/Rem2Tex <timestamp>/{Paper, Log}` under the paper rem.
 * Phase A (finding the paper) throws typed errors for the command to toast — nothing is written.
 * Phase B (boundary blocks, body) never throws: a failure is recorded in the Log block and the
 * export rem is written with only that Log; the result says which happened.
 */
export async function runRem2TexConversion(
  plugin: ReactRNPlugin,
  options?: Rem2TexRunOptions
): Promise<Rem2TexRunResult> {
  const log = new Rem2TexLog();
  const todoExportMode = options?.todoExportMode ?? 'all';

  // Phase A — find the paper.
  const focusedRem = options?.parentRem ?? (await getFocusedParentRem(plugin));
  const { paperRem, layout } = await resolvePaperRoot(plugin, focusedRem);

  const descendants = await paperRem.getDescendants();
  const context: Rem2TexConversionContext = {
    hierarchyRemIds: new Set([paperRem._id, ...descendants.map((rem) => rem._id)]),
    rootRemId: paperRem._id,
    todoExportMode,
    log,
    ignoredRemIds: await loadIgnoredRemIds(plugin),
  };

  const paperTitle = (await getRemTitle(plugin, paperRem, context)).trim() || '(untitled)';
  log.section('Setup');
  log.info(`Command: ${options?.commandLabel ?? 'Convert Paper to TeX'}`);
  log.info(`Todo mode: ${describeTodoMode(todoExportMode)}`);
  if (focusedRem._id === paperRem._id) {
    log.info(`Paper rem: "${paperTitle}"`);
  } else {
    const focusedTitle = (await getRemTitle(plugin, focusedRem, context)).trim() || '(untitled)';
    log.info(`Paper rem: "${paperTitle}" (command started on its child "${focusedTitle}")`);
  }

  log.section('Structure');
  const childCount =
    layout.ignoredBefore.length + layout.bodyRems.length + layout.ignoredAfter.length + 2;
  log.info(
    `Children of the paper rem: ${childCount}; "${REQUIRED_PREAMBLE_NAME}" is child ${layout.ignoredBefore.length + 1}, "${REQUIRED_END_NAME}" is child ${layout.ignoredBefore.length + layout.bodyRems.length + 2}`
  );
  log.info(`Body rems (${layout.bodyRems.length}): ${await titlesForLog(plugin, layout.bodyRems, context)}`);
  if (layout.ignoredBefore.length > 0) {
    log.info(
      `Ignored before ${REQUIRED_PREAMBLE_NAME} (${layout.ignoredBefore.length}): ${await titlesForLog(plugin, layout.ignoredBefore, context)}`
    );
  }
  if (layout.ignoredAfter.length > 0) {
    log.info(
      `Ignored after ${REQUIRED_END_NAME} (${layout.ignoredAfter.length}): ${await titlesForLog(plugin, layout.ignoredAfter, context)}`
    );
  }

  // Phase B — convert. Never throws; failures go into the log.
  let latex: string | undefined;
  let failure: unknown;
  try {
    log.section('Conversion');
    const preamble = await getBoundaryBlock(plugin, layout.preambleRem, REQUIRED_PREAMBLE_NAME, context);
    const meta = parsePreambleLatexMetadata(preamble);
    log.info(
      `${REQUIRED_PREAMBLE_NAME} block: ${preamble.split('\n').length} line(s)${meta.documentClass ? `, \\documentclass{${meta.documentClass}}` : ''}`
    );
    if (meta.title) log.info(`Title: ${meta.title}`);
    if (meta.author) log.info(`Author(s): ${meta.author}`);

    const endBlock = await getBoundaryBlock(plugin, layout.endRem, REQUIRED_END_NAME, context);
    log.info(`${REQUIRED_END_NAME} block: ${endBlock.split('\n').length} line(s)`);

    const bodyLines: string[] = [];
    for (const bodyRem of layout.bodyRems) {
      try {
        await serializeNode(plugin, bodyRem, 0, bodyLines, context, undefined, undefined);
      } catch (error) {
        throw await enrichConversionErrorWithSourceRem(plugin, error, bodyRem, context);
      }
    }
    const body = bodyLines.join('\n').trim();
    log.info(`Body: ${body.split('\n').length} line(s) of LaTeX from ${layout.bodyRems.length} top-level rem(s)`);

    const outputLines = [preamble.trim(), '', body, '', endBlock.trim()].filter(
      (_line, index, lines) => !(index > 0 && lines[index - 1] === '' && lines[index] === '')
    );
    latex = outputLines.join('\n').trim();
  } catch (error) {
    failure = error;
  }

  const logText =
    failure !== undefined || latex === undefined
      ? log.toText({ status: 'failed', error: failure })
      : log.toText({ status: 'success', latexLineCount: latex.split('\n').length });
  const outputTitle = await createOutputRem(plugin, paperRem, latex, logText, log.startedAt);

  if (failure !== undefined || latex === undefined) {
    return {
      status: 'failed',
      outputTitle,
      warningCount: log.warnings.length,
      errorCode: isRem2TexConversionError(failure) ? failure.code : 'EXPORT_FAILED',
      errorHeadline: isRem2TexConversionError(failure) ? failure.headline : normalizeUnknownError(failure),
    };
  }
  return { status: 'success', outputTitle, warningCount: log.warnings.length };
}

/**
 * Serialize a single rem subtree (same rules as paper body conversion). Finished and unfinished
 * todos are always emitted as `% TODO …` comments. Writes a new export (titled rem + LaTeX code
 * child) under the source rem; prior `Rem2Tex paragraph …` exports are not re-included in output.
 */
export async function runParagraphToTexConversion(
  plugin: ReactRNPlugin,
  options?: Rem2TexParagraphRunOptions
): Promise<string> {
  try {
    const paragraphRem = options?.paragraphRem ?? (await getFocusedParentRem(plugin));
    const descendants = await paragraphRem.getDescendants();
    const skipRemSubtreeIds = await collectParagraphExportSkipRemIds(paragraphRem);
    const context: Rem2TexConversionContext = {
      hierarchyRemIds: new Set([paragraphRem._id, ...descendants.map((r) => r._id)]),
      rootRemId: paragraphRem._id,
      todoExportMode: 'all',
      skipRemSubtreeIds,
      ignoredRemIds: await loadIgnoredRemIds(plugin),
    };

    const lines: string[] = [];
    try {
      await serializeNode(plugin, paragraphRem, 0, lines, context, undefined, undefined);
    } catch (error) {
      throw await enrichConversionErrorWithSourceRem(plugin, error, paragraphRem, context);
    }

    const latex = lines.join('\n').trim();
    if (!latex) {
      // Writing an empty code block and toasting success hides the reason (the focused rem is
      // Rem2Tex's own output, is ignore-tagged, or simply has nothing to export).
      const title = flattenRawTitleText(paragraphRem.text).trim() || '(untitled)';
      const reason = isRem2TexOutputRem(paragraphRem)
        ? `"${title}" is one of Rem2Tex's own export rems, which are never exported again.`
        : context.ignoredRemIds?.has(paragraphRem._id)
          ? `"${title}" carries the ${REM2TEX_IGNORE_TAG} tag, so it and its subtree are skipped.`
          : `"${title}" and its descendants produced no LaTeX (empty rem, or everything under it is skipped).`;
      throw new Rem2TexConversionError({
        code: 'NOTHING_TO_EXPORT',
        headline: 'Nothing to export',
        whatHappened: reason,
        sourceRemId: paragraphRem._id,
        sourceRemTitle: title,
        hints: [
          `Run the command on a rem with content; remove the ${REM2TEX_IGNORE_TAG} tag if you meant to export this one.`,
        ],
      });
    }
    return createParagraphLatexExport(plugin, paragraphRem, latex);
  } catch (error) {
    if (isRem2TexConversionError(error)) {
      throw error;
    }
    throw new Error(normalizeUnknownError(error));
  }
}
