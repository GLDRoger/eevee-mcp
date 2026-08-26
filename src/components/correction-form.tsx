'use client'

import { useState, type FormEvent } from 'react'
import { api } from '@/client/api'

export function CorrectionForm({ runId, onSaved }: { runId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const instruction = form.get('instruction')
    const observedIssue = form.get('observedIssue')
    const desiredOutcome = form.get('desiredOutcome')
    if (
      typeof instruction !== 'string' ||
      typeof observedIssue !== 'string' ||
      typeof desiredOutcome !== 'string'
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.createCorrection(runId, { instruction, observedIssue, desiredOutcome })
      setOpen(false)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The correction was not saved')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button className="text-action" type="button" onClick={() => setOpen(true)}>
        Record a correction
      </button>
    )
  }

  return (
    <form className="correction-form" onSubmit={(event) => void submit(event)}>
      <header>
        <h3>Teach from this run</h3>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </header>
      <label>
        What did you change?
        <input name="instruction" required maxLength={2_000} />
      </label>
      <label>
        What was wrong?
        <textarea name="observedIssue" required maxLength={2_000} rows={3} />
      </label>
      <label>
        What should future runs do?
        <textarea name="desiredOutcome" required maxLength={2_000} rows={3} />
      </label>
      <button className="primary-action" type="submit" disabled={saving}>
        {saving ? 'Saving proposal' : 'Save correction proposal'}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  )
}
