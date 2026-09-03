'use client'

import { useState } from 'react'
import type { HumanAuthorityStatus } from '@/domain/human-authority'
import { enrollHumanAuthority } from '@/client/human-authority'

export function HumanAuthorityControl({
  status,
  onStatus,
}: {
  status: HumanAuthorityStatus | null
  onStatus: (status: HumanAuthorityStatus) => void
}) {
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState('')

  if (status?.enrolled) {
    return (
      <span
        className="human-key is-enrolled"
        title="Publishing, redaction, approvals, and leases require this passkey."
      >
        <span>Passkey · </span>ready
      </span>
    )
  }

  const enroll = async () => {
    setEnrolling(true)
    setError('')
    try {
      onStatus(await enrollHumanAuthority())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The passkey could not be created')
    } finally {
      setEnrolling(false)
    }
  }

  return (
    <span className="human-key-setup">
      <button
        type="button"
        className="human-key"
        disabled={enrolling || status === null}
        title="Create a passkey. Publishing and approvals will ask for your fingerprint, face, device PIN, or security key."
        onClick={() => void enroll()}
      >
        {enrolling ? 'Creating passkey…' : 'Set up passkey'}
      </button>
      {error ? <small role="alert">{error}</small> : null}
    </span>
  )
}
