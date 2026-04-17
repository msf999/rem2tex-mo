import type { ReactRNPlugin, Rem } from '@remnote/plugin-sdk';

const REQUIRED_PREAMBLE_NAME = 'Preamble';
const REQUIRED_END_NAME = 'End';
const HEADING_COMMANDS = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];

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

function escapeLatex(text: string): string {
  const map: Record<string, string> = {
    '\\': '\\textbackslash{}',
    '{': '\\{',
    '}': '\\}',
    '$': '\\$',
    '&': '\\&',
    '#': '\\#',
    '%': '\\%',
    '_': '\\_',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  };
  return text.replace(/[\\{}$&#%_~^]/g, (match) => map[match] ?? match);
}

function flattenRichTextElement(element: unknown): string {
  if (typeof element === 'string') return element;
  if (element === null || element === undefined) return '';
  if (Array.isArray(element)) {
    return element.map(flattenRichTextElement).join('');
  }
  if (typeof element !== 'object') return '';

  const entry = element as Record<string, unknown>;

  if (typeof entry.text === 'string') {
    return entry.text;
  }

  // Some rich text payloads nest fallback text for deleted/aliased Rem refs.
  if (entry.textOfDeletedRem !== undefined) {
    return flattenRichTextElement(entry.textOfDeletedRem);
  }

  return '';
}

async function richTextToString(_plugin: ReactRNPlugin, text?: unknown): Promise<string> {
  if (text === null || text === undefined) return '';
  const flattened = flattenRichTextElement(text).trim();
  return flattened;
}

async function getRemTitle(plugin: ReactRNPlugin, rem: Rem): Promise<string> {
  return richTextToString(plugin, rem.text);
}

async function getBoundaryBlock(plugin: ReactRNPlugin, boundaryRem: Rem, label: string): Promise<string> {
  const children = await boundaryRem.getChildrenRem();
  const lines: string[] = [];

  const collectDescendantText = async (rem: Rem): Promise<void> => {
    const line = await richTextToString(plugin, rem.text);
    if (line) lines.push(line);
    const backLine = await richTextToString(plugin, rem.backText);
    if (backLine) lines.push(backLine);

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
    const directText = await richTextToString(plugin, boundaryRem.backText ?? boundaryRem.text);
    if (directText) {
      lines.push(directText);
    }
  }

  const blockText = lines.join('\n').trim();
  if (!blockText) {
    throw new Error(`${label} is empty. Add a code block underneath it.`);
  }

  return blockText;
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

  const title = await getRemTitle(plugin, rem);
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
    output.push(escapeLatex(title));
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
    const lastChild = children[children.length - 1];
    const firstName = await getRemTitle(plugin, firstChild);
    const lastName = await getRemTitle(plugin, lastChild);

    if (firstName !== REQUIRED_PREAMBLE_NAME) {
      throw new Error(`First child must be "${REQUIRED_PREAMBLE_NAME}".`);
    }
    if (lastName !== REQUIRED_END_NAME) {
      throw new Error(`Last child must be "${REQUIRED_END_NAME}".`);
    }

    const preamble = await getBoundaryBlock(plugin, firstChild, REQUIRED_PREAMBLE_NAME);
    const endBlock = await getBoundaryBlock(plugin, lastChild, REQUIRED_END_NAME);
    const bodyRems = children.slice(1, -1);

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
