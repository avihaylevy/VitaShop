/**
 * Every server-generated user-facing string in the application.
 *
 * 🔴 DEC-054 (`Accepted`, 2026-08-10) — the rule this module exists to serve.
 *
 *   · Server-generated email is HEBREW ONLY for MILESTONE-006.
 *   · Every such string lives HERE, keyed by message and by part
 *     (subject, body). Never inlined at a call site.
 *   · 🔴 ADDING ENGLISH LATER MEANS ADDING A SECOND TABLE BESIDE THE
 *     HEBREW ONE — not rewriting call sites. That is the entire reason
 *     the strings were extracted before Checkpoint F doubled their count.
 *
 * 🔴 This is NOT governed by clause A11. A11 covers CLIENT-RENDERED text —
 * he/en locale files, a registered i18next namespace, Tailwind logical
 * properties — and the i18n integrity tests it points at do not reach here.
 * There is no i18next instance on the server. A11 was amended on 2026-08-10 to
 * say so explicitly, because the boundary had never been drawn and Checkpoint
 * D's two email bodies fell into the gap (open item O9).
 *
 * ⚠️ If any email ever carries medical or legal wording — the disclaimer, a
 * safety warning, terms — the project's medical-disclaimer and legal-wording
 * rules apply to the string here exactly as they would in the UI. None of the
 * current messages carry any, and adding one is not a copy edit.
 *
 * WHY HEBREW ONLY, so it is not re-litigated: the store is Hebrew-first by
 * data (product names, category names, order statuses, the disclaimer), so an
 * English transactional email would be the anomaly. `Accept-Language` was
 * rejected because A9/INV-04 send after the commit, outside the request that
 * carried the header. A `locale` column on `User` was rejected because it is a
 * schema migration, which §6.5 lists as a stop condition for this milestone.
 */

/** The shape every message in this module produces. */
export interface EmailContent {
  subject: string
  body: string
}

function joinBody(lines: string[]): string {
  return lines.join('\n')
}

/**
 * The Hebrew table. 🔴 A second table (`en`) goes BESIDE this one, with the
 * same keys and the same signatures — call sites do not change.
 */
export const emailStringsHe = {
  /** REQ-F-031 — verification link, 24 hours, single use. */
  verification(link: string): EmailContent {
    return {
      subject: 'VitaShop — אימות כתובת המייל',
      body: joinBody([
        'ברוכים הבאים ל-VitaShop.',
        '',
        'כדי להשלים את ההרשמה, יש לאמת את כתובת המייל בקישור הבא:',
        link,
        '',
        'הקישור תקף ל-24 שעות וניתן לשימוש חד-פעמי בלבד.',
      ]),
    }
  },

  /**
   * DEC-053 clause 4b — sent to the EXISTING owner when someone tries to
   * register with their address. The response to the requester is identical
   * to a successful registration; this is the only thing that differs, and it
   * goes to the account holder rather than the requester.
   */
  existingAccountRegistrationAttempt(): EmailContent {
    return {
      subject: 'VitaShop — ניסיון הרשמה עם כתובת המייל שלך',
      body: joinBody([
        'מישהו ניסה להירשם ל-VitaShop עם כתובת המייל הזו, שכבר רשומה במערכת.',
        '',
        'לא נוצר חשבון חדש ולא בוצע שינוי בחשבון הקיים.',
        'אם זה היית את/ה — אפשר פשוט להתחבר.',
        'אם לא — אין צורך בפעולה כלשהי.',
      ]),
    }
  },

  /** REQ-F-032 — the password-reset link. Single use, one hour. */
  passwordReset(link: string, ttlHours: number): EmailContent {
    return {
      subject: 'VitaShop — איפוס סיסמה',
      body: joinBody([
        'התקבלה בקשה לאיפוס הסיסמה בחשבון VitaShop שלך.',
        '',
        'לקביעת סיסמה חדשה יש להיכנס לקישור הבא:',
        link,
        '',
        `הקישור תקף ל-${ttlHours} שעות וניתן לשימוש חד-פעמי בלבד.`,
        '',
        'אם לא ביקשת לאפס סיסמה — אין צורך בפעולה כלשהי, והסיסמה הנוכחית נשארת בתוקף.',
      ]),
    }
  },

  /**
   * REQ-F-032 — sent AFTER a reset completes. Not a courtesy: it is how the
   * real owner finds out if someone else completed a reset on their account.
   */
  passwordResetCompleted(): EmailContent {
    return {
      subject: 'VitaShop — הסיסמה שונתה',
      body: joinBody([
        'הסיסמה בחשבון VitaShop שלך שונתה זה עתה.',
        '',
        'כל החיבורים הפעילים בחשבון נותקו, ויש להתחבר מחדש עם הסיסמה החדשה.',
        '',
        '🔴 אם לא את/ה ביצעת את השינוי — יש לאפס את הסיסמה מיד וליצור קשר עם התמיכה.',
      ]),
    }
  },
} as const

/**
 * The active table. 🔴 When English is added, this becomes a lookup by locale
 * rather than a constant — and that is the ONLY line that changes here.
 */
export const emailStrings = emailStringsHe
