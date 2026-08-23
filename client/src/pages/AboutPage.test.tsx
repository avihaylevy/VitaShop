// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import i18n from '../i18n'
import { AboutPage } from './AboutPage'

/**
 * ISSUE-119 — key-resolution guard, updated for the 2026-08-23 hierarchy
 * rebuild: the page reads seventeen info:about.* keys; a renamed or
 * he-only key would render raw key text with every other suite green
 * (review of this diff). Asserting the RESOLVED strings means a missing
 * key fails here.
 */

function renderPage() {
  return render(
    <StrictMode>
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>
    </StrictMode>,
  )
}

afterEach(cleanup)

describe('AboutPage', () => {
  it('renders every section of the hierarchy by its resolved text', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: i18n.t('info:about.title') })).toBeTruthy()
    expect(screen.getByText(i18n.t('info:about.intro'))).toBeTruthy()
    for (const key of ['whyTitle', 'valuesTitle', 'howTitle', 'readyTitle'] as const) {
      expect(screen.getByRole('heading', { level: 2, name: i18n.t(`info:about.${key}`) })).toBeTruthy()
    }
    for (const key of ['story1', 'story2'] as const) {
      expect(screen.getByText(i18n.t(`info:about.${key}`))).toBeTruthy()
    }
    for (const key of ['value1Title', 'value2Title', 'value3Title'] as const) {
      expect(screen.getByRole('heading', { level: 3, name: i18n.t(`info:about.${key}`) })).toBeTruthy()
    }
    for (const key of ['step1', 'step2', 'step3'] as const) {
      expect(screen.getByText(i18n.t(`info:about.${key}`))).toBeTruthy()
    }
    for (const key of ['statementLine1', 'statementLine2'] as const) {
      expect(screen.getByText(i18n.t(`info:about.${key}`))).toBeTruthy()
    }
  })

  it('the steps are an ORDERED list of exactly three items — the sequence is the content', () => {
    renderPage()
    const items = document.querySelectorAll('ol > li')
    expect(items.length).toBe(3)
  })

  it('the CTA is a real LINK to the catalogue, not a button pretending', () => {
    renderPage()
    const cta = screen.getByRole('link', { name: i18n.t('info:about.cta') })
    expect(cta.getAttribute('href')).toBe('/catalog')
  })
})
