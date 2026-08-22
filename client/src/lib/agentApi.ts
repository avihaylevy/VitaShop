// MILESTONE-011 Checkpoint B — the client half of POST /api/ai/chat.
//
// Rides the catalogue's OWN transport (requestCatalogJson — review finding:
// the first version re-created it line for line, dropping `fields` from the
// error envelope on the way). Product DTOs are validated by the CATALOGUE's
// own predicate — the agent renders the same cards from the same shape,
// never a parallel definition.

import { CatalogApiError, isCatalogProductDto, isPlainObject, requestCatalogJson } from './catalogApi.js'
import type { CatalogProductDto } from '../types/catalog.js'

export interface AgentChatTurn {
  role: 'user' | 'agent'
  content: string
}

export interface AgentChatResponseDto {
  products: CatalogProductDto[]
  explanations: string[]
  /** The server-injected FIXED referral notice, or null. Rendered verbatim. */
  notice: string | null
  /** Provider-authored clarifying prose (model output is data), or null. */
  clarifyingQuestion: string | null
  /** Server-detected clarify condition, translated client-side. */
  clarifyCode: 'NO_CRITERIA_MATCHED' | null
  medicalStop: boolean
  /**
   * REQ-F-077 — the criteria as /catalog URL params. Validated now, RENDERED
   * at Checkpoint C (the handoff button); typed here so C is a consumer, not
   * a schema change.
   */
  handoff: Record<string, string | string[]> | null
  emptyResult: boolean
  /** DEC-104 — true when the FIRST product is the server-validated top pick. */
  topPick: boolean
}

function isHandoff(value: unknown): value is Record<string, string | string[]> {
  if (!isPlainObject(value)) return false
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'string' ||
      (Array.isArray(entry) && entry.every((item) => typeof item === 'string')),
  )
}

function isAgentChatResponseDto(value: unknown): value is AgentChatResponseDto {
  if (!isPlainObject(value)) return false
  return (
    Array.isArray(value.products) &&
    value.products.every(isCatalogProductDto) &&
    Array.isArray(value.explanations) &&
    value.explanations.every((entry) => typeof entry === 'string') &&
    value.explanations.length === value.products.length &&
    (value.notice === null || typeof value.notice === 'string') &&
    (value.clarifyingQuestion === null || typeof value.clarifyingQuestion === 'string') &&
    (value.clarifyCode === null || value.clarifyCode === 'NO_CRITERIA_MATCHED') &&
    typeof value.medicalStop === 'boolean' &&
    (value.handoff === null || isHandoff(value.handoff)) &&
    typeof value.emptyResult === 'boolean' &&
    // topPick TOLERATES absence (review finding: a required field made a
    // client deployed ahead of the server reject EVERY reply — total
    // widget loss for a cosmetic badge). Absent normalises to false below.
    (value.topPick === undefined || typeof value.topPick === 'boolean')
  )
}

/**
 * Sends one chat turn. The CLIENT owns the whole conversation (DEC-091 O1 —
 * the server stores nothing); `history` is everything said so far, resent
 * each turn.
 *
 * Failures carry the server's own codes (AI_TURN_LIMIT, AI_PROVIDER_TIMEOUT,
 * AI_PROVIDER_FAILED, TOO_MANY_REQUESTS…) or the transport's codes, on the
 * same CatalogApiError class the rest of the client already maps. An aborted
 * request propagates unchanged, per the transport's contract.
 */
export async function sendAgentMessage(
  message: string,
  history: AgentChatTurn[],
  lang: 'he' | 'en',
  signal?: AbortSignal,
): Promise<AgentChatResponseDto> {
  const body = await requestCatalogJson('/api/ai/chat', signal, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, lang, history }),
  })
  if (!isAgentChatResponseDto(body)) {
    throw new CatalogApiError('INVALID_RESPONSE_SHAPE', 'The assistant returned a reply with an unexpected shape.')
  }
  // An older server omits topPick — normalised here so consumers keep the
  // non-optional boolean contract.
  return { ...body, topPick: body.topPick ?? false }
}
