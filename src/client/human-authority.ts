'use client'

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser'
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server'
import type {
  HumanAuthorityResult,
  HumanAuthorityScope,
  HumanAuthorityStatus,
} from '@/domain/human-authority'
import { api } from './api'

const readablePasskeyError = (error: unknown): Error => {
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return new Error('The human passkey prompt was cancelled or timed out')
  }
  return error instanceof Error ? error : new Error('The human passkey could not be verified')
}

export const humanAuthoritySupported = (): boolean => browserSupportsWebAuthn()

export const enrollHumanAuthority = async (
  signal?: AbortSignal,
): Promise<HumanAuthorityStatus> => {
  if (!humanAuthoritySupported()) throw new Error('This browser does not support passkeys')
  try {
    const envelope = await api.humanAuthorityRegistrationOptions(signal)
    const response = await startRegistration({
      optionsJSON: envelope.options as unknown as PublicKeyCredentialCreationOptionsJSON,
    })
    return api.verifyHumanAuthorityRegistration(envelope.challengeId, response, signal)
  } catch (error) {
    throw readablePasskeyError(error)
  }
}

export const authorizeHuman = async (
  scope: HumanAuthorityScope,
  signal?: AbortSignal,
): Promise<HumanAuthorityResult> => {
  if (!humanAuthoritySupported()) throw new Error('This browser does not support passkeys')
  try {
    const envelope = await api.humanAuthorizationOptions(scope, signal)
    const response = await startAuthentication({
      optionsJSON: envelope.options as unknown as PublicKeyCredentialRequestOptionsJSON,
    })
    return api.verifyHumanAuthorization(envelope.challengeId, response, signal)
  } catch (error) {
    throw readablePasskeyError(error)
  }
}
