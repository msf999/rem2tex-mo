import type { ReactRNPlugin, Rem } from '@remnote/plugin-sdk';

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
};

/** Session key for Rem2Tex popup progress UI (`rem2tex_progress.tsx`). */
export const REM2TEX_PROGRESS_STORAGE_KEY = 'rem2tex_progress_ui_v5';

export const REM2TEX_PROGRESS_TOTAL = 5;

/** Human-readable lines for completed pipeline steps before the current `step` (1-based). */
export function buildCompletedProgressLines(step: number): string[] {
  const lines: string[] = [];
  if (step >= 2) lines.push('✓ Validated paper structure (Preamble / End).');
  if (step >= 3) lines.push('✓ Read Preamble block.');
  if (step >= 4) lines.push('✓ Read End block.');
  if (step >= 5) lines.push('✓ Converted body to LaTeX.');
  if (step >= 6) lines.push('✓ Created export rem.');
  return lines;
}

/** Best-effort `\title`, `\author`, `\documentclass{…}` from raw preamble text. */
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

export type Rem2TexProgressUiState =
  | {
      phase: 'running';
      step: number;
      total: number;
      label: string;
      paperRemTitle?: string;
      startedAtIso?: string;
      preambleTitle?: string;
      preambleAuthor?: string;
      todoExportMode?: Rem2TexTodoExportMode;
      progressLog: string[];
    }
  | {
      phase: 'success';
      outputTitle: string;
      paperRemTitle?: string;
      preambleTitle?: string;
      preambleAuthor?: string;
      todoExportMode?: Rem2TexTodoExportMode;
      progressLog: string[];
    }
  | {
      phase: 'error';
      /** Full plain-text report for “Copy report” */
      message: string;
      headline: string;
      errorCode: string;
      whatHappened: string;
      technicalDetail?: string;
      location?: { section?: string; subsection?: string };
      linkedRemId?: string;
      /** Referenced rem that is missing \\label (when known). */
      pinTargetRemTitle?: string;
      pinTargetRemHierarchy?: string[];
      pinTargetRemTextPreview?: string;
      /** Rem whose text contained the pin (paragraph / block being exported). */
      sourceRemId?: string;
      /** Plain-text-style preview; pins shown as ⟨pin⟩, no async resolution. */
      sourceRemTextPreview?: string;
      /** Outline / card title for the source rem (helps when preview is only ⟨pin⟩). */
      sourceRemTitle?: string;
      /** Hierarchy path from paper root to source rem (excluding root). */
      sourceRemHierarchy?: string[];
      hints: string[];
      paperRemTitle?: string;
      preambleTitle?: string;
      preambleAuthor?: string;
      todoExportMode?: Rem2TexTodoExportMode;
      /** Steps that finished before the failure. */
      progressLog?: string[];
      /** Current step label when the export stopped (e.g. converting body). */
      failedAtLabel?: string;
    };

export type Rem2TexPinLocation = {
  section?: string;
  subsection?: string;
};

export type Rem2TexConversionErrorOptions = {
  code: string;
  headline: string;
  whatHappened: string;
  technicalDetail?: string;
  location?: Rem2TexPinLocation;
  linkedRemId?: string;
  /** Referenced rem that is missing \\label (when known). */
  pinTargetRemTitle?: string;
  pinTargetRemHierarchy?: string[];
  pinTargetRemTextPreview?: string;
  sourceRemId?: string;
  sourceRemTextPreview?: string;
  /** Display title of the rem that contained the pin (may differ from preview text). */
  sourceRemTitle?: string;
  /** Hierarchy path from paper root to source rem (excluding root). */
  sourceRemHierarchy?: string[];
  hints?: string[];
};

/** Thrown for user-fixable export issues (pins, structure, etc.); preserved through `runRem2TexConversion`. */
export class Rem2TexConversionError extends Error {
  readonly code: string;
  readonly headline: string;
  readonly whatHappened: string;
  readonly technicalDetail?: string;
  readonly location?: Rem2TexPinLocation;
  readonly linkedRemId?: string;
  readonly pinTargetRemTitle?: string;
  readonly pinTargetRemHierarchy?: string[];
  readonly pinTargetRemTextPreview?: string;
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
    this.linkedRemId = opts.linkedRemId;
    this.pinTargetRemTitle = opts.pinTargetRemTitle;
    this.pinTargetRemHierarchy = opts.pinTargetRemHierarchy;
    this.pinTargetRemTextPreview = opts.pinTargetRemTextPreview;
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

function parseTrailingLocationFromMessage(message: string): {
  cleaned: string;
  location?: Rem2TexPinLocation;
} {
  const re =
    /\s+at\s+section\s+"([^"]+)"(?:\s*,\s*subsection\s+"([^"]+)")?\s*\.?\s*$/;
  const m = message.match(re);
  if (!m) return { cleaned: message };
  return {
    cleaned: message.replace(re, '').trim(),
    location: { section: m[1], subsection: m[2] },
  };
}

function heuristicHintsForPlainError(cleanedMessage: string): string[] {
  const hints: string[] = [];
  const m = cleanedMessage;
  if (/Preamble/i.test(m)) {
    hints.push('The first child of your paper rem must be named exactly `Preamble` (capital P).');
  }
  if (/\bEnd\b/i.test(m) && /Preamble/i.test(m)) {
    hints.push('Add an `End` rem somewhere after `Preamble` (not necessarily last) so Rem2Tex knows where the body stops.');
  }
  if (/focused rem|No focused rem/i.test(m)) {
    hints.push('Click the paper root rem so it is focused, or select it, then run `/rem2tex` again.');
  }
  if (/empty/i.test(m) && /Preamble|End/i.test(m)) {
    hints.push('Put the LaTeX in a child code block under the boundary rem (or paste plain text if you have no code block).');
  }
  if (hints.length === 0) {
    hints.push('Fix the issue described above and run Rem2Tex again. If the message is unclear, copy the full report and share it when asking for help.');
  }
  return hints;
}

