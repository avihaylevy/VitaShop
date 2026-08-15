// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import i18n from '../i18n'
import { AboutPage } from './AboutPage'

/**
 * ISSUE-119 — key-resolution guard: the page reads nine info:about.* keys;
 * a renamed or he-only key would render raw key text with every other
 * suite green (review of this diff). Asserting the RESOLVED strings means
 * a missing key fails here.
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
  it('renders the title, all three story paragraphs, and the values by their resolved text', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: i18n.t('info:about.title') })).toBeTruthy()
    for (const key of ['story1', 'story2', 'story3'] as const) {
      expect(screen.getByText(i18n.t(`info:about.${key}`))).toBeTruthy()
    }
    expect(screen.getByRole('heading', { level: 2, name: i18n.t('info:about.valuesTitle') })).toBeTruthy()
    for (const key of ['value1Title', 'value2Title', 'value3Title'] as const) {
      expect(screen.getByRole('heading', { level: 3, name: i18n.t(`info:about.${key}`) })).toBeTruthy()
    }
  })

  it('the CTA is a real LINK to the catalogue, not a button pretending', () => {
    renderPage()
    const cta = screen.getByRole('link', { name: i18n.t('info:about.cta') })
    expect(cta.getAttribute('href')).toBe('/catalog')
  })
})
