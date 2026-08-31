'use client'

import { useEffect, useMemo, useState } from 'react'
import type { DocumentReview as DocumentReviewResult } from '@/domain/document-review'
import type { OfficeFileSummary } from '@/domain/office-file'
import { api } from '@/client/api'

const findingLabel = {
  email: 'Email address',
  phone: 'Phone number',
  'government-id': 'Government ID',
  'payment-card': 'Payment card',
} as const

export function DocumentReview({
  file,
  requestedFindingIds = [],
  onChanged,
}: {
  file: OfficeFileSummary
  requestedFindingIds?: readonly string[]
  onChanged: () => void
}) {
  const [review, setReview] = useState<DocumentReviewResult | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const requestedKey = useMemo(() => [...requestedFindingIds].sort().join(','), [requestedFindingIds])

  const scan = async (preselected: readonly string[] = []) => {
    setLoading(true)
    setError('')
    try {
      const response = await api.scanDocumentReview(file.id)
      setReview(response.review)
      const available = new Set(response.review.findings.map(({ id }) => id))
      setSelected(new Set(preselected.filter((id) => available.has(id))))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Private review could not scan this file')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!requestedKey) return
    const controller = new AbortController()
    void api
      .scanDocumentReview(file.id, controller.signal)
      .then(({ review: next }) => {
        const requested = new Set(requestedKey.split(','))
        setReview(next)
        setSelected(new Set(next.findings.filter(({ id }) => requested.has(id)).map(({ id }) => id)))
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Private review could not scan this file')
        }
      })
    return () => controller.abort()
  }, [file.id, file.versionId, requestedKey])

  const toggle = (findingId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(findingId)) next.delete(findingId)
      else next.add(findingId)
      return next
    })
  }

  const apply = async () => {
    if (!review || selected.size === 0) return
    setApplying(true)
    setError('')
    try {
      await api.applyDocumentRedactions(file.id, review.versionId, [...selected])
      setReview(null)
      setSelected(new Set())
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The reviewed redactions were not saved')
    } finally {
      setApplying(false)
    }
  }

  return (
    <section className="document-review" aria-labelledby="document-review-title">
      <header>
        <div>
          <p>System application · human decision</p>
          <h3 id="document-review-title">Private review</h3>
        </div>
        <button type="button" disabled={loading || applying} onClick={() => void scan()}>
          {loading ? 'Scanning' : review ? 'Scan again' : 'Scan current version'}
        </button>
      </header>
      <p className="document-review-intro">
        EEVEE detects sensitive text without returning the original values to the agent. Selected
        text is removed from the DOCX XML and saved as a new immutable version.
      </p>
      {review ? (
        review.supported ? (
          <>
            <p className="document-review-limit">{review.limitation}</p>
            {review.findings.length === 0 ? (
              <p className="document-review-empty">No supported sensitive patterns were found.</p>
            ) : (
              <fieldset>
                <legend>{review.findings.length} masked finding{review.findings.length === 1 ? '' : 's'}</legend>
                <ol>
                  {review.findings.map((finding) => (
                    <li key={finding.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(finding.id)}
                          onChange={() => toggle(finding.id)}
                        />
                        <span>
                          <strong>{findingLabel[finding.type]}</strong>
                          <code>{finding.masked}</code>
                          <small>{finding.part} · occurrence {finding.occurrence}</small>
                        </span>
                      </label>
                    </li>
                  ))}
                </ol>
              </fieldset>
            )}
            {review.findings.length > 0 ? (
              <button
                className="primary-action"
                type="button"
                disabled={selected.size === 0 || applying}
                onClick={() => void apply()}
              >
                {applying ? 'Saving reviewed version' : `Remove ${selected.size} selected`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="document-review-limit">{review.limitation}</p>
        )
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  )
}