export type Rem2TexProgressErrorContext = {
  paperRemTitle?: string;
  preambleTitle?: string;
  preambleAuthor?: string;
  todoExportMode?: Rem2TexTodoExportMode;
  progressLog?: string[];
  failedAtLabel?: string;
};

/** Builds session payload for the progress popup from any thrown value. */
export function buildProgressErrorState(
  error: unknown,
  context?: Rem2TexProgressErrorContext
): Extract<Rem2TexProgressUiState, { phase: 'error' }> {
  if (isRem2TexConversionError(error)) {
    const e = error;
    const message = buildClipboardReportFromConversionError(e, context);
    return {
      phase: 'error',
      message,
      headline: e.headline,
      errorCode: e.code,
      whatHappened: e.whatHappened,
      technicalDetail: e.technicalDetail,
      location: e.location,
      linkedRemId: e.linkedRemId,
      pinTargetRemTitle: e.pinTargetRemTitle,
      pinTargetRemHierarchy: e.pinTargetRemHierarchy,
      pinTargetRemTextPreview: e.pinTargetRemTextPreview,
      sourceRemId: e.sourceRemId,
      sourceRemTextPreview: e.sourceRemTextPreview,
      sourceRemTitle: e.sourceRemTitle,
      sourceRemHierarchy: e.sourceRemHierarchy,
      hints: e.hints.length > 0 ? e.hints : heuristicHintsForPlainError(e.whatHappened),
      paperRemTitle: context?.paperRemTitle,
      preambleTitle: context?.preambleTitle,
      preambleAuthor: context?.preambleAuthor,
      todoExportMode: context?.todoExportMode,
      progressLog: context?.progressLog,
      failedAtLabel: context?.failedAtLabel,
    };
  }

  const raw = normalizeUnknownError(error);
  const { cleaned, location } = parseTrailingLocationFromMessage(raw);
  const hints = heuristicHintsForPlainError(cleaned);
  const message = buildClipboardReportPlain(cleaned, location, context);

  return {
    phase: 'error',
    message,
    headline: 'Rem2Tex could not finish the export',
    errorCode: 'EXPORT_FAILED',
    whatHappened: cleaned,
    technicalDetail: location ? undefined : cleaned.trim() !== raw.trim() ? raw : undefined,
    location,
    hints,
    paperRemTitle: context?.paperRemTitle,
    preambleTitle: context?.preambleTitle,
    preambleAuthor: context?.preambleAuthor,
    todoExportMode: context?.todoExportMode,
    progressLog: context?.progressLog,
    failedAtLabel: context?.failedAtLabel,
  };
}

function buildClipboardReportFromConversionError(
  e: Rem2TexConversionError,
  ctx?: Rem2TexProgressErrorContext
): string {
  const formatHierarchyForReport = (hierarchy: string[] | undefined): string | undefined => {
    if (!hierarchy || hierarchy.length === 0) return undefined;
    const rootTitle = ctx?.paperRemTitle?.trim();
    if (!rootTitle) return hierarchy.join(' > ');
    const idx = hierarchy.findIndex((part) => part.trim() === rootTitle);
    const relative = idx >= 0 ? hierarchy.slice(idx + 1) : hierarchy;
    if (relative.length === 0) return '(paper root)';
    return relative.join(' > ');
  };

  const lines: string[] = [
    'Rem2Tex export error',
    '===================',
    '',
    `Code: ${e.code}`,
    `Summary: ${e.headline}`,
    '',
    e.whatHappened,
  ];
  if (ctx?.progressLog && ctx.progressLog.length > 0) {
    lines.push('', 'Progress before failure:');
    for (const row of ctx.progressLog) lines.push(`  ${row}`);
  }
  if (ctx?.failedAtLabel) {
    lines.push('', `Failed during: ${ctx.failedAtLabel}`);
  }
  if (ctx?.preambleTitle || ctx?.preambleAuthor) {
    lines.push('', 'From preamble:');
    if (ctx.preambleTitle) lines.push(`  Title: ${ctx.preambleTitle}`);
    if (ctx.preambleAuthor) lines.push(`  Author(s): ${ctx.preambleAuthor}`);
  }
  if (e.technicalDetail) {
    lines.push('', 'Technical:', e.technicalDetail);
  }
  if (e.location?.section || e.location?.subsection) {
    lines.push('', 'Location in outline:');
    if (e.location.section) lines.push(`  Section: ${e.location.section}`);
    if (e.location.subsection) lines.push(`  Subsection: ${e.location.subsection}`);
  }
  if (e.linkedRemId) {
    lines.push('', `Linked pin target rem id (reference): ${e.linkedRemId}`);
  }
  if (e.pinTargetRemTitle || e.pinTargetRemHierarchy || e.pinTargetRemTextPreview) {
    lines.push('', 'Referenced rem missing \\label:');
    if (e.pinTargetRemTitle) lines.push(`  Rem title: ${e.pinTargetRemTitle}`);
    const targetHierarchy = formatHierarchyForReport(e.pinTargetRemHierarchy);
    if (targetHierarchy) {
      lines.push(`  Hierarchy: ${targetHierarchy}`);
    }
    if (e.pinTargetRemTextPreview) {
      lines.push('  Text preview:');
      lines.push(`  ${e.pinTargetRemTextPreview.replace(/\n/g, ' ')}`);
    }
  }
  if (e.sourceRemId || e.sourceRemTextPreview || e.sourceRemTitle) {
    lines.push('', 'Source rem (where export failed):');
    if (e.sourceRemTitle) lines.push(`  Rem title: ${e.sourceRemTitle}`);
    const sourceHierarchy = formatHierarchyForReport(e.sourceRemHierarchy);
    if (sourceHierarchy) {
      lines.push(`  Hierarchy: ${sourceHierarchy}`);
    }
    if (e.sourceRemId) lines.push(`  Rem id: ${e.sourceRemId}`);
    if (e.sourceRemTextPreview) {
      lines.push('  Text preview (pins shown as ⟨pin⟩):');
      lines.push(`  ${e.sourceRemTextPreview.replace(/\n/g, ' ')}`);
    }
  }
  if (e.hints.length > 0) {
    lines.push('', 'Suggestions:');
    for (const h of e.hints) lines.push(`  • ${h}`);
  }
  if (ctx?.paperRemTitle) {
    lines.push('', `Paper rem title: ${ctx.paperRemTitle}`);
  }
  return lines.join('\n');
}

