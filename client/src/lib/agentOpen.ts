/**
 * 2026-09-06 — the home hero's "Ask" sticker opens the AI assistant.
 *
 * The widget owns its open state (AgentWidget mounts once at the app root),
 * and the hero sits in a page far below it. Rather than lifting that state
 * into a context every page would have to provide, the hero RAISES A
 * REQUEST and the widget LISTENS: one DOM event, no shared state, no
 * coupling between the page and the widget beyond this name.
 *
 * The widget stays the only place that decides what "open" means (it also
 * closes the cart drawer, moves focus, announces).
 */

export const AGENT_OPEN_EVENT = 'vitashop:agent-open'

export function requestAgentOpen(): void {
  window.dispatchEvent(new CustomEvent(AGENT_OPEN_EVENT))
}

/** Subscribe; returns the unsubscribe for an effect's cleanup. */
export function onAgentOpenRequest(handler: () => void): () => void {
  window.addEventListener(AGENT_OPEN_EVENT, handler)
  return () => window.removeEventListener(AGENT_OPEN_EVENT, handler)
}
