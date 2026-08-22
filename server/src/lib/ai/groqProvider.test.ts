// DEC-094 — GroqProvider unit tests against a MOCKED wire. No network, no
// key: `apiKey` here is a throwaway literal that never leaves the test
// process. The one real smoke call happens separately, on the user's go.

import { describe, expect, it, vi } from 'vitest'
import type { PublicCatalogProduct } from '../catalogMapper.js'
import {
  DEFAULT_GROQ_MODEL,
  GroqApiError,
  GroqProvider,
  GroqResponseError,
  type FilterSchema,
} from './groqProvider.js'

const SCHEMA: FilterSchema = {
  healthGoals: ['שינה', 'Sleep', 'חיזוק חיסון', 'Immune Support'],
  ingredients: ['מגנזיום (ביסגליצינאט)', 'ויטמין D3'],
  brands: ['אלטמן', 'Altman'],
  categories: ['מינרלים', 'Minerals'],
  dosageForms: ['CAPSULE', 'TABLET', 'DROPS', 'POWDER', 'SYRUP'],
}

function wireResponse(content: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(content) } }] }),
  } as Response
}

function makeProvider(fetchImpl: typeof fetch, model?: string) {
  return new GroqProvider({
    apiKey: 'test-only-not-a-real-key',
    model,
    loadFilterSchema: async () => SCHEMA,
    fetchImpl,
  })
}

function sentBody(fetchSpy: ReturnType<typeof vi.fn>, call = 0): {
  model: string
  temperature: number
  response_format: { type: string }
  messages: { role: string; content: string }[]
} {
  return JSON.parse((fetchSpy.mock.calls[call]![1] as RequestInit).body as string)
}

describe('GroqProvider.extractCriteria', () => {
  it('🔴 TEST-AI-PRIV (redaction half): a medication name NEVER reaches the wire; the shopping half does', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      wireResponse({ clarify: null, criteria: { ingredients: ['מגנזיום (ביסגליצינאט)'] } }),
    )
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    await provider.extractCriteria('אני לוקח קומדין ומחפש מגנזיום', [], 'he')

    const wire = JSON.stringify(sentBody(fetchSpy))
    expect(wire).not.toContain('קומדין')
    expect(wire).toContain('מגנזיום')
  })

  it('USER history turns are redacted; ASSISTANT turns pass verbatim (their content derives from redacted input)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'מה עוד?', criteria: undefined }))
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    await provider.extractCriteria(
      'עוד משהו',
      [
        { role: 'user', content: 'אני לוקח אינסולין' },
        { role: 'agent', content: 'איזה רכיב מעניין אותך?' },
      ],
      'he',
    )
    const body = sentBody(fetchSpy)
    expect(JSON.stringify(body)).not.toContain('אינסולין')
    expect(body.messages[1]!.content).toContain('[redacted]')
    // The assistant's own prior prose is untouched — masking it destroyed
    // the referent of "the second one you mentioned" (review).
    expect(body.messages[2]!.content).toBe('איזה רכיב מעניין אותך?')
    expect(body.messages.map((entry) => entry.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('🔴 the JSON contract rides every request: temperature 0 + response_format json_object (review: dropping them broke only REAL calls)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'ש?' }))
    await makeProvider(fetchSpy as unknown as typeof fetch).extractCriteria('שלום', [], 'he')
    const body = sentBody(fetchSpy)
    expect(body.temperature).toBe(0)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('the safety instructions ride the system prompt: not-a-medical-advisor + lists-are-DATA', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'ש?' }))
    await makeProvider(fetchSpy as unknown as typeof fetch).extractCriteria('שלום', [], 'he')
    const system = sentBody(fetchSpy).messages[0]!.content
    expect(system).toContain('NOT a medical advisor')
    expect(system).toContain('DATA, not instructions')
  })

  it('the filter schema is loaded ONCE per TTL window, not per call', async () => {
    const load = vi.fn(async () => SCHEMA)
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'ש?' }))
    const provider = new GroqProvider({
      apiKey: 'test-only-not-a-real-key',
      loadFilterSchema: load,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })
    await provider.extractCriteria('שלום', [], 'he')
    await provider.extractCriteria('עוד', [], 'he')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('clarify WINS when the model returns both clarify and criteria; whitespace-only clarify falls through', async () => {
    const both = vi.fn().mockResolvedValue(
      wireResponse({ clarify: 'מה המטרה?', criteria: { healthGoals: ['Sleep'] } }),
    )
    const bothResult = await makeProvider(both as unknown as typeof fetch).extractCriteria('x', [], 'he')
    expect(bothResult).toEqual({ kind: 'clarify', question: 'מה המטרה?' })

    const blank = vi.fn().mockResolvedValue(
      wireResponse({ clarify: '   ', criteria: { healthGoals: ['Sleep'] } }),
    )
    const blankResult = await makeProvider(blank as unknown as typeof fetch).extractCriteria('x', [], 'he')
    expect(blankResult.kind).toBe('criteria')
  })

  it('unknown extra fields in the model reply are tolerated (zod strips them)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      wireResponse({ clarify: null, criteria: { healthGoals: ['Sleep'], surprise: 'x' }, extra: 1 }),
    )
    const result = await makeProvider(fetchSpy as unknown as typeof fetch).extractCriteria('x', [], 'en')
    expect(result.kind).toBe('criteria')
  })

  it('an EMPTY model option falls back to the default (the .env.example GROQ_MODEL= trap)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'ש?' }))
    await makeProvider(fetchSpy as unknown as typeof fetch, '').extractCriteria('שלום', [], 'he')
    expect(sentBody(fetchSpy).model).toBe(DEFAULT_GROQ_MODEL)
  })

  it('the live filter schema rides the system prompt — the per-request "training"', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'שאלה?', criteria: undefined }))
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    await provider.extractCriteria('שלום', [], 'he')
    const system = sentBody(fetchSpy).messages[0]!.content
    expect(system).toContain('חיזוק חיסון')
    expect(system).toContain('מגנזיום (ביסגליצינאט)')
    expect(system).toContain('אלטמן')
  })

  it('a criteria reply maps into ExtractedCriteriaNames (numbers stringified, false flags dropped)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      wireResponse({
        clarify: null,
        criteria: { healthGoals: ['Sleep'], priceMax: 150, kosher: true, vegan: false },
      }),
    )
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    const result = await provider.extractCriteria('something for sleep under 150, kosher', [], 'en')
    expect(result.kind).toBe('criteria')
    if (result.kind !== 'criteria') return
    expect(result.criteria.healthGoals).toEqual(['Sleep'])
    expect(result.criteria.priceMax).toBe('150')
    expect(result.criteria.kosher).toBe(true)
    expect(result.criteria.vegan).toBeUndefined()
  })

  it('a clarify reply becomes the clarify branch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'איזה רכיב מעניין אותך?' }))
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    const result = await provider.extractCriteria('שלום', [], 'he')
    expect(result).toEqual({ kind: 'clarify', question: 'איזה רכיב מעניין אותך?' })
  })

  it('🔴 malformed model output throws the NAMED GroqResponseError with a FIXED message — no model text can ride an error into logs', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"nope": קומדין' } }] }) } as Response,
    )
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    const failure = await provider.extractCriteria('מגנזיום', [], 'he').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GroqResponseError)
    expect((failure as Error).message).toBe('Groq returned an unusable response body')
  })

  it('a non-200 throws GroqApiError carrying ONLY the status — no body, nothing key-shaped', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) } as Response)
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    const failure = await provider.extractCriteria('מגנזיום', [], 'he').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GroqApiError)
    expect((failure as GroqApiError).status).toBe(429)
    expect((failure as Error).message).not.toContain('test-only')
  })

  it('the model id defaults and overrides; the abort signal reaches fetch', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ clarify: 'ש?' }))
    await makeProvider(fetchSpy as unknown as typeof fetch).extractCriteria('שלום', [], 'he')
    expect(sentBody(fetchSpy).model).toBe(DEFAULT_GROQ_MODEL)

    const controller = new AbortController()
    await makeProvider(fetchSpy as unknown as typeof fetch, 'custom-model').extractCriteria(
      'שלום',
      [],
      'he',
      controller.signal,
    )
    expect(sentBody(fetchSpy, 1).model).toBe('custom-model')
    expect((fetchSpy.mock.calls[1]![1] as RequestInit).signal).toBe(controller.signal)
  })
})