function buildClipboardReportPlain(
  cleaned: string,
  location: Rem2TexPinLocation | undefined,
  ctx?: Rem2TexProgressErrorContext
): string {
  const lines = ['Rem2Tex export error', '===================', '', cleaned];
  if (ctx?.progressLog && ctx.progressLog.length > 0) {
    lines.push('', 'Progress before failure:');
    for (const row of ctx.progressLog) lines.push(`  ${row}`);
  }
  if (ctx?.failedAtLabel) {
    lines.push('', `Failed during: ${ctx.failedAtLabel}`);
  }
  if (ctx?.preambleTitle || ctx?.preambleAuthor) {
    lines.push('', 'From preamble:');
    if (ctx.preambleTitle) lines.push(`  Title: ${ctx.preambleTitle}`);
    if (ctx.preambleAuthor) lines.push(`  Author(s): ${ctx.preambleAuthor}`);
  }
  if (location?.section || location?.subsection) {
    lines.push('', 'Location in outline:');
    if (location.section) lines.push(`  Section: ${location.section}`);
    if (location.subsection) lines.push(`  Subsection: ${location.subsection}`);
  }
  if (ctx?.paperRemTitle) {
    lines.push('', `Paper rem title: ${ctx.paperRemTitle}`);
  }
  return lines.join('\n');
}

export type Rem2TexRunOptions = {
  parentRem?: Rem;
  todoExportMode?: Rem2TexTodoExportMode;
  onProgress?: (step: number, total: number, label: string) => void | Promise<void>;
};

async function notifyConversionProgress(
  options: Rem2TexRunOptions | undefined,
  step: number,
  label: string
): Promise<void> {
  if (options?.onProgress) {
    await options.onProgress(step, REM2TEX_PROGRESS_TOTAL, label);
  }
}

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
  hierarchyRemIds?: Set<string>;
  rootRemId?: string;
  suppressExternalCitationWrap?: boolean;
  /** Where the pin appears in the paper outline (for error reporting). */
  pinLocation?: Rem2TexPinLocation;
  /** Rem id for the paragraph/block whose text is being flattened (pin source). */
  pinSourceRemId?: string;
  /** Snapshot for errors: same rem’s text with ⟨pin⟩ placeholders, no async lookups. */
  pinSourceRemExcerpt?: string;
  /** Card/outline title for the rem that contains the pin (for errors when preview is only ⟨pin⟩). */
  pinSourceRemTitle?: string;
  /** When flattening a TODO rem's text, pins to other TODO rems should show linked text, not be dropped. */
  todoContentResolvePinsAsText?: boolean;
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

/** Avoid attributing paragraph diagnostics to nested flattens (linked rem text, document titles). */
function omitPinSourceDiagnostics(o: FlattenOptions): FlattenOptions {
  return { ...o, pinSourceRemId: undefined, pinSourceRemExcerpt: undefined };
}

function isCodeTextElement(entry: Record<string, unknown>): boolean {
  return entry.code === true || typeof entry.language === 'string';
}

function toLatexCitation(referenceText: string): string {
  const trimmed = referenceText.trim();
  if (!trimmed) return '';
  if (isQueryLikeTitle(trimmed)) return '';
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

    output += `\\cite{${aggregatedKeys.join(', ')}}`;
    output += text.slice(matches[i].end, groupEnd).replace(/[^\s]/g, '');
    cursor = groupEnd;
    i = j;
  }

  output += text.slice(cursor);
  return output;
}

function isQueryLikeTitle(title: string): boolean {
  const normalized = title.trim().toLowerCase();
  if (normalized.startsWith('query:')) return true;
  if (normalized.length > 120 && normalized.includes(' ')) return true;
  return false;
}

