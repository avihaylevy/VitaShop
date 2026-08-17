import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { FOCUS_RING } from '../components/ui/focusRing'
import {
  addAddress,
  makeDefaultAddress,
  patchAddress,
  patchShopperProfile,
  removeAddress,
  requestAddressBook,
  requestShopperProfile,
} from '../lib/accountApi'
import type { AddressBook, ManagedAddress } from '../types/account'

/**
 * MILESTONE-009 / DEC-090 — the profile screen: REQ-F-051's "update
 * personal details" + "manage multiple shipping addresses".
 *
 * 🔴 Submit-and-map throughout (the RegisterPage pattern): no client copy
 * of Table 3's rules; the server refuses with named codes and the i18n
 * key-fallback renders them. EMAIL is absent by DEC-090 O2.
 *
 * 🔴 The async-control family: every control survives its own success,
 * outcomes speak from ALWAYS-mounted status/alert regions, in-flight
 * presses are ignored via one busy flag per section.
 */

type ProfileForm = { firstName: string; lastName: string; phone: string }
type AddressForm = { line1: string; city: string; zipCode: string }

const EMPTY_ADDRESS: AddressForm = { line1: '', city: '', zipCode: '' }

export function ProfilePage() {
  const { t } = useTranslation('account')

  // ── the details form ────────────────────────────────────────────────
  const [profileState, setProfileState] = useState<'loading' | 'ready' | 'failed' | 'unauthenticated'>('loading')
  const [profile, setProfile] = useState<ProfileForm>({ firstName: '', lastName: '', phone: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileNotice, setProfileNotice] = useState('')
  const [profileError, setProfileError] = useState('')

  // ── the address book ────────────────────────────────────────────────
  const [bookState, setBookState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [book, setBook] = useState<AddressBook>({ addresses: [], cap: 5 })
  const [addressForm, setAddressForm] = useState<AddressForm>(EMPTY_ADDRESS)
  /** null = the form ADDS; an id = the form EDITS that row. */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [busyAddress, setBusyAddress] = useState(false)
  const [bookNotice, setBookNotice] = useState('')
  const [bookError, setBookError] = useState('')

  const codeMessage = useCallback(
    (code: string) => t([`errors.${code}`, 'errors.generic']),
    [t],
  )

  /** Unmount guard — the profile fetch had one, this fetch did not (review). */
  const liveRef = useRef(true)
  useEffect(() => {
    liveRef.current = true
    return () => {
      liveRef.current = false
    }
  }, [])

  /**
   * 🔴 The deliberate focus target after an action UNMOUNTS its own button
   * (delete, make-default, the 5th add replacing the form) — the
   * unmount-takes-focus family; the drawer's removal notice is the
   * precedent.
   */
  const bookNoticeRef = useRef<HTMLParagraphElement>(null)

  const loadBook = useCallback(async () => {
    const result = await requestAddressBook()
    if (!liveRef.current) return
    if (result.ok) {
      setBook(result.book)
      setBookState('ready')
    } else {
      setBookState('failed')
    }
  }, [])

  useEffect(() => {
    let live = true
    void requestShopperProfile().then((result) => {
      if (!live) return
      if (result.ok) {
        setProfile({
          firstName: result.profile.firstName,
          lastName: result.profile.lastName,
          phone: result.profile.phone ?? '',
        })
        setProfileState('ready')
      } else {
        setProfileState(result.failure === 'unauthenticated' ? 'unauthenticated' : 'failed')
      }
    })
    void loadBook()
    return () => {
      live = false
    }
  }, [loadBook])

  async function onSaveProfile(event: FormEvent) {
    event.preventDefault()
    if (savingProfile) return
    setSavingProfile(true)
    setProfileError('')
    const result = await patchShopperProfile(profile)
    setSavingProfile(false)
    if (!result.ok) {
      setProfileNotice('')
      if (result.failure === 'invalid') {
        setProfileError(
          result.codes.length > 0
            ? result.codes.map(codeMessage).join(' ')
            : t('errors.generic'),
        )
      } else if (result.failure === 'unauthenticated') {
        setProfileError(t('state.unauthenticated'))
      } else {
        setProfileError(t('errors.generic'))
      }
      return
    }
    setProfile({
      firstName: result.profile.firstName,
      lastName: result.profile.lastName,
      phone: result.profile.phone ?? '',
    })
    setProfileNotice(t('details.saved'))
  }

  function startEdit(address: ManagedAddress) {
    if (busyAddress) return
    setEditingId(address.id)
    setAddressForm({ line1: address.line1, city: address.city, zipCode: address.zipCode ?? '' })
    setBookError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setAddressForm(EMPTY_ADDRESS)
  }

  async function onSubmitAddress(event: FormEvent) {
    event.preventDefault()
    if (busyAddress) return
    setBusyAddress(true)
    setBookError('')
    const fields = {
      line1: addressForm.line1,
      city: addressForm.city,
      zipCode: addressForm.zipCode.trim() === '' ? null : addressForm.zipCode.trim(),
    }
    const result = editingId
      ? await patchAddress(editingId, fields)
      : await addAddress(fields)
    setBusyAddress(false)
    if (!result.ok) {
      setBookNotice('')
      if (result.failure === 'invalid') {
        setBookError(
          result.codes.length > 0 ? result.codes.map(codeMessage).join(' ') : t('errors.generic'),
        )
      } else if (result.failure === 'capReached') {
        setBookError(t('addresses.capReached', { cap: book.cap }))
      } else if (result.failure === 'gone') {
        setBookError(t('addresses.gone'))
        void loadBook()
      } else if (result.failure === 'unauthenticated') {
        setBookError(t('state.unauthenticated'))
      } else {
        setBookError(t('errors.generic'))
      }
      return
    }
    setBookNotice(editingId ? t('addresses.updated') : t('addresses.added'))
    // The 5th add replaces the form with the cap message (its own submit
    // unmounts) — same family, same answer.
    if (!editingId && book.addresses.length + 1 >= book.cap) bookNoticeRef.current?.focus()
    cancelEdit()
    void loadBook()
  }

  async function onAction(action: 'delete' | 'default', address: ManagedAddress) {
    if (busyAddress) return
    setBusyAddress(true)
    setBookError('')
    const result =
      action === 'delete' ? await removeAddress(address.id) : await makeDefaultAddress(address.id)
    setBusyAddress(false)
    if (!result.ok) {
      setBookNotice('')
      if (result.failure === 'gone') {
        setBookError(t('addresses.gone'))
        void loadBook()
      } else if (result.failure === 'unauthenticated') {
        setBookError(t('state.unauthenticated'))
      } else {
        setBookError(t('errors.generic'))
      }
      return
    }
    if (action === 'delete' && editingId === address.id) cancelEdit()
    setBookNotice(action === 'delete' ? t('addresses.removed') : t('addresses.defaulted'))
    // The pressed button is about to unmount — focus lands somewhere
    // deliberate, and the notice it lands on says what happened.
    bookNoticeRef.current?.focus()
    void loadBook()
  }

  const inputClass = `${FOCUS_RING} h-11 rounded-card border border-border-control bg-well px-3`
  const atCap = book.addresses.length >= book.cap && editingId === null

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="heading-page">{t('title')}</h1>

      {/* ── personal details ─────────────────────────────────────────── */}
      <section className="mt-6" aria-labelledby="profile-details-heading">
        <h2 id="profile-details-heading" className="heading-section">
          {t('details.heading')}
        </h2>

        {/* Always-mounted outcome regions. */}
        <p role="status" aria-live="polite" className="mt-2 text-sm text-brand-teal">
          {profileNotice}
        </p>
        <p role="alert" className="mt-1 text-sm text-state-error">
          {profileError}
        </p>

        {profileState === 'loading' && <p className="mt-3 text-text-muted">{t('state.loading')}</p>}
        {profileState === 'unauthenticated' && (
          <p className="mt-3 text-text-ink">{t('state.unauthenticated')}</p>
        )}
        {profileState === 'failed' && <p className="mt-3 text-text-ink">{t('state.loadFailed')}</p>}

        {profileState === 'ready' && (
          <form onSubmit={onSaveProfile} noValidate className="mt-3 flex flex-col gap-4 text-sm">
            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <label htmlFor="profile-first" className="text-text-ink">
                  {t('details.firstName')}
                </label>
                <input
                  id="profile-first"
                  autoComplete="given-name"
                  value={profile.firstName}
                  onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div className="flex min-w-48 flex-1 flex-col gap-1">
                <label htmlFor="profile-last" className="text-text-ink">
                  {t('details.lastName')}
                </label>
                <input
                  id="profile-last"
                  autoComplete="family-name"
                  value={profile.lastName}
                  onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="profile-phone" className="text-text-ink">
                {t('details.phone')}
              </label>
              <input
                id="profile-phone"
                autoComplete="tel"
                inputMode="tel"
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                className={inputClass}
                dir="ltr"
              />
              <p className="text-xs text-text-muted">{t('details.phoneHint')}</p>
            </div>
            {/* DEC-090 O2 — the email is shown NOWHERE as editable; a line
                says why rather than leaving its absence mysterious. */}
            <p className="text-xs text-text-muted">{t('details.emailNote')}</p>
            <Button type="submit" loading={savingProfile} className="self-start">
              {savingProfile ? t('details.saving') : t('details.save')}
            </Button>
          </form>
        )}
      </section>

      {/* ── the address book ─────────────────────────────────────────── */}
      <section className="mt-10" aria-labelledby="profile-addresses-heading">
        <h2 id="profile-addresses-heading" className="heading-section">
          {t('addresses.heading')}
        </h2>
        {/* The cap figure is the SERVER's — rendered only once it arrived
            (review finding: the initial state's local 5 leaked into the
            loading/failed renders). */}
        {bookState === 'ready' && (
          <p className="mt-1 text-xs text-text-muted">{t('addresses.intro', { cap: book.cap })}</p>
        )}

        <p
          ref={bookNoticeRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className={`${FOCUS_RING} mt-2 rounded-compact text-sm text-brand-teal`}
        >
          {bookNotice}
        </p>
        <p role="alert" className="mt-1 text-sm text-state-error">
          {bookError}
        </p>

        {bookState === 'loading' && <p className="mt-3 text-text-muted">{t('state.loading')}</p>}
        {bookState === 'failed' && (
          <div className="mt-3">
            <p className="text-text-ink">{t('state.loadFailed')}</p>
            <Button type="button" variant="secondary" className="mt-2" onClick={() => void loadBook()}>
              {t('state.retry')}
            </Button>
          </div>
        )}

        {bookState === 'ready' && (
          <>
            {book.addresses.length === 0 ? (
              <p className="mt-3 text-text-muted">{t('addresses.empty')}</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {book.addresses.map((address) => (
                  <li
                    key={address.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border-hairline p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-text-ink">
                        {address.line1}, {address.city}
                        {address.zipCode ? `, ${address.zipCode}` : ''}
                      </p>
                      {address.isDefault && (
                        <p className="text-xs font-medium text-brand-teal">
                          {t('addresses.defaultBadge')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!address.isDefault && (
                        <Button
                          type="button"
                          variant="secondary"
                          aria-disabled={busyAddress || undefined}
                          onClick={() => void onAction('default', address)}
                        >
                          {t('addresses.makeDefault')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="secondary"
                        aria-disabled={busyAddress || undefined}
                        onClick={() => startEdit(address)}
                      >
                        {t('addresses.edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        aria-disabled={busyAddress || undefined}
                        onClick={() => void onAction('delete', address)}
                      >
                        {t('addresses.remove')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <h3 className="mt-6 text-sm font-semibold text-text-ink">
              {editingId ? t('addresses.editHeading') : t('addresses.addHeading')}
            </h3>
            {atCap ? (
              <p className="mt-2 text-sm text-text-muted">
                {t('addresses.capReached', { cap: book.cap })}
              </p>
            ) : (
              <form onSubmit={onSubmitAddress} noValidate className="mt-2 flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <label htmlFor="address-line1" className="text-text-ink">
                    {t('addresses.line1')}
                  </label>
                  <input
                    id="address-line1"
                    autoComplete="street-address"
                    value={addressForm.line1}
                    onChange={(e) => setAddressForm((f) => ({ ...f, line1: e.target.value }))}
                    className={inputClass}
                  />
                  <p className="text-xs text-text-muted">{t('addresses.line1Hint')}</p>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div className="flex min-w-48 flex-1 flex-col gap-1">
                    <label htmlFor="address-city" className="text-text-ink">
                      {t('addresses.city')}
                    </label>
                    <input
                      id="address-city"
                      autoComplete="address-level2"
                      value={addressForm.city}
                      onChange={(e) => setAddressForm((f) => ({ ...f, city: e.target.value }))}
                      className={inputClass}
                    />
                  </div>
                  <div className="flex min-w-40 flex-1 flex-col gap-1">
                    <label htmlFor="address-zip" className="text-text-ink">
                      {t('addresses.zip')}
                    </label>
                    <input
                      id="address-zip"
                      autoComplete="postal-code"
                      value={addressForm.zipCode}
                      onChange={(e) => setAddressForm((f) => ({ ...f, zipCode: e.target.value }))}
                      className={inputClass}
                      dir="ltr"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" loading={busyAddress}>
                    {editingId ? t('addresses.saveEdit') : t('addresses.add')}
                  </Button>
                  {editingId && (
                    <Button type="button" variant="secondary" onClick={cancelEdit}>
                      {t('addresses.cancelEdit')}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </section>
    </main>
  )
}