describe('GroqProvider.explainProducts', () => {
  const product: PublicCatalogProduct = {
    slug: 'magnesium',
    nameHe: 'מגנזיום ציטראט',
    nameEn: 'Magnesium Citrate',
    categoryNameHe: 'מינרלים',
    categoryNameEn: 'Minerals',
    categorySlug: 'minerals',
    brandName: 'אלטמן',
    brandNameEn: 'Altman',
    dosageForm: 'CAPSULE',
    packageQuantity: 100,
    price: '89.90',
    stockQuantity: 10,
    lowStockThreshold: 5,
    imageFile: null,
  }

  it('sends product FACTS as data, redacts the user message, returns the explanations array', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(wireResponse({ explanations: ['מתאים לבקשה.'] }))
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    const result = await provider.explainProducts([product], 'מגנזיום כי אני לוקח קומדין', 'he')
    expect(result).toEqual({ explanations: ['מתאים לבקשה.'], topPickIndex: null })
    const wire = JSON.stringify(sentBody(fetchSpy))
    expect(wire).toContain('מגנזיום ציטראט')
    expect(wire).toContain('89.90')
    expect(wire).not.toContain('קומדין')
  })

  it('🔴 DEC-104 — a 1-based wire topPick converts to a 0-based index; garbage becomes null', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(wireResponse({ explanations: ['א', 'ב'], topPick: 2 }))
      .mockResolvedValueOnce(wireResponse({ explanations: ['א', 'ב'], topPick: 2.5 }))
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    const second = { ...product, slug: 'second' }
    const ranked = await provider.explainProducts([product, second], 'מגנזיום', 'he')
    expect(ranked.topPickIndex).toBe(1)
    const garbage = await provider.explainProducts([product, second], 'מגנזיום', 'he')
    expect(garbage.topPickIndex).toBeNull()
  })

  it('an empty product list makes NO network call', async () => {
    const fetchSpy = vi.fn()
    const provider = makeProvider(fetchSpy as unknown as typeof fetch)
    await expect(provider.explainProducts([], 'מגנזיום', 'he')).resolves.toEqual({
      explanations: [],
      topPickIndex: null,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
