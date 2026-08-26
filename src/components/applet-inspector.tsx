'use client'

import { useEffect, useState } from 'react'
import type { AppletRun } from '@/domain/applet'
import type { AppletDetail } from '@/domain/api'
import { isPublishableQuality } from '@/domain/quality'
import { api } from '@/client/api'
import { AppletPreview } from './applet-preview'
import { CorrectionForm } from './correction-form'
import { InputForm } from './input-form'
import { QualityLedger } from './quality-ledger'

const date = new Intl.DateTimeFormat('en', { day: '2-digit', month: 'short', year: 'numeric' })

function VersionRegister({
  detail,
  reviewVersionId,
  onReview,
}: {
  detail: AppletDetail
  reviewVersionId: string | null
  onReview: (versionId: string) => void
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
            const publishable = isPublishableQuality(version.qualityReport)
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
                ) : publishable ? (
                  <button type="button" onClick={() => onReview(version.id)}>Review</button>
                ) : (
                  <span className="version-state">Blocked</span>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function CorrectionRegister({ detail }: { detail: AppletDetail }) {
  if (detail.corrections.length === 0) return null
  return (
    <section className="correction-register" aria-labelledby="corrections-title">
      <header>
        <h3 id="corrections-title">Correction proposals</h3>
        <span>{detail.corrections.length}</span>
      </header>
      <ol>
        {detail.corrections.map((item) => (
          <li key={item.id}>
            <strong>{item.instruction}</strong>
            <p>{item.desiredOutcome}</p>
            <span>{item.state}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function VersionReview({
  appletId,
  version,
  onPublished,
}: {
  appletId: string
  version: AppletDetail['versions'][number]
  onPublished: () => void
}) {
  const [preview, setPreview] = useState<AppletRun['output']>(null)
  const [ready, setReady] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void api
      .previewVersion(appletId, version.id, controller.signal)
      .then((response) => setPreview(response.preview))
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
      {preview ? (
        <AppletPreview
          appletId={appletId}
          output={preview}
          storage="ephemeral"
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
  const latest = detail.versions[0]
  const active = detail.versions.find(({ id }) => id === detail.applet.activeVersionId)
  const reviewing = detail.versions.find(({ id }) => id === reviewVersionId)
  const qualityVersion = reviewing ?? latest

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

  return (
    <article className="inspector">
      <header className="inspector-heading">
        <div>
          <span>{detail.applet.medium.replace('-', ' ')}</span>
          <h2>{detail.applet.name}</h2>
          <p>{detail.applet.description}</p>
        </div>
        <dl>
          <div><dt>Versions</dt><dd>{detail.applet.versionCount}</dd></div>
          <div><dt>Runs</dt><dd>{detail.applet.runCount}</dd></div>
          <div><dt>Corrections</dt><dd>{detail.applet.correctionCount}</dd></div>
        </dl>
      </header>

      {reviewing ? (
        <VersionReview
          key={reviewing.id}
          appletId={detail.applet.id}
          version={reviewing}
          onPublished={() => {
            onReviewVersion(null)
            onChanged()
          }}
        />
      ) : null}

      {active ? (
        <InputForm
          appletId={detail.applet.id}
          versionId={active.id}
          fields={active.inputs}
          onCompleted={onRun}
        />
      ) : (
        <section className="publish-waiting">
          <h3>Nothing runs until a person publishes a passing version.</h3>
          <p>The browser agent can draft and evaluate. The final decision remains here.</p>
        </section>
      )}

      {run?.output ? (
        <>
          <AppletPreview
            key={run.id}
            appletId={detail.applet.id}
            output={run.output}
            storage="durable"
            onReady={() => void completeRuntime()}
            onRevoked={() => void failRuntime()}
          />
          <div className="run-actions">
            <span>Run {run.id.slice(0, 8)} · {run.state}</span>
            {run.state === 'succeeded' ? <CorrectionForm runId={run.id} onSaved={onChanged} /> : null}
          </div>
        </>
      ) : null}
      {runtimeError ? <p className="form-error" role="alert">{runtimeError}</p> : null}

      {qualityVersion ? <QualityLedger report={qualityVersion.qualityReport} /> : null}
      <VersionRegister
        detail={detail}
        reviewVersionId={reviewVersionId}
        onReview={(versionId) => onReviewVersion(versionId)}
      />
      <CorrectionRegister detail={detail} />
    </article>
  )
}
