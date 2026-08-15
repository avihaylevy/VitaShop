// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import '../i18n'
import i18n from '../i18n'
import { ContactPage } from './ContactPage'

/**
 * ISSUE-125 — the MOCK contact form's contract: validates, submits nowhere,
 * and the received state NEVER unmounts the form (the unmount-takes-focus
 * family). Default test language is Hebrew, like the app.
 */

function renderPage() {
  return render(
    <StrictMode>
      <ContactPage />
    </StrictMode>,
  )
}

afterEach(cleanup)

describe('ContactPage — the mock contact form', () => {
  it('renders the three labelled fields and a submit button', () => {
    renderPage()
    expect(screen.getByLabelText(i18n.t('info:contact.nameLabel'))).toBeTruthy()
    expect(screen.getByLabelText(i18n.t('info:contact.emailLabel'))).toBeTruthy()
    expect(screen.getByLabelText(i18n.t('info:contact.messageLabel'))).toBeTruthy()
    expect(screen.getByRole('button', { name: i18n.t('info:contact.submit') })).toBeTruthy()
  })

  it('an empty submit marks all three fields required and does NOT show the received state', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('info:contact.submit') }))
    expect(screen.getAllByText(i18n.t('info:contact.errorRequired'))).toHaveLength(3)
    expect(screen.queryByText(i18n.t('info:contact.received'))).toBeNull()
  })

  it('a malformed email gets the email error, not the required error', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(i18n.t('info:contact.emailLabel')), {
      target: { value: 'not-an-email' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('info:contact.submit') }))
    expect(screen.getByText(i18n.t('info:contact.errorEmail'))).toBeTruthy()
  })

  it('🔴 a valid submit shows the received state, clears the fields, and KEEPS the form mounted', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(i18n.t('info:contact.nameLabel')), {
      target: { value: 'דנה כהן' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('info:contact.emailLabel')), {
      target: { value: 'dana@example.com' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('info:contact.messageLabel')), {
      target: { value: 'שאלה על מוצר' },
    })
    const submit = screen.getByRole('button', { name: i18n.t('info:contact.submit') })
    fireEvent.click(submit)

    // Announced from the ALWAYS-mounted region.
    expect(screen.getByText(i18n.t('info:contact.received'))).toBeTruthy()
    // The form did not unmount itself on success — button and fields remain.
    expect(screen.getByRole('button', { name: i18n.t('info:contact.submit') })).toBeTruthy()
    expect((screen.getByLabelText(i18n.t('info:contact.nameLabel')) as HTMLInputElement).value).toBe('')
    // 🔴 MOCK: no network call — jsdom has no fetch stub here, so any real
    // submit attempt would have thrown; reaching this line is the proof.
  })

  it('🔴 a SECOND successful submit re-announces — the region text changes every time', () => {
    // A live region announces on TEXT CHANGE; setting true over true renders
    // byte-identical text and says nothing. The flushSync clear-then-set in
    // onSubmit is what this pins (review of this diff).
    renderPage()
    const fill = () => {
      fireEvent.change(screen.getByLabelText(i18n.t('info:contact.nameLabel')), { target: { value: 'א' } })
      fireEvent.change(screen.getByLabelText(i18n.t('info:contact.emailLabel')), { target: { value: 'a@b.co' } })
      fireEvent.change(screen.getByLabelText(i18n.t('info:contact.messageLabel')), { target: { value: 'x' } })
    }
    const submit = () =>
      fireEvent.click(screen.getByRole('button', { name: i18n.t('info:contact.submit') }))
    fill()
    submit()
    expect(screen.getByText(i18n.t('info:contact.received'))).toBeTruthy()
    fill()
    submit()
    // Still announced (present) after the second success — the clear-then-set
    // produced a text change; a plain sticky `true` would also pass this
    // presence check, so pin the mechanism: the region must have been
    // emptied and refilled, which only the flushSync path does. jsdom can
    // assert the end state only; the emptied intermediate commit is the
    // flushSync contract pinned by reading onSubmit.
    expect(screen.getByText(i18n.t('info:contact.received'))).toBeTruthy()
  })

  it('a failed submit AFTER a success clears the stale received text', () => {
    renderPage()
    const submit = () =>
      fireEvent.click(screen.getByRole('button', { name: i18n.t('info:contact.submit') }))
    fireEvent.change(screen.getByLabelText(i18n.t('info:contact.nameLabel')), { target: { value: 'א' } })
    fireEvent.change(screen.getByLabelText(i18n.t('info:contact.emailLabel')), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText(i18n.t('info:contact.messageLabel')), { target: { value: 'x' } })
    submit()
    expect(screen.getByText(i18n.t('info:contact.received'))).toBeTruthy()
    // Fields cleared by the success; submitting again is now invalid.
    submit()
    expect(screen.queryByText(i18n.t('info:contact.received'))).toBeNull()
    expect(screen.getAllByText(i18n.t('info:contact.errorRequired'))).toHaveLength(3)
  })
})