async function getFirstDocumentAncestor(rem: Rem, plugin: ReactRNPlugin): Promise<Rem | undefined> {
  let cursor: Rem | undefined = rem;
  let fallbackDocument: Rem | undefined;
  while (cursor) {
    if (await cursor.isDocument()) {
      const title = (await richTextToString(plugin, cursor.text)).trim();
      if (!isQueryLikeTitle(title)) {
        return cursor;
      }
      fallbackDocument = cursor;
    }
    cursor = await cursor.getParentRem();
  }
  return fallbackDocument;
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

async function getCitationKeyFromDocumentAncestor(
  plugin: ReactRNPlugin,
  rem: Rem,
  options: FlattenOptions,
  seenRemIds: Set<string>,
  depth: number
): Promise<string> {
  const documentAncestor = (await getFirstDocumentAncestor(rem, plugin)) ?? rem;
  const resolvedTitleText = (
    await flattenRichTextElement(
      plugin,
      documentAncestor.text,
      { ...omitPinSourceDiagnostics(options), suppressExternalCitationWrap: true },
      new Set(seenRemIds),
      depth + 1
    )
  ).trim();
  if (resolvedTitleText && !isQueryLikeTitle(resolvedTitleText)) {
    return resolvedTitleText;
  }

  const rawTitleText = flattenRawTitleText(documentAncestor.text).trim();
  if (rawTitleText && !isQueryLikeTitle(rawTitleText)) {
    return rawTitleText;
  }

  return `doc_${documentAncestor._id}`;
}

async function flattenRichTextElement(
  plugin: ReactRNPlugin,
  element: unknown,
  options: FlattenOptions = {},
  seenRemIds: Set<string> = new Set(),
  depth = 0
): Promise<string> {
  if (depth > 12) return '';
  if (typeof element === 'string') return element;
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

  // Resolve Rem reference rich-text elements to their current visible page text.
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
    const linkedText = (
      await flattenRichTextElement(
        plugin,
        linkedRem.text,
        { ...omitPinSourceDiagnostics(options), suppressExternalCitationWrap: true },
        nextSeen,
        depth + 1
      )
    ).trim();
    if (isFormattingMetadataLabel(linkedText)) {
      return '';
    }

    const isOutsideHierarchy =
      options.hierarchyRemIds !== undefined && !options.hierarchyRemIds.has(entry._id);
    if (isOutsideHierarchy && !options.suppressExternalCitationWrap) {
      const documentCitationKey = await getCitationKeyFromDocumentAncestor(
        plugin,
        linkedRem,
        options,
        nextSeen,
        depth
      );
      const citation = toLatexCitation(documentCitationKey) || toLatexCitation(linkedText);
      return citation || `\\cite{rem_${entry._id}}`;
    }

    // If a local pin points to a TODO rem in the current export hierarchy,
    // ignore it in normal paragraph output (pins inside a TODO rem's own text
    // opt in via todoContentResolvePinsAsText and resolve to linked text).
    if (!isOutsideHierarchy && !options.todoContentResolvePinsAsText) {
      const isLinkedTodo = await linkedRem.isTodo();
      if (isLinkedTodo) {
        return '';
      }

      const missingLabelDiagnostics = await getLocalPinMissingLabelDiagnostics(plugin, linkedRem);
      if (missingLabelDiagnostics) {
        const sourceRem = options.pinSourceRemId
          ? await plugin.rem.findOne(options.pinSourceRemId)
          : undefined;
        const sourceTitle = options.pinSourceRemTitle?.trim() || undefined;
        const sourceExcerpt = options.pinSourceRemExcerpt?.trim() || undefined;
        const sourceHierarchy = sourceRem
          ? await getRelativeHierarchyFromFlattenOptions(plugin, sourceRem, options)
          : undefined;
        const targetRem = missingLabelDiagnostics.missingRem;
        const targetTitle =
          flattenRawTitleText(targetRem.text).trim() ||
          (
            await richTextToString(plugin, targetRem.text, {
              hierarchyRemIds: options.hierarchyRemIds,
              rootRemId: options.rootRemId,
            })
          ).trim();
        const targetExcerpt = truncateDiagnosticPreview(sanitizeDiagnosticExcerpt(
          missingLabelDiagnostics.missingCodeText ??
            buildDiagnosticRemTextPreview(targetRem.text)
        ));
        const targetHierarchy = await getRelativeHierarchyFromFlattenOptions(plugin, targetRem, options);
        throw new Rem2TexConversionError({
          code: 'MISSING_LOCAL_LABEL',
          headline: 'Pin needs a LaTeX \\label in the target figure/table/code',
          whatHappened:
            'This paragraph contains a rem link (pin) to local media (a code block or image rem) inside your paper. Rem2Tex turns that into \\ref{…}, but the exported LaTeX must include \\label{…} so the reference key exists.',
          technicalDetail: missingLabelDiagnostics.message,
          location: options.pinLocation,
          linkedRemId: entry._id,
          pinTargetRemTitle: targetTitle || undefined,
          pinTargetRemHierarchy: targetHierarchy,
          pinTargetRemTextPreview: targetExcerpt,
          // "Where it failed" is the rem being exported that contains the pin.
          sourceRemId: options.pinSourceRemId,
          sourceRemTextPreview: sourceExcerpt,
          sourceRemTitle: sourceTitle,
          sourceRemHierarchy: sourceHierarchy,
          hints: [
            'Open the rem you linked to and add \\label{your-key} inside the figure, table, or equation LaTeX (same child code block Rem2Tex exports).',
            'For image rems, the \\label must live in a child code block under the image (figure/table environment), not only in the image caption rem text.',
            'Pick a key you can reuse in text (e.g. \\label{fig:setup}) and re-run Rem2Tex.',
          ],
        });
      }

      const localRef = await resolveLocalPinAsRef(plugin, linkedRem);
      if (localRef) {
        return localRef;
      }
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

async function richTextToString(
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
  return normalizeAdjacentCitations(trimmed);
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

  if (children.length > 0) {
    for (const child of children) {
      await collectDescendantText(child);
    }
  } else {
    const directCodeText = await richTextToString(plugin, boundaryRem.backText ?? boundaryRem.text, {
      codeOnly: true,
    });
    const directText =
      directCodeText ||
      (await richTextToString(plugin, boundaryRem.backText ?? boundaryRem.text, {
        hierarchyRemIds: context.hierarchyRemIds,
      }));
    if (directText) {
      if (directCodeText) {
        codeLines.push(directText);
      } else {
        plainLines.push(directText);
      }
    }
  }

  const selectedLines = codeLines.length > 0 ? codeLines : plainLines;
  const blockText = stripTrailingCodeMetadataArtifacts(selectedLines.join('\n').trim());
  const normalizedBlockText = blockText
    .split('\n')
    .filter((line) => !isFormattingMetadataLabel(line))
    .join('\n')
    .trim();
  if (!normalizedBlockText) {
    throw new Error(`${label} is empty. Add a code block underneath it.`);
  }

  return normalizedBlockText;
}

/**
 * Reads the Preamble block and returns title/author for UI. Returns `undefined` if the paper layout
 * is not valid or the preamble cannot be read.
 */
export async function tryReadPreambleTitleAuthor(
  plugin: ReactRNPlugin,
  parentRem: Rem
): Promise<{ title: string; author: string } | undefined> {
  try {
    const descendants = await parentRem.getDescendants();
    const context: Rem2TexConversionContext = {
      hierarchyRemIds: new Set([parentRem._id, ...descendants.map((rem) => rem._id)]),
      rootRemId: parentRem._id,
    };
    const children = await parentRem.getChildrenRem();
    if (children.length < 2) return undefined;
    const firstChild = children[0];
    const firstName = await getRemTitle(plugin, firstChild, context);
    if (firstName !== REQUIRED_PREAMBLE_NAME) return undefined;
    let endIndex = -1;
    for (let i = 1; i < children.length; i += 1) {
      const childName = await getRemTitle(plugin, children[i], context);
      if (childName === REQUIRED_END_NAME) {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1) return undefined;
    const preambleRaw = await getBoundaryBlock(plugin, firstChild, REQUIRED_PREAMBLE_NAME, context);
    const meta = parsePreambleLatexMetadata(preambleRaw);
    return { title: meta.title, author: meta.author };
  } catch {
    return undefined;
  }
}

export async function getFocusedParentRem(plugin: ReactRNPlugin): Promise<Rem> {
  const focusedRem = await plugin.focus.getFocusedRem();
  if (focusedRem) return focusedRem;

  const selected = await plugin.editor.getSelectedRem();
  const selectedRemId = selected?.remIds?.[0];
  if (selectedRemId) {
    const selectedRem = await plugin.rem.findOne(selectedRemId);
    if (!selectedRem) {
      throw new Error('The selected rem is not accessible to this plugin.');
    }
    return selectedRem;
  }

  const focusedPaneId = await plugin.window.getFocusedPaneId();
  const paneRemId = await plugin.window.getOpenPaneRemId(focusedPaneId);
  if (paneRemId) {
    const paneRem = await plugin.rem.findOne(paneRemId);
    if (paneRem) return paneRem;
  }

  throw new Error('No focused rem found. Open or focus the Paper rem before running Rem2Tex.');
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
  });
  return text ? `% TODO ${marker} ${text}` : `% TODO ${marker}`;
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

const TODO_COMMENT_INDENT_STEP = 2;
const TODO_COMMENT_LABEL_MAX = 240;

async function getCommentTreeLabel(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<string> {
  const raw = flattenRawTitleText(rem.text).trim() || (await getRemTitle(plugin, rem, context)).trim();
  const single = raw.replace(/\s+/g, ' ').trim();
  if (single.length <= TODO_COMMENT_LABEL_MAX) return single || '—';
  return `${single.slice(0, TODO_COMMENT_LABEL_MAX - 1)}…`;
}

/** Indented full `todoComment` block (Option B for nested todos). */
async function emitIndentedTodoCommentBlock(
  plugin: ReactRNPlugin,
  rem: Rem,
  output: string[],
  context: Rem2TexConversionContext,
  indentDepth: number
): Promise<void> {
  const raw = await todoComment(plugin, rem, context);
  const lines = raw.split(/\r?\n/);
  const pad = ' '.repeat(indentDepth);
  for (const line of lines) {
    const rest = line.startsWith('%') ? line.slice(1) : line;
    output.push(`%${pad}${rest}`);
  }
}

/** Emit direct children of a todo rem as indented `%` comment lines and recurse. */
async function emitTodoChildrenAsCommentTree(
  plugin: ReactRNPlugin,
  parentRem: Rem,
  output: string[],
  context: Rem2TexConversionContext,
  indentDepth: number
): Promise<void> {
  const children = await parentRem.getChildrenRem();
  const pad = ' '.repeat(indentDepth);
  for (const child of children) {
    const childIsHeading = (await child.getFontSize()) !== undefined;
    const childIsTodo = await child.isTodo();
    if (childIsTodo && !childIsHeading) {
      if (await shouldExportTodoAsComment(child, context)) {
        await emitIndentedTodoCommentBlock(plugin, child, output, context, indentDepth);
        await emitTodoChildrenAsCommentTree(
          plugin,
          child,
          output,
          context,
          indentDepth + TODO_COMMENT_INDENT_STEP
        );
      }
    } else {
      output.push(`%${pad}- ${await getCommentTreeLabel(plugin, child, context)}`);
      await emitTodoChildrenAsCommentTree(
        plugin,
        child,
        output,
        context,
        indentDepth + TODO_COMMENT_INDENT_STEP
      );
    }
  }
}

async function getRemBodyText(
  plugin: ReactRNPlugin,
  rem: Rem,
  context: Rem2TexConversionContext,
  pinLocation?: Rem2TexPinLocation,
  pinSourceDiagnostics?: { id: string; excerpt: string; title?: string }
): Promise<{ text: string; fromCodeBlock: boolean }> {
  const codeText = await richTextToString(plugin, rem.text, { codeOnly: true });
  const plainText = await richTextToString(plugin, rem.text, {
    hierarchyRemIds: context.hierarchyRemIds,
    rootRemId: context.rootRemId,
    pinLocation,
    pinSourceRemId: pinSourceDiagnostics?.id,
    pinSourceRemExcerpt: pinSourceDiagnostics?.excerpt,
    pinSourceRemTitle: pinSourceDiagnostics?.title,
  });

  // Only treat content as raw code when the code-only extraction matches
  // the full text extraction (modulo known metadata label lines). This avoids
  // dropping inline LaTeX/citation fragments in normal prose rems.
  const normalizeForCodeComparison = (value: string): string =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !isFormattingMetadataLabel(line))
      .join('\n');

  const normalizedCode = normalizeForCodeComparison(codeText);
  const normalizedPlain = normalizeForCodeComparison(plainText);

  if (normalizedCode && normalizedCode === normalizedPlain) {
    return { text: codeText, fromCodeBlock: true };
  }
  return { text: plainText, fromCodeBlock: false };
}

async function enrichConversionErrorWithSourceRem(
  plugin: ReactRNPlugin,
  error: unknown,
  rem: Rem,
  context: Rem2TexConversionContext
): Promise<unknown> {
  if (!isRem2TexConversionError(error)) return error;
  const e = error;
  if (e.sourceRemId && e.sourceRemTextPreview && e.sourceRemTitle && e.sourceRemHierarchy) return e;

  const fallbackTitle =
    flattenRawTitleText(rem.text).trim() || (await getRemTitle(plugin, rem, context)).trim() || undefined;
  const fallbackExcerpt = truncateDiagnosticPreview(
    sanitizeDiagnosticExcerpt(buildDiagnosticRemTextPreview(rem.text))
  );
  const fallbackHierarchy = await getRelativeSourceRemHierarchy(plugin, rem, context);

  return new Rem2TexConversionError({
    code: e.code,
    headline: e.headline,
    whatHappened: e.whatHappened,
    technicalDetail: e.technicalDetail,
    location: e.location,
    linkedRemId: e.linkedRemId,
    pinTargetRemTitle: e.pinTargetRemTitle,
    pinTargetRemHierarchy: e.pinTargetRemHierarchy,
    pinTargetRemTextPreview: e.pinTargetRemTextPreview,
    sourceRemId: e.sourceRemId ?? rem._id,
    sourceRemTextPreview: e.sourceRemTextPreview ?? fallbackExcerpt,
    sourceRemTitle: e.sourceRemTitle ?? fallbackTitle,
    sourceRemHierarchy: e.sourceRemHierarchy ?? fallbackHierarchy,
    hints: e.hints,
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

async function getRelativeHierarchyFromFlattenOptions(
  plugin: ReactRNPlugin,
  rem: Rem,
  options: FlattenOptions
): Promise<string[] | undefined> {
  const chain: Rem[] = [];
  let current: Rem | undefined = rem;
  while (current) {
    chain.unshift(current);
    if (options.rootRemId && current._id === options.rootRemId) break;
    if (!current.parent) break;
    current = await plugin.rem.findOne(current.parent);
  }

  let working = chain;
  if (
    options.rootRemId &&
    working.length > 0 &&
    working[0]._id === options.rootRemId
  ) {
    working = working.slice(1);
  }

  const parts: string[] = [];
  for (const item of working) {
    const label =
      flattenRawTitleText(item.text).trim() ||
      (await richTextToString(plugin, item.text, { hierarchyRemIds: options.hierarchyRemIds })).trim();
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

function extractLabelKeyFromLatex(codeText: string): string | undefined {
  const match = codeText.match(/\\label\{([^}]+)\}/);
  const key = match?.[1]?.trim();
  return key || undefined;
}

async function getMediaCodeBlocksFromImmediateChildren(
  plugin: ReactRNPlugin,
  rem: Rem
): Promise<string[]> {
  const children = await rem.getChildrenRem();
  const blocks: string[] = [];

  for (const child of children) {
    const fromText = await richTextToString(plugin, child.text, { codeOnly: true });
    const sanitizedFromText = fromText ? stripTrailingCodeMetadataArtifacts(fromText) : '';
    if (sanitizedFromText && inferMediaTypeFromLatex(sanitizedFromText)) {
      blocks.push(sanitizedFromText);
    }

    const fromBackText = await richTextToString(plugin, child.backText, { codeOnly: true });
    const sanitizedFromBackText = fromBackText ? stripTrailingCodeMetadataArtifacts(fromBackText) : '';
    if (sanitizedFromBackText && inferMediaTypeFromLatex(sanitizedFromBackText)) {
      blocks.push(sanitizedFromBackText);
    }
  }

  return blocks;
}

type MediaCodeBlockWithOwner = {
  ownerRem: Rem;
  latex: string;
};

async function getMediaCodeBlocksWithOwnerFromImmediateChildren(
  plugin: ReactRNPlugin,
  rem: Rem
): Promise<MediaCodeBlockWithOwner[]> {
  const children = await rem.getChildrenRem();
  const blocks: MediaCodeBlockWithOwner[] = [];

  for (const child of children) {
    const fromText = await richTextToString(plugin, child.text, { codeOnly: true });
    const sanitizedFromText = fromText ? stripTrailingCodeMetadataArtifacts(fromText) : '';
    if (sanitizedFromText && inferMediaTypeFromLatex(sanitizedFromText)) {
      blocks.push({ ownerRem: child, latex: sanitizedFromText });
    }

    const fromBackText = await richTextToString(plugin, child.backText, { codeOnly: true });
    const sanitizedFromBackText = fromBackText ? stripTrailingCodeMetadataArtifacts(fromBackText) : '';
    if (sanitizedFromBackText && inferMediaTypeFromLatex(sanitizedFromBackText)) {
      blocks.push({ ownerRem: child, latex: sanitizedFromBackText });
    }
  }

  return blocks;
}

async function getCodeBlockTextFromRem(plugin: ReactRNPlugin, rem: Rem): Promise<string | undefined> {
  const fromText = await richTextToString(plugin, rem.text, { codeOnly: true });
  const sanitizedFromText = fromText ? stripTrailingCodeMetadataArtifacts(fromText) : '';
  if (sanitizedFromText) return sanitizedFromText;

  const fromBackText = await richTextToString(plugin, rem.backText, { codeOnly: true });
  const sanitizedFromBackText = fromBackText ? stripTrailingCodeMetadataArtifacts(fromBackText) : '';
  if (sanitizedFromBackText) return sanitizedFromBackText;

  return undefined;
}

async function resolveLocalPinAsRef(plugin: ReactRNPlugin, rem: Rem): Promise<string | undefined> {
  const directCode = await getCodeBlockTextFromRem(plugin, rem);
  if (directCode) {
    const label = extractLabelKeyFromLatex(directCode);
    if (label) {
      return `\\ref{${label}}`;
    }
  }

  const isImageRem = hasImageTokenInRichText(rem.text) || hasImageTokenInRichText(rem.backText);
  if (isImageRem) {
    const mediaBlocks = await getMediaCodeBlocksFromImmediateChildren(plugin, rem);
    for (const mediaBlock of mediaBlocks) {
      const label = extractLabelKeyFromLatex(mediaBlock);
      if (label) {
        return `\\ref{${label}}`;
      }
    }
  }

  return undefined;
}

type LocalPinMissingLabelDiagnostics = {
  message: string;
  /** The specific rem that must be edited (code block rem, or image rem if no child exists). */
  missingRem: Rem;
  /** Exact LaTeX block missing \\label when available. */
  missingCodeText?: string;
};

async function getLocalPinMissingLabelDiagnostics(
  plugin: ReactRNPlugin,
  rem: Rem
): Promise<LocalPinMissingLabelDiagnostics | undefined> {
  const directCode = await getCodeBlockTextFromRem(plugin, rem);
  if (directCode) {
    if (!extractLabelKeyFromLatex(directCode)) {
      return {
        message: 'Pinned local code block is missing \\label{...}.',
        missingRem: rem,
        missingCodeText: directCode,
      };
    }
    return undefined;
  }

  const isImageRem = hasImageTokenInRichText(rem.text) || hasImageTokenInRichText(rem.backText);
  if (isImageRem) {
    const mediaBlocks = await getMediaCodeBlocksWithOwnerFromImmediateChildren(plugin, rem);
    if (mediaBlocks.length === 0) {
      return {
        message: 'Pinned local image rem is missing a child media code block.',
        missingRem: rem,
      };
    }
    const hasLabel = mediaBlocks.some((block) => Boolean(extractLabelKeyFromLatex(block.latex)));
    if (!hasLabel) {
      const unlabeledBlock = mediaBlocks.find((block) => !extractLabelKeyFromLatex(block.latex));
      return {
        message: 'Pinned local image media code block is missing \\label{...}.',
        missingRem: unlabeledBlock?.ownerRem ?? rem,
        missingCodeText: unlabeledBlock?.latex,
      };
    }
  }

  return undefined;
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

async function serializeNode(
  plugin: ReactRNPlugin,
  rem: Rem,
  currentHeadingLevel: number,
  output: string[],
  context: Rem2TexConversionContext,
  currentSectionTitle?: string,
  currentSubsectionTitle?: string
): Promise<void> {
  const headingStyle = await rem.getFontSize();
  const isHeading = headingStyle !== undefined;
  const isTodo = await rem.isTodo();
  // If a rem is both heading and todo, treat it as heading-only.
  if (isTodo && !isHeading) {
    if (await shouldExportTodoAsComment(rem, context)) {
      output.push(await todoComment(plugin, rem, context));
      await emitTodoChildrenAsCommentTree(plugin, rem, output, context, TODO_COMMENT_INDENT_STEP);
    }
    return;
  }

  const hasImageToken = hasImageTokenInRichText(rem.text) || hasImageTokenInRichText(rem.backText);
  if (hasImageToken) {
    const mediaBlocks = await getMediaCodeBlocksFromImmediateChildren(plugin, rem);
    if (mediaBlocks.length === 0) {
      const remTitle = await getRemTitle(plugin, rem, context);
      const warningText = remTitle
        ? `Image rem "${remTitle}" must include at least one child code block containing \\begin{figure} or \\begin{table}.`
        : 'Image rem must include at least one child code block containing \\begin{figure} or \\begin{table}.';
      output.push(buildVisibleWarningBlock(warningText));
      output.push('');
      return;
    }
    for (const mediaBlock of mediaBlocks) {
      output.push(mediaBlock);
      output.push('');
    }
    return;
  }

  const pinLocation: Rem2TexPinLocation | undefined = currentSubsectionTitle
    ? { section: currentSectionTitle ?? 'Unknown', subsection: currentSubsectionTitle }
    : currentSectionTitle
      ? { section: currentSectionTitle }
      : undefined;
  const sourceRemTitle = (await getRemTitle(plugin, rem, context)).trim();
  const pinSourceDiagnostics = {
    id: rem._id,
    excerpt: truncateDiagnosticPreview(
      sanitizeDiagnosticExcerpt(buildDiagnosticRemTextPreview(rem.text))
    ),
    title: sourceRemTitle || undefined,
  };
  let titleResult: { text: string; fromCodeBlock: boolean };
  try {
    titleResult = await getRemBodyText(
      plugin,
      rem,
      context,
      pinLocation,
      pinSourceDiagnostics
    );
  } catch (error) {
    throw await enrichConversionErrorWithSourceRem(plugin, error, rem, context);
  }
  let { text: title, fromCodeBlock } = titleResult;
  if (isHeading && isTodo) {
    const rawTodoHeadingTitle = flattenRawTitleText(rem.text).trim();
    // Todo headings carry internal status pins; prefer raw title text so we
    // don't serialize those pins as citations (e.g. \cite{Status}).
    if (rawTodoHeadingTitle.length > 0) {
      title = rawTodoHeadingTitle;
      fromCodeBlock = false;
    }
  }
  if (isHeading) {
    const headingLevel = Math.min(currentHeadingLevel + 1, HEADING_COMMANDS.length);
    const command = HEADING_COMMANDS[headingLevel - 1];
    if (title) {
      output.push(`\\${command}{${escapeLatex(title)}}`);
      output.push('');
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
        throw await enrichConversionErrorWithSourceRem(plugin, error, child, context);
      }
    }
    return;
  }

  if (title) {
    output.push(fromCodeBlock ? title : escapeLatex(title));
  }

  const children = await rem.getChildrenRem();
  const nonTodoChildren: Rem[] = [];
  for (const child of children) {
    const childIsHeading = (await child.getFontSize()) !== undefined;
    if ((await child.isTodo()) && !childIsHeading) {
      if (await shouldExportTodoAsComment(child, context)) {
        output.push(await todoComment(plugin, child, context));
        await emitTodoChildrenAsCommentTree(plugin, child, output, context, TODO_COMMENT_INDENT_STEP);
      }
    } else {
      nonTodoChildren.push(child);
    }
  }

  if (title || children.length > 0) {
    output.push('');
  }

  for (const child of nonTodoChildren) {
    try {
      await serializeNode(
        plugin,
        child,
        currentHeadingLevel,
        output,
        context,
        currentSectionTitle,
        currentSubsectionTitle
      );
    } catch (error) {
      throw await enrichConversionErrorWithSourceRem(plugin, error, child, context);
    }
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

async function createOutputRem(plugin: ReactRNPlugin, parent: Rem, latex: string): Promise<string> {
  const rem2TexRoot = await getOrCreateRem2TexRoot(plugin, parent);
  const outputTitle = `Rem2Tex ${toOutputTimestamp()}`;
  const outputRem = await plugin.rem.createRem();
  if (!outputRem) {
    throw new Error('Failed to create output rem.');
  }
  await outputRem.setText([outputTitle]);
  await outputRem.setParent(rem2TexRoot);

  const codeRem = await plugin.rem.createRem();
  if (!codeRem) {
    throw new Error('Failed to create code block rem.');
  }
  await codeRem.setParent(outputRem);
  await codeRem.setText(await plugin.richText.code(latex, 'latex').value());

  return outputTitle;
}

export async function runRem2TexConversion(
  plugin: ReactRNPlugin,
  options?: Rem2TexRunOptions
): Promise<string> {
  try {
    const parentRem = options?.parentRem ?? (await getFocusedParentRem(plugin));
    await notifyConversionProgress(options, 1, 'Validating paper structure (Preamble / End)…');

    const descendants = await parentRem.getDescendants();
    const context: Rem2TexConversionContext = {
      hierarchyRemIds: new Set([parentRem._id, ...descendants.map((rem) => rem._id)]),
      rootRemId: parentRem._id,
      todoExportMode: options?.todoExportMode ?? 'all',
    };
    const children = await parentRem.getChildrenRem();

    if (children.length < 2) {
      throw new Error('Paper rem must have at least Preamble and End children.');
    }

    const firstChild = children[0];
    const firstName = await getRemTitle(plugin, firstChild, context);
    if (firstName !== REQUIRED_PREAMBLE_NAME) {
      throw new Error(`First child must be "${REQUIRED_PREAMBLE_NAME}".`);
    }

    let endIndex = -1;
    for (let i = 1; i < children.length; i += 1) {
      const childName = await getRemTitle(plugin, children[i], context);
      if (childName === REQUIRED_END_NAME) {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1) {
      throw new Error(`Could not find "${REQUIRED_END_NAME}" after "${REQUIRED_PREAMBLE_NAME}".`);
    }

    await notifyConversionProgress(options, 2, 'Reading Preamble block…');
    const preamble = await getBoundaryBlock(plugin, firstChild, REQUIRED_PREAMBLE_NAME, context);
    const endRem = children[endIndex];

    await notifyConversionProgress(options, 3, 'Reading End block…');
    const endBlock = await getBoundaryBlock(plugin, endRem, REQUIRED_END_NAME, context);
    const bodyRems = children.slice(1, endIndex);

    await notifyConversionProgress(options, 4, 'Converting body to LaTeX…');
    const bodyLines: string[] = [];
    for (const bodyRem of bodyRems) {
      try {
        await serializeNode(plugin, bodyRem, 0, bodyLines, context, undefined, undefined);
      } catch (error) {
        throw await enrichConversionErrorWithSourceRem(plugin, error, bodyRem, context);
      }
    }
    const body = bodyLines.join('\n').trim();

    const outputLines = [preamble.trim(), '', body, '', endBlock.trim()].filter(
      (_line, index, lines) => !(index > 0 && lines[index - 1] === '' && lines[index] === '')
    );
    const latex = outputLines.join('\n').trim();

    await notifyConversionProgress(options, 5, 'Creating export rem…');
    return createOutputRem(plugin, parentRem, latex);
  } catch (error) {
    if (isRem2TexConversionError(error)) {
      throw error;
    }
    throw new Error(normalizeUnknownError(error));
  }
}
