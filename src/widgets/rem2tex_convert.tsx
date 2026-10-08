import { renderWidget, usePlugin } from '@remnote/plugin-sdk';
import { useCallback, useEffect, useState } from 'react';
import {
  describeConvertError,
  previewRem2TexConvert,
  REM2TEX_CONVERT_REQUEST_KEY,
  runRem2TexConvert,
  type Rem2TexConvertKind,
  type Rem2TexConvertPreview,
  type Rem2TexConvertRequest,
  type Rem2TexPinRow,
  type Rem2TexTodoExportMode,
} from '../lib/rem2tex';

/**
 * The conversion popup: preview first, then convert.
 *
 * It owns the work rather than reporting back to the command, because `openPopup` is fire-and-forget
 * and cannot be awaited — the same shape Remzot's sync popup uses. Styling follows Remzot too:
 * RemNote's own `rn-clr-*` classes (so dark mode is automatic) and stock Tailwind utilities, with
 * inline styles only where layout is load-bearing.
 */

/** Adapts to light/dark through RemNote's own variable, with a safe fallback (Remzot's convention). */
const BORDER = 'var(--rn-clr-border-primary, rgba(128,128,128,0.25))';

const TODO_CHOICES: Array<{ value: Rem2TexTodoExportMode; label: string; detail: string }> = [
  { value: 'all', label: 'Copy all todos as comments', detail: 'every todo becomes a % TODO line, with its subtree' },
  { value: 'unfinished', label: 'Copy only unfinished todos', detail: 'a finished todo takes its whole subtree with it' },
  { value: 'none', label: 'Do not copy todos', detail: 'todos and everything under them are left out' },
];

