import { renderWidget, usePlugin, useSessionStorageState } from '@remnote/plugin-sdk';
import {
  REM2TEX_PROGRESS_STORAGE_KEY,
  REM2TEX_PROGRESS_TOTAL,
  type Rem2TexProgressUiState,
} from '../lib/rem2tex';

const defaultState: Rem2TexProgressUiState = {
  phase: 'running',
  step: 0,
  total: REM2TEX_PROGRESS_TOTAL,
  label: 'Starting…',
  progressLog: [],
};

const panel = 'rounded-md border border-slate-200 bg-white px-3.5 py-3 shadow-sm';
const errorPanel = 'rounded-md border border-red-200 bg-red-50 px-4 py-3 shadow-sm';

async function copyPlainText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function formatWhen(iso?: string): string | undefined {
  if (!iso) return undefined;
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function SectionTitle(props: { title: string; color?: string }) {
  return (
    <div
      className={`text-[11px] font-semibold uppercase tracking-wider ${
        props.color ?? 'text-slate-700'
      }`}
    >
      {props.title}
    </div>
  );
}

function InlineRow(props: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-start gap-2 text-sm">
      <span className="font-medium text-slate-500">{props.label}:</span>
      <span className="min-w-0 flex-1 break-words font-medium text-slate-900">{props.value || '—'}</span>
    </div>
  );
}

function StatusLine(props: { text: string; tone?: 'default' | 'success' | 'error' }) {
  const toneClass =
    props.tone === 'success'
      ? 'text-emerald-700'
      : props.tone === 'error'
        ? 'text-red-700'
        : 'text-slate-800';
  return <li className={`text-[13px] leading-snug ${toneClass}`}>{props.text}</li>;
}

function formatRelativeHierarchy(
  hierarchy: string[] | undefined,
  paperRemTitle?: string
): string {
  if (!hierarchy || hierarchy.length === 0) return 'Not captured';
  let parts = [...hierarchy];
  if (paperRemTitle && paperRemTitle.trim().length > 0) {
    const idx = parts.findIndex((p) => p.trim() === paperRemTitle.trim());
    if (idx >= 0) {
      parts = parts.slice(idx + 1);
    }
  }
  if (parts.length === 0) return '(paper root)';
  return parts.join(' > ');
}

function formatHierarchyRaw(hierarchy: string[] | undefined): string {
  if (!hierarchy || hierarchy.length === 0) return 'Not captured';
  return hierarchy.join(' > ');
}

