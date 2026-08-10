import { describe, expect, it } from 'vitest'
import { normalizeCatalogError } from './catalogResponseNormalization'
import { CatalogApiError } from '../../lib/catalogApi'

describe('normalizeCatalogError — §9e invariant', () => {
  it('a category-specific INVALID_QUERY_PARAMETER (fields includes "category") -> invalidCategory: true, error: null', () => {
    const error = new CatalogApiError('INVALID_QUERY_PARAMETER', 'Invalid value for query parameter(s): category', {
      status: 400,
      fields: ['category'],
    })
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: true, error: null })
  })

  it('an INVALID_QUERY_PARAMETER carrying category among other fields still normalizes to invalidCategory: true', () => {
    const error = new CatalogApiError('INVALID_QUERY_PARAMETER', 'Invalid value for query parameter(s): category, brand', {
      status: 400,
      fields: ['category', 'brand'],
    })
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: true, error: null })
  })

  it('an INVALID_QUERY_PARAMETER NOT naming category -> invalidCategory: false, error carried through', () => {
    const error = new CatalogApiError('INVALID_QUERY_PARAMETER', 'Invalid value for query parameter(s): brand', {
      status: 400,
      fields: ['brand'],
    })
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: false, error })
  })

  it('an INVALID_QUERY_PARAMETER with no fields array -> invalidCategory: false, error carried through', () => {
    const error = new CatalogApiError('INVALID_QUERY_PARAMETER', 'Invalid value for query parameter(s)', { status: 400 })
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: false, error })
  })

  it('a non-400 error carrying the same code/fields as the §9e branch -> invalidCategory: false, error carried through (status is checked, not just code/fields)', () => {
    const error = new CatalogApiError('INVALID_QUERY_PARAMETER', 'boom', { status: 500, fields: ['category'] })
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: false, error })
  })

  it('an INVALID_QUERY_PARAMETER with category and no status set at all -> invalidCategory: false (status undefined !== 400)', () => {
    const error = new CatalogApiError('INVALID_QUERY_PARAMETER', 'boom', { fields: ['category'] })
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: false, error })
  })

  it('a network error -> invalidCategory: false, error carried through', () => {
    const error = new CatalogApiError('NETWORK_ERROR', 'The catalogue API could not be reached.')
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: false, error })
  })

  it('a data-integrity 500 -> invalidCategory: false, error carried through', () => {
    const error = new CatalogApiError('CATALOG_DATA_INTEGRITY', 'boom', { status: 500 })
    expect(normalizeCatalogError(error)).toEqual({ invalidCategory: false, error })
  })

  it('invalidCategory and error are mutually exclusive on every output', () => {
    const inputs = [
      new CatalogApiError('INVALID_QUERY_PARAMETER', 'x', { fields: ['category'] }),
      new CatalogApiError('INVALID_QUERY_PARAMETER', 'x', { fields: ['brand'] }),
      new CatalogApiError('NETWORK_ERROR', 'x'),
    ]
    for (const error of inputs) {
      const result = normalizeCatalogError(error)
      expect(result.invalidCategory === true ? result.error === null : result.error !== null).toBe(true)
    }
  })
})
