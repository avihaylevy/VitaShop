// DEC-094 — provider selection tests: the boot-never-fails invariant and
// the loud mock fallback. Env values here are throwaway literals.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveAIProvider } from './provider.js'
import { GroqProvider } from './groqProvider.js'
import { MockProvider } from './mockProvider.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('resolveAIProvider', () => {
  it('defaults to the mock with no configuration', async () => {
    vi.stubEnv('AI_PROVIDER', '')
    vi.stubEnv('GROQ_API_KEY', '')
    expect(await resolveAIProvider()).toBeInstanceOf(MockProvider)
  })

  it('🔴 AI_PROVIDER=groq WITHOUT a key falls back to the mock LOUDLY — never a throw', async () => {
    vi.stubEnv('AI_PROVIDER', 'groq')
    vi.stubEnv('GROQ_API_KEY', '')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await resolveAIProvider()).toBeInstanceOf(MockProvider)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('GROQ_API_KEY is not set'))
  })

  it('AI_PROVIDER=groq WITH a key selects the GroqProvider', async () => {
    vi.stubEnv('AI_PROVIDER', 'groq')
    vi.stubEnv('GROQ_API_KEY', 'test-only-not-a-real-key')
    expect(await resolveAIProvider()).toBeInstanceOf(GroqProvider)
  })

  it('an unknown value resolves to the mock', async () => {
    vi.stubEnv('AI_PROVIDER', 'something-else')
    expect(await resolveAIProvider()).toBeInstanceOf(MockProvider)
  })

  it('a whitespace-only key falls back to the mock (a real trailing-space paste)', async () => {
    vi.stubEnv('AI_PROVIDER', 'groq')
    vi.stubEnv('GROQ_API_KEY', '   ')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await resolveAIProvider()).toBeInstanceOf(MockProvider)
  })

  it('🔴 a key with a control/non-ASCII character falls back LOUDLY — and the log line never carries the value', async () => {
    // Review — a real leak path: Node's Headers constructor THROWS with the
    // header VALUE in the TypeError message for values like this, and the
    // route console.errors provider failures. The shape guard must reject
    // it here, before a request object ever exists.
    vi.stubEnv('AI_PROVIDER', 'groq')
    vi.stubEnv('GROQ_API_KEY', 'gsk_fake\rbroken')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await resolveAIProvider()).toBeInstanceOf(MockProvider)
    const logged = errorSpy.mock.calls.map((call) => call.join(' ')).join(' ')
    expect(logged).toContain('cannot travel in an HTTP header')
    expect(logged).not.toContain('gsk_fake')
  })
})