export const Rem2TexProgress = () => {
  const plugin = usePlugin();
  const [state] = useSessionStorageState<Rem2TexProgressUiState>(
    REM2TEX_PROGRESS_STORAGE_KEY,
    defaultState
  );

  const close = async () => {
    await plugin.widget.closePopup();
  };

  const copyReport = async () => {
    if (state.phase !== 'error') return;
    const ok = await copyPlainText(state.message);
    await plugin.app.toast(ok ? 'Full report copied to clipboard' : 'Could not copy to clipboard');
  };

  const running = state.phase === 'running';
  const success = state.phase === 'success';
  const failed = state.phase === 'error';

  const pct =
    running && state.total > 0
      ? Math.min(100, Math.round((state.step / state.total) * 100))
      : 0;

  const preambleTitle =
    state.phase === 'running' || state.phase === 'success' || state.phase === 'error'
      ? state.preambleTitle ?? ''
      : '';
  const preambleAuthor =
    state.phase === 'running' || state.phase === 'success' || state.phase === 'error'
      ? state.preambleAuthor ?? ''
      : '';
  const paperRemTitle =
    state.phase === 'running' || state.phase === 'success' || state.phase === 'error'
      ? state.paperRemTitle ?? ''
      : '';

  const progressLog =
    state.phase === 'running' || state.phase === 'success'
      ? state.progressLog
      : state.phase === 'error'
        ? state.progressLog ?? []
        : [];

  const hasOutline =
    failed &&
    Boolean(state.location?.section || state.location?.subsection);

  const pinOnly =
    failed &&
    state.sourceRemTextPreview &&
    /^(\u27e8pin\u27e9|<pin>|\u2039pin\u203a)$/i.test(state.sourceRemTextPreview.trim());

  const sourcePreviewDisplay =
    failed && state.sourceRemTextPreview
      ? pinOnly
        ? `The visible text in this rem is only a pin (no surrounding prose). Rem title: "${state.sourceRemTitle || 'Untitled'}".`
        : state.sourceRemTextPreview
      : '';

  return (
    <div className="flex h-full min-h-0 w-full min-w-[320px] flex-col overflow-hidden bg-slate-50 text-slate-900">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="m-0 text-lg font-semibold tracking-tight">Export to LaTeX</h1>
        <div className="flex items-center gap-2">
          {failed ? (
            <button
              type="button"
              onClick={() => void copyReport()}
              style={{ backgroundColor: '#1d4ed8', color: '#ffffff' }}
              className="rounded-md px-3 py-1.5 text-xs font-semibold shadow-sm hover:brightness-110"
            >
              Copy full report
            </button>
          ) : null}
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            onClick={() => void close()}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </header>

      {/* One scrollbar for entire popup content */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className={panel}>
              <SectionTitle title="From preamble" color="text-slate-700" />
              <div className="mt-2 space-y-1.5">
                <InlineRow label="Title" value={preambleTitle} />
                <InlineRow label="Author(s)" value={preambleAuthor} />
                <InlineRow label="Paper rem" value={paperRemTitle} />
              </div>
            </div>
            <div className={panel}>
              <SectionTitle title="Todos" color="text-amber-700" />
              <p className="m-0 mt-2 text-sm text-slate-700">
                Todos copied as comments: <span className="font-semibold text-emerald-700">Yes</span>{' '}
                (<code className="text-xs">% TODO ...</code>)
              </p>
            </div>
          </div>

          {(running || success || failed) &&
            (progressLog.length > 0 || running || (failed && state.failedAtLabel)) && (
              <div>
                <SectionTitle title="Progress" color="text-violet-700" />
                <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  {progressLog.length > 0 ? (
                    <ul className="m-0 list-none space-y-1.5 p-0 text-sm text-slate-800">
                      {progressLog.map((line, i) => (
                        <StatusLine key={i} text={line} tone="success" />
                      ))}
                    </ul>
                  ) : running ? (
                    <p className="m-0 text-sm text-slate-600">{state.label}</p>
                  ) : null}
                  {failed && state.failedAtLabel ? (
                    <ul className="m-0 mt-3 list-none border-t border-red-200 pt-3 p-0">
                      <StatusLine text={`✗ Stopped during: ${state.failedAtLabel}`} tone="error" />
                    </ul>
                  ) : null}
                </div>
              </div>
            )}

          {running && (
            <div className={panel}>
              <p className="m-0 text-sm font-medium text-blue-700">{state.label}</p>
              {state.startedAtIso && (
                <p className="mt-1 text-xs text-slate-500">
                  Started {formatWhen(state.startedAtIso) ?? state.startedAtIso}
                </p>
              )}
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-200 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Step {state.step} of {state.total} - {pct}%
              </p>
              <button
                type="button"
                className="mt-3 text-sm font-medium text-blue-600 underline decoration-blue-200 underline-offset-2 hover:text-blue-800"
                onClick={() => void close()}
              >
                Run in background
              </button>
            </div>
          )}

          {success && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm">
              <SectionTitle title="Success" color="text-emerald-700" />
              <p className="m-0 mt-2 text-sm text-slate-900">
                New export rem: <span className="font-semibold text-emerald-900">{state.outputTitle}</span>
              </p>
              <p className="m-0 mt-2 text-xs text-slate-600">
                Open that rem and copy the code block into your .tex project.
              </p>
            </div>
          )}

          {failed && (
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-800">
                {(state.errorCode ?? 'ERROR').replace(/_/g, ' ')}
              </div>

              <div className={errorPanel}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-red-700">Error summary</div>
                <h2 className="m-0 mt-2 text-lg font-bold text-red-900">{state.headline}</h2>
                <p className="m-0 mt-2 text-sm leading-relaxed text-red-900">{state.whatHappened}</p>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className={panel}>
                  <SectionTitle title="Where it failed" color="text-red-700" />
                  <div className="mt-2 space-y-1.5">
                    {hasOutline && state.location?.section ? (
                      <InlineRow label="Section" value={state.location.section} />
                    ) : null}
                    {hasOutline && state.location?.subsection ? (
                      <InlineRow label="Subsection" value={state.location.subsection} />
                    ) : null}
                    <InlineRow
                      label="Hierarchy"
                      value={formatRelativeHierarchy(state.sourceRemHierarchy, paperRemTitle)}
                    />
                    <InlineRow label="Source rem" value={state.sourceRemTitle || 'Not captured'} />
                    <InlineRow label="Source id" value={state.sourceRemId || 'Not captured'} />
                  </div>
                </div>

                <div className={panel}>
                  <SectionTitle title="Source rem text" color="text-cyan-700" />
                  <p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
                    {sourcePreviewDisplay || 'No source rem preview was captured for this error.'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {state.technicalDetail ? (
                  <div className={panel}>
                    <SectionTitle title="Technical detail" color="text-red-700" />
                    <pre className="m-0 mt-2 whitespace-pre-wrap break-words font-mono text-xs text-red-900">
                      {state.technicalDetail}
                    </pre>
                  </div>
                ) : (
                  <div className="hidden lg:block" aria-hidden />
                )}

                {state.linkedRemId ? (
                  <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    <SectionTitle title="Pin target rem id" color="text-indigo-700" />
                    <code className="mt-2 block break-all font-mono text-[11px]">{state.linkedRemId}</code>
                    <span className="mt-2 block leading-relaxed text-slate-600">
                      Search in Quick Add / omnibar to open the figure/table/code rem and add <code>\label</code>{' '}
                      there.
                    </span>
                  </div>
                ) : null}
              </div>

              {(state.pinTargetRemTitle ||
                (state.pinTargetRemHierarchy && state.pinTargetRemHierarchy.length > 0) ||
                state.pinTargetRemTextPreview) && (
                <div className={panel}>
                  <SectionTitle title="Referenced rem missing \\label" color="text-indigo-700" />
                  <div className="mt-2 space-y-1.5">
                    <InlineRow label="Rem title" value={state.pinTargetRemTitle || 'Not captured'} />
                    <InlineRow
                      label="Hierarchy"
                      value={formatHierarchyRaw(state.pinTargetRemHierarchy)}
                    />
                    <InlineRow
                      label="Text preview"
                      value={state.pinTargetRemTextPreview || 'Not captured'}
                    />
                  </div>
                </div>
              )}

              {state.hints.length > 0 && (
                <div className={panel}>
                  <SectionTitle title="What to try next" color="text-emerald-700" />
                  <ul className="m-0 mt-2 list-disc space-y-2 pl-5 text-sm text-slate-800">
                    {(state.hints ?? []).map((hint, i) => (
                      <li key={i}>{hint}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

renderWidget(Rem2TexProgress);
