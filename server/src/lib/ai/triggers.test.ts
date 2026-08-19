// MILESTONE-011 Checkpoint A — Stage 0 trigger detection tests.
//
// 🔴 BOTH-CONTROLS RULE (.claude/rules/browser-verification.md): the table
// feeds phrases that MUST fire and phrases that MUST NOT. An all-pass screen
// and an all-reject screen are equally broken, and neither looks like an
// error without both control directions present.

import { describe, expect, it } from 'vitest'
import { detectTriggers, isMedicalOnly, TRIGGER_FAMILIES, type TriggerFamily } from './triggers.js'

describe('detectTriggers — every family fires, both languages', () => {
  const MUST_FIRE: { phrase: string; family: TriggerFamily }[] = [
    // §4.8.6's four
    { phrase: 'אני בהריון, מה כדאי לקחת?', family: 'pregnancy' },
    { phrase: "I'm pregnant, what should I take?", family: 'pregnancy' },
    { phrase: 'אני מניקה', family: 'pregnancy' },
    { phrase: 'אני לוקח תרופות ללחץ דם', family: 'medication' },
    { phrase: 'I take blood pressure medication', family: 'medication' },
    { phrase: 'יש לי מרשם קבוע', family: 'medication' },
    { phrase: 'יש לי סוכרת', family: 'condition' },
    { phrase: 'I have diabetes', family: 'condition' },
    { phrase: 'אני אחרי ניתוח', family: 'condition' },
    { phrase: 'האם מגנזיום הולך עם התרופה שלי?', family: 'interaction' },
    { phrase: 'Does magnesium interact with my pills?', family: 'interaction' },
    { phrase: 'אפשר לשלב עם קומדין?', family: 'interaction' },
    // DEC-091 O4's four additions
    { phrase: 'משהו לילד בן שבע', family: 'children' },
    { phrase: 'vitamins for my son', family: 'children' },
    { phrase: 'תוסף לתינוק', family: 'children' },
    { phrase: 'יש לי אלרגיה לאגוזים', family: 'allergies' },
    { phrase: 'I am allergic to nuts', family: 'allergies' },
    { phrase: 'משהו לאמא מבוגרת שלי', family: 'elderly' },
    { phrase: 'something for my elderly father', family: 'elderly' },
    { phrase: 'יש לי כאבים חזקים בחזה', family: 'distress' },
    { phrase: 'I have severe pain and it is hard to breathe', family: 'distress' },
  ]

  for (const { phrase, family } of MUST_FIRE) {
    it(`fires ${family} on: ${phrase}`, () => {
      expect(detectTriggers(phrase)).toContain(family)
    })
  }

  it('covers every family in the MUST_FIRE table (the table itself cannot silently shrink)', () => {
    const covered = new Set(MUST_FIRE.map((row) => row.family))
    expect([...covered].sort()).toEqual([...TRIGGER_FAMILIES].sort())
  })

  const MUST_NOT_FIRE = [
    'מה שעות הפתיחה', // the canonical control phrase from the plan
    'מגנזיום בקפסולות עד 100 שקל',
    'vitamin c under 100',
    'משהו לשינה טובה',
    'something for energy in powder form',
    'איזה מותגים יש לכם?',
  ]

  for (const phrase of MUST_NOT_FIRE) {
    it(`stays silent on: ${phrase}`, () => {
      expect(detectTriggers(phrase)).toEqual([])
    })
  }

  it('kid does not fire inside kidney-free plain words (word-boundary check)', () => {
    expect(detectTriggers('a skid mark on the road')).toEqual([])
  })

  it('trailing boundary: "kidney" fires condition, never children; "interactive" fires nothing', () => {
    expect(detectTriggers('supplements for kidney support')).toEqual(['condition'])
    expect(detectTriggers('is the interactive catalog working')).toEqual([])
  })

  it('plural forms still fire: medications, interactions', () => {
    expect(detectTriggers('I take several medications')).toContain('medication')
    expect(detectTriggers('worried about interactions')).toContain('interaction')
  })
})

describe('isMedicalOnly — the stop-politely branch', () => {
  const MUST_STOP = [
    'כמה כדורים לקחת ביום?',
    'How many pills should I take per day?',
    'מה המינון הנכון בשבילי?',
    'what dosage should I use',
    "What's wrong with me? I'm always tired",
    // 🔴 U+2019 — the apostrophe autocorrect actually sends (review finding:
    // the ASCII-only pattern silently waved the diagnosis question through).
    'What’s wrong with me? I’m always tired',
    'מה יש לי? כל הזמן עייף',
    'should I stop taking my medication?',
  ]
  for (const phrase of MUST_STOP) {
    it(`stops on: ${phrase}`, () => {
      expect(isMedicalOnly(phrase)).toBe(true)
    })
  }

  const MUST_CONTINUE = [
    'מגנזיום לשינה',
    'משהו לחיזוק חיסון עד 100 שקל',
    'vitamin d in drops',
    'what do you have for sleep?',
    // Review findings — shopping phrases the old patterns hard-stopped:
    'מה יש לי בעגלה כרגע',
    'I have an undiagnosed sensitivity, what vitamin c do you have?',
  ]
  for (const phrase of MUST_CONTINUE) {
    it(`continues on: ${phrase}`, () => {
      expect(isMedicalOnly(phrase)).toBe(false)
    })
  }
})