/** The stretch of a rem around its first pin, so a long paragraph still reads as context. */
function contextAroundPin(text: string, radius = 70): string {
  const at = text.indexOf('⟨pin⟩');
  if (at === -1) return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

const TITLES: Record<Rem2TexConvertKind, string> = {
  paper: 'Convert Paper to TeX',
  paragraph: 'Convert Paragraph to TeX',
  selection: 'Convert Selection to TeX',
};

function Rem2TexConvertPopup() {
  const plugin = usePlugin();
  const [request, setRequest] = useState<Rem2TexConvertRequest | null>(null);
  const [todoMode, setTodoMode] = useState<Rem2TexTodoExportMode>('all');
  const [preview, setPreview] = useState<Rem2TexConvertPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [convertPins, setConvertPins] = useState(true);
  const [showPins, setShowPins] = useState(true);

  const load = useCallback(
    async (req: Rem2TexConvertRequest, mode: Rem2TexTodoExportMode) => {
      setBusy(true);
      setStatus('Looking at what would change…');
      try {
        const next = await previewRem2TexConvert(plugin, {
          kind: req.kind,
          todoExportMode: mode,
          selectedRemIds: req.selectedRemIds,
        });
        setPreview(next);
        setConvertPins(true); // ticked by default on every fresh preview
        setStatus('');
      } catch (error) {
        setStatus(`Error: ${describeConvertError(error)}`);
      } finally {
        setBusy(false);
      }
    },
    [plugin]
  );

  useEffect(() => {
    (async () => {
      const req = (await plugin.storage.getSession<Rem2TexConvertRequest>(REM2TEX_CONVERT_REQUEST_KEY)) ?? { kind: 'paper' };
      setRequest(req);
      await load(req, 'all');
    })();
  }, [plugin, load]);

  // The todo mode changes which rems are serialised, so the warnings change with it.
  const chooseTodoMode = async (mode: Rem2TexTodoExportMode) => {
    setTodoMode(mode);
    if (request) await load(request, mode);
  };

  const convert = async (withPins: boolean) => {
    if (!request || !preview) return;
    setBusy(true);
    setStatus(withPins ? 'Writing citekeys, then exporting…' : 'Exporting…');
    try {
      const result = await runRem2TexConvert(plugin, {
        kind: request.kind,
        todoExportMode: todoMode,
        selectedRemIds: request.selectedRemIds,
        pinRows: withPins ? preview.pinRows : undefined,
      });
      // The citekey writes happen before the export, so they are reported either way.
      const pinBits: string[] = [];
      if (result.pinsWritten) pinBits.push(`${result.pinsWritten} citekey${result.pinsWritten === 1 ? '' : 's'} written`);
      if (result.pinsSkipped) pinBits.push(`${result.pinsSkipped} skipped (edited since the preview)`);
      if (result.pinsFailed) pinBits.push(`${result.pinsFailed} could not be written`);

      if (result.status === 'failed') {
        // A failed paper conversion still writes an export rem holding only the Log — say so rather
        // than claiming an export that did not happen.
        const wrote = pinBits.length ? ` (${pinBits.join(', ')}.)` : '';
        await plugin.app.toast(
          `Rem2Tex failed: ${result.errorHeadline ?? 'the conversion did not finish'}. ` +
            `See the Log under “${result.outputTitle}”.${wrote}`
        );
      } else {
        const bits = [`exported “${result.outputTitle}”`, ...pinBits];
        if (result.citationCount !== undefined) {
          bits.push(
            result.citationCount === 0 ? 'no citations' : `${result.citationCount} reference(s)`
          );
          if (result.missingMetadataCount) {
            bits.push(`${result.missingMetadataCount} without Zotero metadata — see the bibliography`);
          }
        }
        if (result.warningCount) bits.push(`${result.warningCount} warning(s) — check the Log`);
        await plugin.app.toast(`Rem2Tex: ${bits.join(', ')}.`);
      }
      await plugin.widget.closePopup();
    } catch (error) {
      setStatus(`Error: ${describeConvertError(error)}`);
      setBusy(false);
    }
  };

  const errors = preview?.issues.filter((i) => i.severity === 'error') ?? [];
  const warnings = preview?.issues.filter((i) => i.severity === 'warning') ?? [];
  const pinRows = preview?.pinRows ?? [];
  // `!preview?.blocked` alone is TRUE while the preview is still loading, which left the button
  // enabled and clicking it silently did nothing (`convert` returns early without a preview).
  const canExport = !busy && !!preview && !preview.blocked;

  return (
    <div className="fixed inset-0 flex flex-col gap-3 p-5 overflow-hidden rn-clr-background-primary rn-clr-content-primary">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{request ? TITLES[request.kind] : 'Rem2Tex'}</h1>
          <p className="text-sm rn-clr-content-secondary">
            {preview?.targetTitle ? `“${preview.targetTitle}” — ` : ''}
            review what would change below, then press Export. Nothing is written until you do.
          </p>
        </div>
        <button
          type="button"
          onClick={() => plugin.widget.closePopup()}
          disabled={busy}
          title={busy ? 'Wait — closing now would leave the knowledge base half-written' : 'Close'}
          aria-label="Close"
          className="shrink-0 p-2 rounded-md rn-clr-content-secondary cursor-pointer disabled:opacity-50 disabled:cursor-default"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {preview && preview.issues.length > 0 && (
        <div
          className="rounded-md p-3 flex flex-col gap-1"
          style={{
            // RemNote's own tints, with the fallbacks Remzot uses so an older theme still reads.
            background: errors.length
              ? 'var(--rn-clr-background-light-negative, rgba(220,38,38,0.10))'
              : 'var(--rn-clr-background-light-warning, rgba(234,179,8,0.12))',
            borderLeft: `3px solid ${
              errors.length ? 'var(--rn-clr-content-negative, #dc2626)' : 'var(--rn-clr-content-warning, #b45309)'
            }`,
            maxHeight: '14rem',
            overflowY: 'auto',
          }}
        >
          <span className="text-sm font-semibold">
            {errors.length > 0 && `${errors.length} error${errors.length === 1 ? '' : 's'}`}
            {errors.length > 0 && warnings.length > 0 && ' · '}
            {warnings.length > 0 && `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
            {errors.length > 0 ? ' — this cannot be exported until it is fixed' : ''}
          </span>
          {preview.issues.map((issue, index) => (
            // The REASON is its own line; the rem, the quoted content and the path sit under it in
            // calmer type. One flat sentence per warning buried the reason between a wall of quoted
            // titles and a very long outline path (mo, 2026-10-09).
            <div
              key={index}
              className="text-sm flex flex-col"
              style={{
                paddingLeft: '0.75rem',
                marginLeft: '0.25rem',
                marginTop: '0.25rem',
                borderLeft: `2px solid ${BORDER}`,
                overflowWrap: 'anywhere',
              }}
            >
              <span
                style={{
                  color:
                    issue.severity === 'error'
                      ? 'var(--rn-clr-content-negative, #dc2626)'
                      : 'var(--rn-clr-content-warning, #b45309)',
                }}
              >
                {issue.severity === 'error' ? '✕ ' : '⚠ '}
                {issue.message}
              </span>

              {issue.subject && (
                <span className="text-xs rn-clr-content-secondary">{issue.subject}</span>
              )}

              {issue.quotes && issue.quotes.length > 0 && (
                <>
                  <span className="text-xs rn-clr-content-tertiary">
                    {issue.quotesLabel ?? 'affected'}:
                  </span>
                  {issue.quotes.map((quote, q) => (
                    <span
                      key={q}
                      className="text-xs font-mono rn-clr-content-secondary"
                      style={{ paddingLeft: '0.75rem' }}
                    >
                      {quote}
                    </span>
                  ))}
                </>
              )}

              {issue.path && (
                <span className="text-xs rn-clr-content-tertiary">in {issue.path}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {pinRows.length > 0 && (
        <label
          className="flex items-start gap-2 text-sm cursor-pointer"
          style={{ borderTop: `1px solid ${BORDER}`, paddingTop: '0.75rem' }}
        >
          <input
            type="checkbox"
            checked={convertPins}
            disabled={busy}
            onChange={() => setConvertPins(!convertPins)}
            style={{ marginTop: '0.2rem' }}
          />
          <span className="min-w-0">
            Convert {pinRows.length} pin{pinRows.length === 1 ? '' : 's'} to citekeys{' '}
            <span className="text-xs rn-clr-content-tertiary">
              — writes each citekey beside its pin, as a reference to the paper; the pin is kept
            </span>
          </span>
        </label>
      )}

      {request?.kind === 'paper' && (
        <div className="flex flex-col gap-1" style={{ borderTop: `1px solid ${BORDER}`, paddingTop: '0.75rem' }}>
          <span className="text-sm font-semibold">Todos</span>
          {TODO_CHOICES.map((choice) => (
            <label key={choice.value} className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="todo-mode"
                checked={todoMode === choice.value}
                disabled={busy}
                onChange={() => chooseTodoMode(choice.value)}
                style={{ marginTop: '0.2rem' }}
              />
              <span className="min-w-0">
                {choice.label} <span className="text-xs rn-clr-content-tertiary">— {choice.detail}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto rounded-md rn-clr-background-secondary p-3">
        {!preview ? (
          <span className="text-sm rn-clr-content-tertiary">Reading the outline…</span>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <button
                type="button"
                onClick={() => setShowPins(!showPins)}
                aria-expanded={showPins}
                className="flex items-center gap-1.5 w-full text-left font-semibold sticky top-0 z-10 py-1 rn-clr-background-secondary cursor-pointer hover:underline"
              >
                <span className="shrink-0 inline-block w-3 text-xs rn-clr-content-secondary">{showPins ? '▾' : '▸'}</span>
                <span className="text-sm">Pins that would become citekeys</span>
                <span className="text-xs rn-clr-content-tertiary">
                  {pinRows.length === 0
                    ? 'none'
                    : `${pinRows.length} rem${pinRows.length === 1 ? '' : 's'} · ${preview.pinKeys.length} work${preview.pinKeys.length === 1 ? '' : 's'}`}
                </span>
              </button>
              {showPins &&
                (pinRows.length === 0 ? (
                  <span className="text-sm rn-clr-content-tertiary">
                    Every Zotero pin here already has its citekey written beside it.
                  </span>
                ) : (
                  <div className="flex flex-col gap-2 py-1">
                    {pinRows.map((row: Rem2TexPinRow) => (
                      <div
                        key={row.remId}
                        className="flex flex-col gap-0.5"
                        style={{ paddingLeft: '1.25rem', borderLeft: `2px solid ${BORDER}`, marginLeft: '0.25rem' }}
                      >
                        {row.path && <span className="text-xs rn-clr-content-tertiary">{row.path}</span>}
                        <span className="text-sm rn-clr-content-secondary" style={{ overflowWrap: 'anywhere' }}>
                          {contextAroundPin(row.previewBefore)}
                        </span>
                        <div className="flex flex-col">
                          {row.keys.map((key) => (
                            <span key={key} className="text-xs font-mono rn-clr-content-accent" style={{ overflowWrap: 'anywhere' }}>
                              + {key}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>

          </div>
        )}
      </div>

      {status && <div className="text-sm rn-clr-content-secondary">{status}</div>}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => convert(convertPins && pinRows.length > 0)}
          disabled={!canExport}
          className="px-4 py-2 rounded-md rn-clr-background-light-positive rn-clr-content-positive disabled:opacity-50"
        >
          {convertPins && pinRows.length > 0 ? 'Convert and export' : 'Export'}
        </button>
        <button
          type="button"
          onClick={() => plugin.widget.closePopup()}
          disabled={busy}
          className="px-4 py-2 rounded-md rn-clr-content-secondary cursor-pointer disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

renderWidget(Rem2TexConvertPopup);
