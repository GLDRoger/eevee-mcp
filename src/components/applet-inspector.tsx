'use client'

import { useEffect, useState } from 'react'
import type { AppletRun } from '@/domain/applet'
import type { AppletActionDefinition } from '@/domain/applet-action'
import type { AppletDetail } from '@/domain/api'
import { isPublishableQuality } from '@/domain/quality'
import { api } from '@/client/api'
import { evaluateAppletVersion } from '@/client/evaluation-worker'
import { AppletPreview } from './applet-preview'
import { CorrectionForm } from './correction-form'
import { InputForm } from './input-form'
import { QualityLedger } from './quality-ledger'

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
        <p className="version-empty">The applet exists. Its first executable version does not.</p>
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
                  <span className="version-state">Blocked</span>
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
          <h3 id="evaluations-title">Scenario register</h3>
        </div>
        <strong>{detail.evaluationRuns.length}</strong>
      </header>
      {suite ? (
        <p className="evaluation-suite-name">
          Suite r{suite.revision} · {suite.name} · {suite.cases.length} case{suite.cases.length === 1 ? '' : 's'}
        </p>
      ) : (
        <p className="version-empty">
          No behavioral suite exists. The agent must define repeatable actions and assertions before review.
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
                <span className="quality-status">{item.criticality} · {item.verdict}</span>
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
        Open proposals are the brief for the next version. When an agent submits a version that
        answers one, it can mark the proposal applied; dismiss the ones that no longer matter.
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
      await api.publishVersion(appletId, version.id)
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
          <p>Draft v{version.version} · ephemeral state</p>
          <h3 id="review-title">Review before publishing</h3>
        </div>
        <button
          className="primary-action"
          type="button"
          disabled={!ready || publishing}
          onClick={() => void publish()}
        >
          {publishing ? 'Publishing' : ready ? 'Approve & publish' : 'Waiting for runtime'}
        </button>
      </header>
      {report ? (
        <div className="review-evidence">
          <p className="review-evidence-summary">
            Candidate {report.candidate.verdict}
            {report.baseline
              ? ` · published baseline ${report.baseline.verdict} · ${report.regressions.length} regression${report.regressions.length === 1 ? '' : 's'}`
              : ' · first published version'}
          </p>
          <ol className="review-cases">
            {report.candidate.cases.map((item) => (
              <li key={item.caseId}>
                <span className={`quality-mark is-${item.verdict}`} aria-hidden="true" />
                <div>
                  <strong>{item.name}</strong>
                  <ol className="review-steps">
                    {item.steps.map((step) => (
                      <li key={step.index} className={step.verdict === 'fail' ? 'is-fail' : undefined}>
                        <code>{step.action}</code> {step.detail}
                      </li>
                    ))}
                  </ol>
                </div>
                <span className="quality-status">{item.criticality} · {item.verdict}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="review-evidence-summary is-missing">
          No stored behavioral evidence is bound to this candidate yet.
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
              {sourceFiles.length} typed source file{sourceFiles.length === 1 ? '' : 's'} — open one
              to read exactly what you are approving.
            </p>
          )}
        </div>
      ) : null}
      {preview ? (
        <AppletPreview
          appletId={appletId}
          output={preview}
          storage="ephemeral"
          actions={actions}
          title="Draft specimen"
          onReady={() => setReady(true)}
          onRevoked={() => setReady(false)}
        />
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  )
}

export function AppletInspector({
  detail,
  run,
  reviewVersionId,
  onRun,
  onReviewVersion,
  onChanged,
}: {
  detail: AppletDetail
  run: AppletRun | null
  reviewVersionId: string | null
  onRun: (run: AppletRun) => void
  onReviewVersion: (versionId: string | null) => void
  onChanged: () => void
}) {
  const [runtimeError, setRuntimeError] = useState('')
  const [evaluationError, setEvaluationError] = useState('')
  const [evaluationProgress, setEvaluationProgress] = useState('')
  const [evaluatingVersionId, setEvaluatingVersionId] = useState<string | null>(null)
  const [view, setView] = useState<'app' | 'code'>('app')
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
  // The version the stage shows: the published one when it exists, else the
  // newest draft — so the actual app is the first thing on the page even
  // before anything is published or run.
  const stageVersion = active ?? latest
  const stageVersionId = stageVersion?.id
  const showDraftPreview = !run?.output && stageVersionId !== undefined
  // A preview is only current when it belongs to the version on stage, so a
  // stale one from the previous applet or version never flashes.
  const currentDraftPreview =
    draftPreview && draftPreview.versionId === stageVersionId ? draftPreview.output : null

  useEffect(() => {
    if (!showDraftPreview || view !== 'app' || stageVersionId === undefined) return
    const controller = new AbortController()
    void api
      .previewVersion(detail.applet.id, stageVersionId, controller.signal)
      .then((response) => setDraftPreview({ versionId: stageVersionId, output: response.preview }))
      .catch(() => {
        // A draft without a compiled artifact has nothing to render; the
        // provenance drawer explains what failed.
      })
    return () => controller.abort()
  }, [detail.applet.id, stageVersionId, showDraftPreview, view])

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
    setEvaluationProgress('Starting browser scenarios')
    try {
      const response = await evaluateAppletVersion(
        detail.applet.id,
        versionId,
        detail.evaluationSuites[0]?.id,
        undefined,
        setEvaluationProgress,
      )
      if (response.run.state !== 'passed') {
        setEvaluationError('The version failed one or more required behavioral scenarios.')
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
      <header className="inspector-heading">
        <div>
          <span>{detail.applet.medium.replace('-', ' ')}</span>
          <h2>{detail.applet.name}</h2>
          <p>{detail.applet.description}</p>
        </div>
        <p className="inspector-status">
          {active
            ? `v${active.version} published`
            : latest
              ? `draft v${latest.version} · not yet published`
              : 'waiting for the agent'}
          {latest && active && latest.id !== active.id ? ` · draft v${latest.version} in progress` : ''}
        </p>
      </header>

      {reviewing ? (
        <VersionReview
          key={reviewing.id}
          appletId={detail.applet.id}
          version={reviewing}
          detail={detail}
          onPublished={() => {
            onReviewVersion(null)
            onChanged()
          }}
        />
      ) : stageVersion ? (
        <section className="stage" aria-label="Applet">
          <div className="stage-bar">
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
            <span className="stage-note">
              {run?.output
                ? `run ${run.id.slice(0, 8)} · ${run.state} · durable state`
                : active && stageVersion.id === active.id
                  ? 'published version · preview state'
                  : `draft v${stageVersion.version} · preview state`}
            </span>
          </div>
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
              <p className="stage-empty">The source for this version is loading.</p>
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
            />
          ) : (
            <p className="stage-empty">
              This version has no runnable build yet. Open Provenance below to see which check
              stopped it.
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
          <h3>The agent has not submitted a version yet.</h3>
          <p>Ask it to create a typed React version; the app will render here the moment one compiles.</p>
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
      {evaluationError ? <p className="form-error" role="alert">{evaluationError}</p> : null}

      <details className="provenance">
        <summary>
          Provenance — {detail.applet.versionCount} version{detail.applet.versionCount === 1 ? '' : 's'} ·{' '}
          {detail.applet.evaluationCount} evaluation{detail.applet.evaluationCount === 1 ? '' : 's'} ·{' '}
          {detail.applet.runCount} run{detail.applet.runCount === 1 ? '' : 's'} ·{' '}
          {detail.applet.correctionCount} correction{detail.applet.correctionCount === 1 ? '' : 's'}
        </summary>
        <div className="provenance-body">
          {!active && latest ? (
            <section className="publish-waiting">
              <h3>Nothing runs durably until a person publishes a passing version.</h3>
              <p>The browser agent can draft and evaluate. The final decision remains here.</p>
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
