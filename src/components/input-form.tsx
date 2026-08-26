'use client'

import { useState, type FormEvent } from 'react'
import type { AppletRun } from '@/domain/applet'
import type { InputDefinition, InputField } from '@/domain/input'
import type { JsonValue } from '@/domain/json'
import { api } from '@/client/api'

const valueFor = (field: InputField, form: FormData): JsonValue | undefined => {
  if (field.kind === 'boolean') return form.get(field.key) === 'on'
  const raw = form.get(field.key)
  if (typeof raw !== 'string' || raw === '') return undefined
  return field.kind === 'number' ? Number(raw) : raw
}

function Field({ field }: { field: InputField }) {
  const common = {
    id: `input-${field.key}`,
    name: field.key,
    required: field.kind === 'boolean' ? false : field.required,
    'aria-describedby': `help-${field.key}`,
  }
  return (
    <label className="run-field" htmlFor={common.id}>
      <span>
        {field.label}
        {field.required ? <b>Required</b> : null}
      </span>
      {field.kind === 'choice' ? (
        <select {...common} defaultValue={field.defaultValue ?? ''}>
          <option value="" disabled={field.required}>
            Choose
          </option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.kind === 'boolean' ? (
        <input {...common} type="checkbox" defaultChecked={field.defaultValue ?? false} />
      ) : (
        <input
          {...common}
          type={field.kind === 'number' ? 'number' : 'text'}
          defaultValue={field.defaultValue ?? ''}
          {...(field.kind === 'number'
            ? { min: field.minimum, max: field.maximum, step: field.step }
            : { minLength: field.minLength, maxLength: field.maxLength })}
        />
      )}
      <small id={`help-${field.key}`}>{field.description}</small>
    </label>
  )
}

export function InputForm({
  appletId,
  versionId,
  fields,
  onCompleted,
}: {
  appletId: string
  versionId: string
  fields: InputDefinition
  onCompleted: (run: AppletRun) => void
}) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setRunning(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const input = Object.fromEntries(
      fields.flatMap((field) => {
        const value = valueFor(field, form)
        return value === undefined ? [] : [[field.key, value]]
      }),
    )
    try {
      const response = await api.runApplet(appletId, { input })
      onCompleted(response.run)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'This run failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <form className="run-form" key={versionId} onSubmit={(event) => void submit(event)}>
      <header>
        <div>
          <p>Published inputs</p>
          <h3>Run this applet</h3>
        </div>
        <button type="submit" disabled={running}>
          {running ? 'Running' : 'Run version'}
        </button>
      </header>
      {fields.length === 0 ? (
        <p className="run-form-empty">This applet runs without asking for anything.</p>
      ) : (
        <div className="run-fields">{fields.map((field) => <Field key={field.key} field={field} />)}</div>
      )}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </form>
  )
}
