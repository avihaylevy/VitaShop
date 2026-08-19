// MILESTONE-011 Checkpoint C — REQ-F-077's round-trip proof: the handoff
// path the agent builds parses back, through /catalog's OWN parser
// (imported directly — the test shares no helper with the code under
// test), into exactly the criteria the server resolved. Controls in both
// directions: keys the catalogue does not read, internal state fields,
// empty values, and arrays on scalar params must all be dropped or
// truncated — never forwarded into a link that would lie or break.

import { describe, expect, it } from 'vitest'
import { parseCatalogUrlState } from '../features/catalog/catalogUrlState'
import { handoffToCatalogPath } from './agentHandoff'

function parsePath(path: string) {
  const queryIndex = path.indexOf('?')
  return parseCatalogUrlState(new URLSearchParams(queryIndex === -1 ? '' : path.slice(queryIndex + 1)))
}

describe('handoffToCatalogPath', () => {
  it('🔴 round trip: every supported criterion survives into parseCatalogUrlState', () => {
    const path = handoffToCatalogPath({
      category: 'minerals',
      ingredient: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'],
      healthGoal: ['33333333-3333-4333-8333-333333333333'],
      brand: ['44444444-4444-4444-8444-444444444444'],
      dosageForm: ['CAPSULE', 'DROPS'],
      minPrice: '20',
      maxPrice: '100',
      inStock: 'true',
      kosher: 'true',
      glutenFree: 'true',
      vegan: 'true',
    })
    expect(path.startsWith('/catalog?')).toBe(true)

    const state = parsePath(path)
    expect(state.category).toBe('minerals')
    expect(state.ingredient).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
    expect(state.healthGoal).toEqual(['33333333-3333-4333-8333-333333333333'])
    expect(state.brand).toEqual(['44444444-4444-4444-8444-444444444444'])
    expect(state.dosageForm).toEqual(['CAPSULE', 'DROPS'])
    expect(state.minPrice).toBe('20')
    expect(state.maxPrice).toBe('100')
    expect(state.inStock).toBe('true')
    expect(state.kosher).toBe('true')
    expect(state.glutenFree).toBe('true')
    expect(state.vegan).toBe('true')
  })

  it('control: an unknown key is dropped, never forwarded into the URL', () => {
    expect(handoffToCatalogPath({ maxPrice: '50', bogusParam: 'x' })).toBe('/catalog?maxPrice=50')
  })

  it('🔴 control: pageRaw — a real client STATE field that is not a URL param — is dropped', () => {
    // Review finding: the first allowlist was EMPTY_CATALOG_URL_STATE's
    // keys, which admitted pageRaw. This is the known-answer case the
    // bogus-key control could never represent.
    expect(handoffToCatalogPath({ maxPrice: '50', pageRaw: '3' })).toBe('/catalog?maxPrice=50')
  })

  it('control: empty-string values are dropped (no bare `key=` the server would 400 on)', () => {
    expect(handoffToCatalogPath({ maxPrice: '', kosher: 'true' })).toBe('/catalog?kosher=true')
  })

  it('control: an array on a SCALAR param keeps only its first entry (firstValue semantics)', () => {
    // Review finding: emitting maxPrice twice makes the URL claim criteria
    // the catalogue silently halves.
    expect(handoffToCatalogPath({ maxPrice: ['20', '100'] })).toBe('/catalog?maxPrice=20')
  })

  it('an empty handoff produces the bare catalogue path', () => {
    expect(handoffToCatalogPath({})).toBe('/catalog')
  })
})
