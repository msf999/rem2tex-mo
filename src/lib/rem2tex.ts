import type { ReactRNPlugin, Rem } from '@remnote/plugin-sdk';

const REQUIRED_PREAMBLE_NAME = 'Preamble';
const REQUIRED_END_NAME = 'End';
const HEADING_COMMANDS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

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

function toDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
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
};

function isCodeTextElement(entry: Record<string, unknown>): boolean {
  return entry.code === true || typeof entry.language === 'string';
}

async function flattenRichTextElement(
  plugin: ReactRNPlugin,
  element: unknown,
  options: FlattenOptions = {}
): Promise<string> {
  if (typeof element === 'string') return element;
  if (element === null || element === undefined) return '';

  if (Array.isArray(element)) {
    const flattenedParts = await Promise.all(
      element.map((child) => flattenRichTextElement(plugin, child, options))
    );
    return flattenedParts.join('');
  }

  if (typeof element !== 'object') return '';
  const entry = element as Record<string, unknown>;

  // RemNote LaTeX rich-text elements.
  if (entry.i === 'x' && typeof entry.text === 'string') {
    if (options.codeOnly) return '';
    const isDisplay = entry.block === true;
    return wrapRemnoteMath(entry.text, isDisplay);
  }

  if (typeof entry.text === 'string') {
    if (options.codeOnly && !isCodeTextElement(entry)) {
      return '';
    }
    return entry.text;
  }

  // Resolve Rem reference rich-text elements to their current visible page text.
  if (entry.i === 'q' && typeof entry._id === 'string') {
    // In code-only mode, rem references are usually formatting metadata
    // (e.g. heading size controls) rather than code content.
    if (options.codeOnly) {
      return '';
    }
    const linkedRem = await plugin.rem.findOne(entry._id);
    if (!linkedRem) {
      return '';
    }
    const linkedText = (await flattenRichTextElement(plugin, linkedRem.text, options)).trim();
    if (isFormattingMetadataLabel(linkedText)) {
      return '';
    }
    return linkedText;
  }

  // Some rich text payloads nest fallback text for deleted/aliased Rem refs.
  if (entry.textOfDeletedRem !== undefined) {
    return flattenRichTextElement(plugin, entry.textOfDeletedRem, options);
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
  if (isFormattingMetadataLabel(trimmed)) {
    return '';
  }
  return trimmed;
}

async function getRemTitle(plugin: ReactRNPlugin, rem: Rem): Promise<string> {
  return richTextToString(plugin, rem.text);
}

async function getBoundaryBlock(plugin: ReactRNPlugin, boundaryRem: Rem, label: string): Promise<string> {
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
      const fallbackLine = await richTextToString(plugin, rem.backText ?? rem.text);
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
      directCodeText || (await richTextToString(plugin, boundaryRem.backText ?? boundaryRem.text));
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

async function getFocusedParentRem(plugin: ReactRNPlugin): Promise<Rem> {
  const focusedRem = await plugin.focus.getFocusedRem();
  if (focusedRem) return focusedRem;

  const selected = await plugin.editor.getSelectedRem();
  const selectedRemId = selected?.remIds?.[0];
  if (!selectedRemId) {
    throw new Error('No focused rem found. Focus the Paper rem before running Rem2Tex.');
  }

  const selectedRem = await plugin.rem.findOne(selectedRemId);
  if (!selectedRem) {
    throw new Error('The selected rem is not accessible to this plugin.');
  }
  return selectedRem;
}

async function todoComment(plugin: ReactRNPlugin, rem: Rem): Promise<string> {
  const status = await rem.getTodoStatus();
  const marker = status === 'Finished' ? '[X]' : '[ ]';
  const text = await getRemTitle(plugin, rem);
  return text ? `% TODO ${marker} ${text}` : `% TODO ${marker}`;
}

async function getRemBodyText(
  plugin: ReactRNPlugin,
  rem: Rem
): Promise<{ text: string; fromCodeBlock: boolean }> {
  const codeText = await richTextToString(plugin, rem.text, { codeOnly: true });
  const plainText = await getRemTitle(plugin, rem);

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
  output: string[]
): Promise<void> {
  const isTodo = await rem.isTodo();
  if (isTodo) {
    output.push(await todoComment(plugin, rem));
    return;
  }

  const hasImageToken = hasImageTokenInRichText(rem.text) || hasImageTokenInRichText(rem.backText);
  if (hasImageToken) {
    const mediaBlocks = await getMediaCodeBlocksFromImmediateChildren(plugin, rem);
    if (mediaBlocks.length === 0) {
      const remTitle = await getRemTitle(plugin, rem);
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

  const { text: title, fromCodeBlock } = await getRemBodyText(plugin, rem);
  const headingStyle = await rem.getFontSize();
  const isHeading = headingStyle !== undefined;

  if (isHeading) {
    const headingLevel = Math.min(currentHeadingLevel + 1, HEADING_COMMANDS.length);
    const command = HEADING_COMMANDS[headingLevel - 1];
    if (title) {
      output.push(`\\${command}{${escapeLatex(title)}}`);
      output.push('');
    }

    const children = await rem.getChildrenRem();
    for (const child of children) {
      await serializeNode(plugin, child, headingLevel, output);
    }
    return;
  }

  if (title) {
    output.push(fromCodeBlock ? title : escapeLatex(title));
  }

  const children = await rem.getChildrenRem();
  const nonTodoChildren: Rem[] = [];
  for (const child of children) {
    if (await child.isTodo()) {
      output.push(await todoComment(plugin, child));
    } else {
      nonTodoChildren.push(child);
    }
  }

  if (title || children.length > 0) {
    output.push('');
  }

  for (const child of nonTodoChildren) {
    await serializeNode(plugin, child, currentHeadingLevel, output);
  }
}

async function createOutputRem(plugin: ReactRNPlugin, parent: Rem, latex: string): Promise<string> {
  const outputTitle = `Rem2Tex ${toDateStamp()}`;
  const outputRem = await plugin.rem.createRem();
  if (!outputRem) {
    throw new Error('Failed to create output rem.');
  }
  await outputRem.setText([outputTitle]);
  await outputRem.setParent(parent);

  const codeRem = await plugin.rem.createRem();
  if (!codeRem) {
    throw new Error('Failed to create code block rem.');
  }
  await codeRem.setParent(outputRem);
  await codeRem.setText(await plugin.richText.code(latex, 'tex').value());

  return outputTitle;
}

export async function runRem2TexConversion(plugin: ReactRNPlugin): Promise<string> {
  try {
    const parentRem = await getFocusedParentRem(plugin);
    const children = await parentRem.getChildrenRem();

    if (children.length < 2) {
      throw new Error('Paper rem must have at least Preamble and End children.');
    }

    const firstChild = children[0];
    const firstName = await getRemTitle(plugin, firstChild);
    if (firstName !== REQUIRED_PREAMBLE_NAME) {
      throw new Error(`First child must be "${REQUIRED_PREAMBLE_NAME}".`);
    }

    let endIndex = -1;
    for (let i = 1; i < children.length; i += 1) {
      const childName = await getRemTitle(plugin, children[i]);
      if (childName === REQUIRED_END_NAME) {
        endIndex = i;
        break;
      }
    }
    if (endIndex === -1) {
      throw new Error(`Could not find "${REQUIRED_END_NAME}" after "${REQUIRED_PREAMBLE_NAME}".`);
    }

    const preamble = await getBoundaryBlock(plugin, firstChild, REQUIRED_PREAMBLE_NAME);
    const endRem = children[endIndex];
    const endBlock = await getBoundaryBlock(plugin, endRem, REQUIRED_END_NAME);
    const bodyRems = children.slice(1, endIndex);

    const bodyLines: string[] = [];
    for (const bodyRem of bodyRems) {
      await serializeNode(plugin, bodyRem, 0, bodyLines);
    }
    const body = bodyLines.join('\n').trim();

    const outputLines = [preamble.trim(), '', body, '', endBlock.trim()].filter(
      (_line, index, lines) => !(index > 0 && lines[index - 1] === '' && lines[index] === '')
    );
    const latex = outputLines.join('\n').trim();

    return createOutputRem(plugin, parentRem, latex);
  } catch (error) {
    throw new Error(normalizeUnknownError(error));
  }
}
