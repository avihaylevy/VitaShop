// MILESTONE-011 Checkpoint A — Stage 0 trigger detection (§4.8.6 + DEC-091 O4).
//
// 🔴 SERVER-SIDE, BEFORE ANY PROVIDER CALL (AI_SAFETY_RULES layer 2). Pure
// keyword matching over the user's message, both languages. When any trigger
// fires, the route attaches the FIXED referral notice (notices.ts) — the
// provider is never consulted about whether to show it.
//
// The eight families (DEC-091 O4 — the spec's four plus the four proposed
// additions; a spare disclaimer is cheaper than a missed one):
//   pregnancy · medication · condition · interaction   (§4.8.6)
//   children · allergies · elderly · distress          (AI_SAFETY_RULES)
//
// 🔴 BOTH-CONTROLS RULE: every phrase in the test table must fire, and a
// control phrase ("מה שעות הפתיחה") must NOT — an all-pass and an all-reject
// screen are equally broken (.claude/rules/browser-verification.md).

export const TRIGGER_FAMILIES = [
  'pregnancy',
  'medication',
  'condition',
  'interaction',
  'children',
  'allergies',
  'elderly',
  'distress',
] as const

export type TriggerFamily = (typeof TRIGGER_FAMILIES)[number]

/**
 * Keyword lists. Hebrew keywords match as substrings (prefixes attach
 * directly: "בהיריון" contains "היריון"); English keywords compile to
 * word-BOUNDED regexes below — leading AND trailing (with an optional
 * plural "s"), so "kid" fires on "kid"/"kids" but not inside "kidney",
 * and "interaction" covers "interactions" without matching "interactive".
 */
