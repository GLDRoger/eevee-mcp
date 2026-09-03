'use client'

import { useEffect, useState } from 'react'
import type { AppletRun } from '@/domain/applet'
import type { AppletActionDefinition } from '@/domain/applet-action'
import type { AppletDetail } from '@/domain/api'
import type { AutonomyLease } from '@/domain/autonomy-lease'
import { isPublishableQuality } from '@/domain/quality'
import { api } from '@/client/api'
import { evaluateAppletVersion } from '@/client/evaluation-worker'
import { authorizeHuman } from '@/client/human-authority'
import { AppletPreview } from './applet-preview'
import { CorrectionForm } from './correction-form'
import { InputForm } from './input-form'
import { QualityLedger, verdictLabel } from './quality-ledger'

const date = new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' })

function VersionRegister({
  detail,
  reviewVersionId,
  onReview,
  onEvaluate,
  evaluatingVersionId,
}: {
  detail: AppletDetail
  reviewVersionId: string | null
  onReview: (versionId: string) => void
  onEvaluate: (versionId: string) => void
  evaluatingVersionId: string | null
}) {
  return (
    <section className="version-register" aria-labelledby="versions-title">
      <header>
        <h3 id="versions-title">Version register</h3>
        <span>{detail.versions.length} immutable</span>
      </header>
      {detail.versions.length === 0 ? (
        <p className="version-empty">No versions yet.</p>
      ) : (
        <ol>
          {detail.versions.map((version) => {
            const active = detail.applet.activeVersionId === version.id
            const staticallyPublishable = isPublishableQuality(version.qualityReport)
            const evaluated = detail.evaluationRuns.some(
              (run) =>
                run.candidateVersionId === version.id &&
                run.baselineVersionId === detail.applet.activeVersionId &&
                run.suiteId === detail.evaluationSuites[0]?.id &&
                run.state === 'passed',
            )
            const evaluating = evaluatingVersionId === version.id
            return (
              <li
                key={version.id}
                className={reviewVersionId === version.id ? 'is-reviewing' : undefined}
              >
                <div className="version-number">v{version.version}</div>
                <div className="version-copy">
                  <strong>{version.note}</strong>
                  <span>
                    {date.format(new Date(version.createdAt))} · {version.qualityReport.score}/100
                  </span>
                </div>
                {active ? (
                  <span className="version-state">Published</span>
                ) : !staticallyPublishable ? (
                  <span className="version-state" title="A required quality check failed; see the checks above.">
                    Blocked by checks
                  </span>
                ) : evaluated ? (
                  <button type="button" onClick={() => onReview(version.id)}>Review</button>
                ) : detail.evaluationSuites.length > 0 ? (
                  <button
                    type="button"
                    disabled={evaluatingVersionId !== null}
                    onClick={() => onEvaluate(version.id)}
                  >
                    {evaluating ? 'Evaluating' : 'Evaluate'}
                  </button>
                ) : (
                  <span className="version-state">Needs suite</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function EvaluationRegister({ detail }: { detail: AppletDetail }) {
  const suite = detail.evaluationSuites[0]
  const latest = detail.evaluationRuns[0]
  return (
    <section className="evaluation-register" aria-labelledby="evaluations-title">
      <header>
        <div>
          <p>Behavioral evidence</p>
          <h3 id="evaluations-title">Evaluation runs</h3>
        </div>
        <strong>{detail.evaluationRuns.length}</strong>
      </header>
      {suite ? (
        <p className="evaluation-suite-name">
          Suite r{suite.revision} · {suite.name} · {suite.cases.length} case{suite.cases.length === 1 ? '' : 's'}
        </p>
      ) : (
        <p className="version-empty">
          No behavioral suite yet. Ask the agent to create scenarios with actions and assertions; review needs a passing run.
        </p>
      )}
      {latest?.report ? (
        <>
          {latest.report.baseline ? (
            <p className="evaluation-suite-name">
              Candidate {latest.report.candidate.verdict} · published baseline {latest.report.baseline.verdict} · {latest.report.regressions.length} regression{latest.report.regressions.length === 1 ? '' : 's'}
            </p>
          ) : null}
          <ul>
            {latest.report.checks.map((item) => (
              <li key={item.id}>
                <span className={`quality-mark is-${item.verdict}`} aria-hidden="true" />
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
                <span className="quality-status">{verdictLabel(item.criticality, item.verdict)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : latest ? (
        <p className="version-empty">Latest evaluation: {latest.state}{latest.error ? ` · ${latest.error}` : ''}</p>
      ) : null}
    </section>
  )
}

function CorrectionRegister({ detail, onChanged }: { detail: AppletDetail; onChanged: () => void }) {
  const [error, setError] = useState('')
  if (detail.corrections.length === 0) return null
  const dismiss = async (correctionId: string) => {
    setError('')
    try {
      await api.dismissCorrection(correctionId)
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The correction was not dismissed')
    }
  }
  return (
    <section className="correction-register" aria-labelledby="corrections-title">
      <header>
        <h3 id="corrections-title">Correction proposals</h3>
        <span>{detail.corrections.length}</span>
      </header>
      <p className="correction-hint">
        Open proposals are the brief for the next version. An agent marks a proposal applied when
        its version answers it. Dismiss the ones that no longer matter.
      </p>
      <ol>
        {detail.corrections.map((item) => (
          <li key={item.id}>
            <strong>{item.instruction}</strong>
            <p>{item.desiredOutcome}</p>
            {item.state === 'proposed' ? (
              <span className="correction-actions">
                proposed
                <button className="text-action" type="button" onClick={() => void dismiss(item.id)}>
                  Dismiss
                </button>
              </span>
            ) : (
              <span>{item.state}</span>
            )}
          </li>
        ))}
      </ol>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  )
}

function VersionReview({
  appletId,
  version,
  detail,
  onPublished,
}: {
  appletId: string
  version: AppletDetail['versions'][number]
  detail: AppletDetail
  onPublished: () => void
}) {
  const [preview, setPreview] = useState<AppletRun['output']>(null)
  const [sourceFiles, setSourceFiles] = useState<Array<{ path: string; content: string }>>([])
  const [actions, setActions] = useState<AppletActionDefinition[]>([])
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')

  const evidenceRun = detail.evaluationRuns.find(
    (run) => run.candidateVersionId === version.id && run.state === 'passed' && run.report,
  )
  const report = evidenceRun?.report ?? null

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      api.previewVersion(appletId, version.id, controller.signal),
      api.inspectAppletVersion(appletId, version.id, controller.signal),
    ])
      .then(([previewResponse, versionResponse]) => {
        setPreview(previewResponse.preview)
        setSourceFiles(versionResponse.definition.files)
        setActions(versionResponse.definition.actions)
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'This version could not be reviewed')
        }
      })
    return () => controller.abort()
  }, [appletId, version.id])

  const publish = async () => {
    if (!ready) return
    setPublishing(true)
    setError('')
    try {
      const authorized = await authorizeHuman({
        kind: 'publish-version',
        appletId,
        versionId: version.id,
      })
      if (authorized.kind !== 'publish-version' || !authorized.published) {
        throw new Error('The passkey did not publish this version')
      }
      onPublished()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This version was not published')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <section className="version-review" aria-labelledby="review-title">
      <header>
        <div>
          <p>Draft v{version.version} · preview state is not saved</p>
          <h3 id="review-title">Review before publishing</h3>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={!ready || publishing}
          onClick={() => void publish()}
        >
          {publishing ? 'Verifying passkey…' : ready ? 'Approve & publish' : 'Waiting for the preview'}
        </button>
      </header>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {preview ? (
        <AppletPreview
          appletId={appletId}
          output={preview}
          storage="ephemeral"
          actions={actions}
          title="Draft preview"
          onReady={() => setReady(true)}
          onRevoked={() => setReady(false)}
        />
      ) : null}
      {report ? (
        <div className="review-evidence">
          <p className="review-evidence-summary">
            {report.candidate.cases.filter(({ verdict }) => verdict === 'pass').length} of{' '}
            {report.candidate.cases.length} scenarios passed · candidate {report.candidate.verdict}
            {report.baseline
              ? ` · published baseline ${report.baseline.verdict} · ${report.regressions.length} regression${report.regressions.length === 1 ? '' : 's'}`
              : ' · first published version'}
          </p>
          <ol className="review-cases">
            {report.candidate.cases.map((item) => (
              <li key={item.caseId}>
                <span className={`quality-mark is-${item.verdict}`} aria-hidden="true" />
                <details className="review-case" open={item.verdict === 'fail'}>
                  <summary>
                    <strong>{item.name}</strong>
                    <small>{item.steps.length} steps</small>
                  </summary>
                  <ol className="review-steps">
                    {item.steps.map((step) => (
                      <li key={step.index} className={step.verdict === 'fail' ? 'is-fail' : undefined}>
                        <code>{step.action}</code> {step.detail}
                      </li>
                    ))}
                  </ol>
                </details>
                <span className="quality-status">{verdictLabel(item.criticality, item.verdict)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="review-evidence-summary is-missing">
          This version has no passing behavioral evidence yet. Evaluate it before publishing.
        </p>
      )}
      {sourceFiles.length > 0 ? (
        <div className="review-source">
          <div className="review-source-tabs" role="tablist" aria-label="Version source files">
            {sourceFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                role="tab"
                aria-selected={openPath === file.path}
                onClick={() => setOpenPath(openPath === file.path ? null : file.path)}
              >
                {file.path}
              </button>
            ))}
          </div>
          {openPath ? (
            <pre className="review-source-body">
              {sourceFiles.find(({ path }) => path === openPath)?.content}
            </pre>
          ) : (
            <p className="review-source-hint">
              {sourceFiles.length} source file{sourceFiles.length === 1 ? '' : 's'}. Open one to
              read exactly what you are approving.
            </p>
          )}
        </div>
      ) : null}
    </section>
  )
}

export function AppletInspector({
  detail,
  run,
  reviewVersionId,
  lease = null,
  onLeaseChange,
  focusRequestId = null,
  onRun,
  onReviewVersion,
  onChanged,
  onClose,
  onViewChange,
}: {
  detail: AppletDetail
  run: AppletRun | null
  reviewVersionId: string | null
  lease?: AutonomyLease | null
  onLeaseChange?: (lease: AutonomyLease | null) => void
  focusRequestId?: string | null
  onRun: (run: AppletRun) => void
  onReviewVersion: (versionId: string | null) => void
  onChanged: () => void
  onClose: () => void
  onViewChange?: (view: 'app' | 'code') => void
}) {
  const [runtimeError, setRuntimeError] = useState('')
  const [evaluationError, setEvaluationError] = useState('')
  const [evaluationProgress, setEvaluationProgress] = useState('')
  const [evaluationOutcome, setEvaluationOutcome] = useState('')
  const [evaluatingVersionId, setEvaluatingVersionId] = useState<string | null>(null)
  const [view, setView] = useState<'app' | 'code'>('app')
  useEffect(() => {
    onViewChange?.(view)
  }, [onViewChange, view])
  const [draftPreview, setDraftPreview] = useState<{
    versionId: string
    output: NonNullable<AppletRun['output']>
  } | null>(null)
  const [sourceFiles, setSourceFiles] = useState<Array<{ path: string; content: string }>>([])
  const [stageActions, setStageActions] = useState<AppletActionDefinition[]>([])
  const [openPath, setOpenPath] = useState<string | null>(null)
  const latest = detail.versions[0]
  const active = detail.versions.find(({ id }) => id === detail.applet.activeVersionId)
  const reviewing = detail.versions.find(({ id }) => id === reviewVersionId)
  const qualityVersion = reviewing ?? latest
  const runVersion = run?.output
    ? detail.versions.find(({ id }) => id === run.appletVersionId)
    : undefined
  // The version the stage shows: the published one when it exists, else the
  // newest draft. An open durable run stays bound to its immutable version,
  // including that version's governed action contract.
  const stageVersion = runVersion ?? active ?? latest
  const stageVersionId = stageVersion?.id
  // The lifecycle spine used to hide inside the collapsed provenance drawer;
  // the stage bar now names the next step for an unpublished latest version.
  const latestEvaluated =
    latest !== undefined &&
    detail.evaluationRuns.some(
      (evaluationRun) =>
        evaluationRun.candidateVersionId === latest.id &&
        evaluationRun.baselineVersionId === detail.applet.activeVersionId &&
        evaluationRun.suiteId === detail.evaluationSuites[0]?.id &&
        evaluationRun.state === 'passed',
    )
  const showDraftPreview = !run?.output && stageVersionId !== undefined
  // A preview is only current when it belongs to the version on stage, so a
  // stale one from the previous applet or version never flashes.
  const currentDraftPreview =
    draftPreview && draftPreview.versionId === stageVersionId ? draftPreview.output : null

  useEffect(() => {
    if (!showDraftPreview || view !== 'app' || stageVersionId === undefined) return
    // The preview endpoint mints a fresh channel per call. Fetching again for
    // a version that already has one (say, after a Code → App toggle) swapped
    // the iframe's srcdoc under a running applet, which the preview reads as
    // a reload and revokes: "Runtime stopped" and a storage timeout inside.
    if (draftPreview?.versionId === stageVersionId) return
    const controller = new AbortController()
    void api
      .previewVersion(detail.applet.id, stageVersionId, controller.signal)
      .then((response) => setDraftPreview({ versionId: stageVersionId, output: response.preview }))
      .catch(() => {
        // A draft without a compiled artifact has nothing to render; the
        // provenance drawer explains what failed.
      })
    return () => controller.abort()
  }, [detail.applet.id, draftPreview?.versionId, stageVersionId, showDraftPreview, view])

  useEffect(() => {
    if (stageVersionId === undefined) return
    const controller = new AbortController()
    void api
      .inspectAppletVersion(detail.applet.id, stageVersionId, controller.signal)
      .then((response) => setStageActions(response.definition.actions))
      .catch(() => {
        if (!controller.signal.aborted) setStageActions([])
      })
    return () => controller.abort()
  }, [detail.applet.id, stageVersionId])

  useEffect(() => {
    if (view !== 'code' || stageVersionId === undefined) return
    const controller = new AbortController()
    void api
      .inspectAppletVersion(detail.applet.id, stageVersionId, controller.signal)
      .then((response) => {
        setSourceFiles(response.definition.files)
        setOpenPath(response.definition.files[0]?.path ?? null)
      })
      .catch(() => {
        if (!controller.signal.aborted) setSourceFiles([])
      })
    return () => controller.abort()
  }, [detail.applet.id, stageVersionId, view])

  const completeRuntime = async () => {
    if (run?.state !== 'running' || !run.output) return
    setRuntimeError('')
    try {
      const response = await api.completeRun(run.id, run.output.channel)
      onRun(response.run)
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'The runtime was not confirmed')
    }
  }

  const failRuntime = async () => {
    if (run?.state !== 'running' || !run.output) return
    const message = 'The runtime navigated away before completion'
    try {
      const response = await api.failRun(run.id, run.output.channel, message)
      onRun(response.run)
      if (response.run.state === 'failed') setRuntimeError(message)
    } catch (error) {
      setRuntimeError(error instanceof Error ? error.message : 'The failed runtime was not recorded')
    }
  }

  const evaluateVersion = async (versionId: string) => {
    setEvaluatingVersionId(versionId)
    setEvaluationError('')
    setEvaluationOutcome('')
    setEvaluationProgress('Starting browser scenarios')
    try {
      const response = await evaluateAppletVersion(
        detail.applet.id,
        versionId,
        detail.evaluationSuites[0]?.id,
        undefined,
        setEvaluationProgress,
      )
      const report = response.run.report
      const cases = report?.candidate.cases ?? []
      const passed = cases.filter(({ verdict }) => verdict === 'pass').length
      if (response.run.state === 'passed') {
        setEvaluationOutcome(
          `Evaluation passed: ${passed} of ${cases.length} scenario${cases.length === 1 ? '' : 's'}${
            report?.regressions.length ? `, ${report.regressions.length} informational regression${report.regressions.length === 1 ? '' : 's'}` : ''
          }. Review & publish is ready.`,
        )
      } else {
        const failed = cases.filter(({ verdict }) => verdict === 'fail').map(({ name }) => name)
        setEvaluationError(
          failed.length > 0
            ? `Evaluation failed: ${failed.join('; ')}. Open Provenance for the step that broke.`
            : response.run.error ?? 'The evaluation did not pass.',
        )
      }
      onChanged()
    } catch (error) {
      setEvaluationError(error instanceof Error ? error.message : 'The evaluation did not finish')
    } finally {
      setEvaluatingVersionId(null)
      setEvaluationProgress('')
    }
  }

  return (
    <article className="inspector">
      {reviewing ? (
        <VersionReview
          key={reviewing.id}
          appletId={detail.applet.id}
          version={reviewing}
          detail={detail}
          onPublished={() => {
            setEvaluationOutcome(
              `Published v${reviewing.version}. Run it below; while a run is open, its actions are live agent tools.`,
            )
            setEvaluationError('')
            onReviewVersion(null)
            onChanged()
          }}
        />
      ) : stageVersion ? (
        <section className="stage" aria-label="Applet">
          <div className="stage-bar">
            <div className="stage-id">
              <h2>{detail.applet.name}</h2>
              {!active ? <span className="stage-draft-mark">draft</span> : null}
              {!active && latest && isPublishableQuality(latest.qualityReport) ? (
                latestEvaluated ? (
                  <button
                    type="button"
                    className="stage-next"
                    onClick={() => onReviewVersion(latest.id)}
                  >
                    Review &amp; publish
                  </button>
                ) : detail.evaluationSuites.length > 0 ? (
                  <button
                    type="button"
                    className="stage-next"
                    disabled={evaluatingVersionId !== null}
                    onClick={() => void evaluateVersion(latest.id)}
                  >
                    {evaluatingVersionId === latest.id
                      ? evaluationProgress || 'Evaluating…'
                      : 'Evaluate'}
                  </button>
                ) : (
                  <span className="stage-hint">Needs a behavioral suite before review</span>
                )
              ) : null}
            </div>
            <div className="stage-actions">
              <div className="stage-toggle" role="tablist" aria-label="Stage view">
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'app'}
                  onClick={() => setView('app')}
                >App</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={view === 'code'}
                  onClick={() => setView('code')}
                >Code</button>
              </div>
              <button
                type="button"
                className="stage-close"
                title="Close this applet and show the bare workbench"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
          {evaluationOutcome ? (
            <p className="evaluation-outcome" role="status">{evaluationOutcome}</p>
          ) : null}
          {evaluationError ? <p className="form-error" role="alert">{evaluationError}</p> : null}
          {view === 'code' ? (
            sourceFiles.length > 0 ? (
              <div className="review-source is-stage">
                <div className="review-source-tabs" role="tablist" aria-label="Source files">
                  {sourceFiles.map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      role="tab"
                      aria-selected={openPath === file.path}
                      onClick={() => setOpenPath(file.path)}
                    >
                      {file.path}
                    </button>
                  ))}
                </div>
                <pre className="review-source-body">
                  {sourceFiles.find(({ path }) => path === openPath)?.content}
                </pre>
              </div>
            ) : (
              <p className="stage-empty">Loading source…</p>
            )
          ) : run?.output ? (
            <AppletPreview
              key={run.id}
              appletId={detail.applet.id}
              output={run.output}
              storage="durable"
              runId={run.id}
              actions={stageActions}
              title={detail.applet.name}
              frameless
              lease={lease}
              onLeaseChange={onLeaseChange}
              focusRequestId={focusRequestId}
              onReady={() => void completeRuntime()}
              onRevoked={() => void failRuntime()}
            />
          ) : currentDraftPreview ? (
            <AppletPreview
              key={stageVersion.id}
              appletId={detail.applet.id}
              output={currentDraftPreview}
              storage="ephemeral"
              actions={stageActions}
              title={detail.applet.name}
              frameless
            />
          ) : (
            <p className="stage-empty">
              This version did not compile. Open Provenance below to see which check stopped it.
            </p>
          )}
          {run?.output && run.state === 'succeeded' ? (
            <div className="run-actions">
              <span>This run and its state are saved.</span>
              <CorrectionForm runId={run.id} onSaved={onChanged} />
            </div>
          ) : null}
        </section>
      ) : (
        <section className="publish-waiting">
          <h3>No version yet.</h3>
          <p>Ask the agent to create a React version. The app renders here as soon as one compiles.</p>
        </section>
      )}

      {active && !reviewing ? (
        <InputForm
          appletId={detail.applet.id}
          versionId={active.id}
          fields={active.inputs}
          onCompleted={onRun}
        />
      ) : null}
      {runtimeError ? <p className="form-error" role="alert">{runtimeError}</p> : null}
      {evaluationProgress ? <p className="evaluation-progress" role="status">{evaluationProgress}</p> : null}

      <details className="provenance">
        <summary>
          Provenance · {detail.applet.versionCount} version{detail.applet.versionCount === 1 ? '' : 's'} ·{' '}
          {detail.applet.evaluationCount} evaluation{detail.applet.evaluationCount === 1 ? '' : 's'} ·{' '}
          {detail.applet.runCount} run{detail.applet.runCount === 1 ? '' : 's'} ·{' '}
          {detail.applet.correctionCount} correction{detail.applet.correctionCount === 1 ? '' : 's'}
        </summary>
        <div className="provenance-body">
          {!active && latest ? (
            <section className="publish-waiting">
              <h3>Nothing runs for real until you publish a passing version.</h3>
              <p>The agent can draft and evaluate. Publishing needs your passkey.</p>
            </section>
          ) : null}
          {qualityVersion ? <QualityLedger report={qualityVersion.qualityReport} /> : null}
          <EvaluationRegister detail={detail} />
          <VersionRegister
            detail={detail}
            reviewVersionId={reviewVersionId}
            onReview={(versionId) => onReviewVersion(versionId)}
            onEvaluate={(versionId) => void evaluateVersion(versionId)}
            evaluatingVersionId={evaluatingVersionId}
          />
          <CorrectionRegister detail={detail} onChanged={onChanged} />
        </div>
      </details>
    </article>
  )
}
