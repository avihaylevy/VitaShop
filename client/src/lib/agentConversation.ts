// MILESTONE-011 Checkpoint B — the conversation's pure logic, extracted at
// review so the transcript rendering, the live-region announcement, and the
// wire history all derive from ONE place instead of three hand-kept copies.

import type { TFunction } from 'i18next'
import type { AgentChatResponseDto, AgentChatTurn } from './agentApi.js'

export type AgentEntry =
  | {
      kind: 'user'
      text: string
      /**
       * Set when the send FAILED (transport error, provider failure, abort).
       * A failed turn stays visible in the transcript but is excluded from
       * the wire history and from the turn budget — review finding: ten
       * outages used to lock a conversation the assistant never answered.
       */
      failed?: boolean
    }
  | {
      kind: 'agent'
      /**
       * The language the reply was REQUESTED in. Server-composed prose
       * (notice, provider question, explanations) is frozen in this
       * language; the transcript marks it with lang/dir so a later language
       * toggle renders correctly-attributed mixed content instead of an
       * unmarked RTL/LTR jumble (review finding).
       */
      lang: 'he' | 'en'
      response: AgentChatResponseDto
    }
  | { kind: 'error'; code: string }

/** Mirrors the server's turn cap (server aiChat.ts MAX_TURNS). The server enforces; this pre-empts the 400. */
export const AGENT_MAX_TURNS = 10

/**
 * 🔴 The lock counts ANSWERED exchanges (agent turns), not attempts. Derived
 * from settled entries only, so it can never flip mid-flight and unmount the
 * control the user just pressed (the async-control family). It matches the
 * server exactly: the server rejects when the HISTORY carries MAX_TURNS user
 * turns, and the wire history below ships one user turn per answered
 * exchange.
 */
export function isConversationLocked(entries: AgentEntry[]): boolean {
  const answered = entries.filter((entry) => entry.kind === 'agent').length
  const serverLocked = entries.some(
    (entry) => entry.kind === 'error' && entry.code === 'AI_TURN_LIMIT',
  )
  return answered >= AGENT_MAX_TURNS || serverLocked
}

/**
 * The wire history the server expects. Failed user turns and error entries
 * are records for the READER, not conversation the assistant took part in —
 * both are excluded, so the server never sees unanswered user/user
 * adjacency. Agent content is the provider's own words when it asked one
 * (clarifying question); otherwise empty — the server counts turns and the
 * provider speaks for itself, so nothing here invents assistant prose
 * (review finding: the first version shipped Hebrew product names as things
 * an English assistant "said").
 */
export function toWireHistory(entries: AgentEntry[]): AgentChatTurn[] {
  const turns: AgentChatTurn[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    if (entry.kind === 'user') {
      const next = entries[index + 1]
      if (entry.failed !== true && next?.kind === 'agent') {
        turns.push({ role: 'user', content: entry.text })
      }
    } else if (entry.kind === 'agent') {
      turns.push({ role: 'agent', content: entry.response.clarifyingQuestion ?? '' })
    }
  }
  return turns
}

export interface AgentTurnLine {
  text: string
  /**
   * Frozen server/provider prose (rendered with the turn's lang/dir) vs a
   * client i18n line that re-resolves on language toggle.
   */
  frozen: boolean
}

/**
 * 🔴 ONE source for what an agent turn SAYS. The transcript renders these
 * lines as paragraphs; the live region announces their join — so the screen
 * and the announcement can never diverge (review finding: a single-winner
 * ternary announced one line while the transcript stacked four). Order is
 * C2a's: the fixed notice always FIRST.
 */
export function describeTurn(
  response: AgentChatResponseDto,
  t: TFunction<'agent'>,
): AgentTurnLine[] {
  const lines: AgentTurnLine[] = []
  if (response.notice !== null) lines.push({ text: response.notice, frozen: true })
  if (response.medicalStop) lines.push({ text: t('reply.medicalStop'), frozen: false })
  if (response.clarifyingQuestion !== null) {
    lines.push({ text: response.clarifyingQuestion, frozen: true })
  }
  if (response.clarifyCode === 'NO_CRITERIA_MATCHED') {
    lines.push({ text: t('reply.noCriteria'), frozen: false })
  }
  if (response.emptyResult) lines.push({ text: t('reply.empty'), frozen: false })
  return lines
}

/**
 * Error-code → i18n key. AI_TURN_LIMIT maps to null: the lock block owns
 * that message (review finding: it used to render twice at once).
 */
export function errorMessageKey(code: string): string | null {
  if (code === 'AI_TURN_LIMIT') return null
  if (code === 'TOO_MANY_REQUESTS') return 'errors.rateLimited'
  if (code === 'AI_PROVIDER_TIMEOUT' || code === 'AI_PROVIDER_FAILED') return 'errors.unavailable'
  return 'errors.network'
}