const KEYWORDS: Record<TriggerFamily, { he: string[]; en: string[] }> = {
  pregnancy: {
    he: ['היריון', 'הריון', 'בהריון', 'מניקה', 'הנקה', 'להיכנס להריון', 'טרימסטר'],
    en: ['pregnant', 'pregnancy', 'breastfeeding', 'nursing', 'conceive', 'trimester'],
  },
  medication: {
    he: ['תרופה', 'תרופות', 'מרשם', 'כדורים שאני לוקח', 'נוגדי קרישה', 'אנטיביוטיקה', 'קומדין', 'ריטלין', 'אינסולין'],
    en: ['medication', 'medicine', 'prescription', 'drugs i take', 'blood thinner', 'antibiotic', 'insulin', 'warfarin'],
  },
  condition: {
    he: ['סוכרת', 'לחץ דם', 'מחלה', 'מחלת', 'אבחנה', 'אחרי ניתוח', 'ניתוח', 'כליות', 'מחלת לב', 'אפילפסיה', 'סרטן', 'בלוטת התריס'],
    en: ['diabetes', 'blood pressure', 'disease', 'diagnosis', 'diagnosed', 'surgery', 'kidney', 'heart condition', 'epilepsy', 'cancer', 'thyroid'],
  },
  interaction: {
    he: ['אינטראקציה', 'משתלב עם', 'הולך עם', 'לשלב עם', 'ביחד עם התרופה', 'מתנגש'],
    en: ['interaction', 'interact', 'combine with', 'together with my', 'mix with', 'go with my'],
  },
  children: {
    he: ['ילד', 'ילדים', 'ילדה', 'תינוק', 'תינוקת', 'פעוט', 'לבן שלי', 'לבת שלי'],
    en: ['child', 'children', 'kid', 'baby', 'infant', 'toddler', 'my son', 'my daughter'],
  },
  allergies: {
    he: ['אלרגיה', 'אלרגי', 'אלרגית', 'רגישות ל'],
    en: ['allergy', 'allergic', 'sensitivity to'],
  },
  elderly: {
    he: ['קשיש', 'קשישה', 'גיל מבוגר', 'אמא מבוגרת', 'אבא מבוגר', 'בת 80', 'בן 80', 'בן 90', 'בת 90'],
    en: ['elderly', 'senior citizen', 'my mother is 8', 'my father is 8', 'years old mother', 'years old father'],
  },
  distress: {
    he: ['חירום', 'מצוקה', 'כאבים חזקים', 'קשה לי לנשום', 'התעלפתי', 'דימום'],
    en: ['emergency', 'severe pain', 'hard to breathe', 'fainted', 'bleeding', 'chest pain'],
  },
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 🔴 PRECOMPILED at module load (review finding: the previous version built
 * 54 identical RegExp objects per request). One alternation per family:
 * leading boundary `(^|[^a-z])`, trailing `s?(?![a-z])` — so "kids" and
 * "medications" fire while "skid", "kidney", "interactive" do not.
 */
const EN_PATTERNS: Record<TriggerFamily, RegExp> = Object.fromEntries(
  TRIGGER_FAMILIES.map((family) => [
    family,
    new RegExp(`(^|[^a-z])(${KEYWORDS[family].en.map(escapeRegex).join('|')})s?(?![a-z])`),
  ]),
) as Record<TriggerFamily, RegExp>

/**
 * Lowercase + typographic-apostrophe normalization (review finding: iOS/Word
 * autocorrect sends U+2019, which silently defeated "what's wrong with me").
 * Both detectors share it so the two can never disagree on the input.
 */
function normalizeMessage(message: string): string {
  return message.toLowerCase().replace(/[‘’ʼ]/g, "'")
}

/**
 * Medical-only patterns — the "stop politely" branch of AI_SAFETY_RULES'
 * flow: a question that IS a request for diagnosis or dosage gets the notice
 * and no product search at all (the provider is never called — §3.3's
 * clear-cut case). Deliberately narrow, and word-bounded like the keyword
 * matcher (review finding: /diagnose/ fired inside "undiagnosed", and
 * /מה יש לי/ fired on "מה יש לי בעגלה" — ordinary shopping Hebrew). The
 * Hebrew diagnosis form requires the question punctuation or end-of-message
 * that makes it a question about the SELF, not about the cart.
 */
const MEDICAL_ONLY_PATTERNS: RegExp[] = [
  /כמה (כדורים|קפסולות|טבליות|טיפות).*(לקחת|ליום|ביום)/,
  /איזה מינון|מה המינון/,
  /מה יש לי\s*(?:[?!.]|$)/,
  /להפסיק (את ה)?תרופ/,
  /לאבחן|אבחון עצמי/,
  /(^|[^a-z])how many (pills|capsules|tablets|drops).*(take|per day|a day)/,
  /(^|[^a-z])(what|which) dos(age|e)(?![a-z])/,
  /what('s| is) wrong with me/,
  /(^|[^a-z])stop (taking )?(my )?medication/,
  /(^|[^a-z])diagnose(?![a-z])/,
]

/** Every family whose keyword list matches the message. Pure, deterministic. */
export function detectTriggers(message: string): TriggerFamily[] {
  const normalized = normalizeMessage(message)
  return TRIGGER_FAMILIES.filter(
    (family) =>
      KEYWORDS[family].he.some((keyword) => normalized.includes(keyword)) ||
      EN_PATTERNS[family].test(normalized),
  )
}

/**
 * True when the message is a clear-cut medical question (diagnosis/dosage/
 * treatment-change) — Stage 0 stops here: fixed notice, no provider call,
 * no products. Showing the notice does NOT lift the prohibitions; this stop
 * is how the route honours "no dosage, no diagnosis" without trusting a
 * model to refuse.
 */
export function isMedicalOnly(message: string): boolean {
  const normalized = normalizeMessage(message)
  return MEDICAL_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * §3.3 minimisation (DEC-094 item 6 / plan §11.5 step 6) — masking of
 * KNOWN SENSITIVE SPECIFICS before any text leaves the process toward a
 * real provider.
 *
 * ⚠️ HONEST SCOPE (review): this is a KEYWORD screen, not NER. It masks
 * the vocabulary below — medication names, pregnancy phrasing, named
 * diagnoses — and nothing else; a medication absent from the list leaves
 * the machine verbatim. Deliberately EXCLUDED are the generic
 * organ/support words the condition triggers also match (לחץ דם, כליות,
 * thyroid, kidney…): masking them turned "supplements for thyroid
 * support" into "[redacted] support" — a dead-end clarify loop for
 * exactly the shoppers who tripped a trigger. NER-grade redaction is a
 * recorded real-provider-hardening item (§11.5 step 6's tail).
 *
 * The mask is ASCII on purpose: it lands inside prompts of either
 * language, and an RTL token spliced mid-English produced bidi artefacts
 * the model echoed back (review).
 */
const REDACTION_MASK = '[redacted]'

const REDACTION_TERMS: { he: string[]; en: string[] } = {
  he: [
    // Medication names + unambiguous medication phrasing:
    'קומדין', 'ריטלין', 'אינסולין', 'אנטיביוטיקה', 'נוגדי קרישה', 'אליקוויס',
    'כדורים שאני לוקח', 'מרשם',
    // Pregnancy phrasing:
    'להיכנס להריון', 'בהריון', 'היריון', 'הריון', 'מניקה', 'הנקה', 'טרימסטר',
    // Named diagnoses (specific diseases, not organ/support words):
    'סוכרת', 'אפילפסיה', 'סרטן',
  ],
  en: [
    'warfarin', 'insulin', 'ritalin', 'eliquis', 'antibiotic', 'blood thinner',
    'prescription', 'drugs i take',
    'pregnant', 'pregnancy', 'breastfeeding', 'trimester', 'conceive',
    'diabetes', 'epilepsy', 'cancer',
  ],
}

// 🔴 Longest-first, so "מחלת לב" can never be half-eaten by a shorter
// sibling pattern leaving a dangling fragment (review).
const REDACTION_PATTERNS: RegExp[] = [
  ...[...REDACTION_TERMS.he]
    .sort((a, b) => b.length - a.length)
    .map((keyword) => new RegExp(escapeRegex(keyword), 'g')),
  ...[...REDACTION_TERMS.en]
    .sort((a, b) => b.length - a.length)
    .map((keyword) => new RegExp(`(^|[^a-zA-Z])(${escapeRegex(keyword)})s?(?![a-zA-Z])`, 'gi')),
]

export function redactSensitiveTerms(message: string): string {
  let redacted = message.replace(/[‘’ʼ]/g, "'")
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, (match, ...args) => {
      // English patterns carry a leading-boundary capture group — keep it.
      const leading = typeof args[0] === 'string' && match.startsWith(args[0]) ? args[0] : ''
      return `${leading}${REDACTION_MASK}`
    })
  }
  return redacted
}
