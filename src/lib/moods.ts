/**
 * The twelve moods, and the ONLY place any of them is spelled out.
 *
 * The tagger's prompt, the response validator, the mood picker, and the
 * /mood/[slug] route all read from here. Nothing else may hardcode a label or a
 * slug: a label that drifts from this list silently stops matching stored rows,
 * because `moods` holds these exact strings.
 *
 * Framing is "I want something…", describing what you want to WATCH, not how
 * you currently feel.
 *
 * CHANGING A LABEL REQUIRES A FULL RE-TAG. Stored rows hold the old string, and
 * every title was judged against the whole vocabulary, so a title tagged under
 * an older set was never offered the new options. Re-tagging only the rows that
 * carried a removed label would leave the library inconsistent. See the
 * implementation plan's re-tag procedure.
 */

export interface Mood {
  /** Stored verbatim in Title.moods and shown in the UI. */
  label: string;
  /** URL segment for /mood/[slug]. */
  slug: string;
  /** Sent to the tagger. One line each, except Conceptual (see below). */
  definition: string;
}

// Canonical order. The picker renders in this order rather than by count, so
// the grid doesn't reshuffle between visits.
export const MOODS: readonly Mood[] = [
  {
    label: "Light & funny",
    slug: "light-funny",
    definition:
      "Comedic and low-stakes. The laughs are the point; you can watch it tired.",
  },
  {
    label: "Feel-good",
    slug: "feel-good",
    definition:
      "Warm and uplifting; it leaves you better than it found you. May be dramatic, but the arc resolves kindly.",
  },
  // "Tense & gripping" used to sit here alone and came back on 165 of 327 Want
  // titles. That tracked the library's genre skew rather than over-tagging, but
  // a filter returning half the list is not filtering. Splitting it into two
  // distinct appetites is the fix: the region needed a sharper distinction, not
  // a tagging correction. They stay adjacent, in the slot the single mood held.
  {
    label: "Slow-burn dread",
    slug: "slow-burn-dread",
    definition:
      "Unease that accumulates. The menace is atmospheric and patient; you feel the threat before you see it. " +
      "Deliberate pace, mounting wrongness. Examples: Hereditary, The Witch, Burning, First Reformed, " +
      "Under the Skin, Zodiac, Michael Clayton.",
  },
  {
    label: "Edge-of-seat",
    slug: "edge-of-seat",
    definition:
      "Momentum and urgency. Propulsive, escalating, hard to pause. The pressure comes from pace and stakes " +
      "rather than atmosphere. Examples: Sicario, Uncut Gems, Run Lola Run, Heat, Nightcrawler, Prisoners.",
  },
  {
    label: "Dark & heavy",
    slug: "dark-heavy",
    definition:
      "Bleak, grim, or emotionally punishing. You have to be in the mood for it.",
  },
  {
    label: "Thoughtful",
    slug: "thoughtful",
    definition:
      "Slow, meditative, cerebral IN TONE AND PACE. Rewards patience and attention. This is about how the film moves, not how clever its idea is.",
  },
  {
    label: "Beautiful & calm",
    slug: "beautiful-calm",
    definition:
      "Visually gorgeous and unhurried. The images and atmosphere are the draw.",
  },
  {
    label: "Weird",
    slug: "weird",
    definition:
      "Surreal, offbeat, formally strange IN EXECUTION. Dream logic, absurdism, tonal oddity. This is about how the film is made, not how unusual its premise is.",
  },
  {
    label: "Big & thrilling",
    slug: "big-thrilling",
    definition:
      "Spectacle, scale, action. Blockbuster energy. This is about scope and budget, whereas Edge-of-seat is " +
      "tension and stakes at any size: Uncut Gems is Edge-of-seat, NOT Big & thrilling.",
  },
  {
    label: "Romantic",
    slug: "romantic",
    definition: "A central love story drives the film.",
  },
  {
    label: "Scary",
    slug: "scary",
    definition: "Made to frighten. Horror, dread, terror.",
  },
  {
    // The only mood with a full block rather than a line. Its failure mode is
    // enthusiastic over-application: without the operative test and the
    // counter-examples, a tagger hands it to anything clever or serious.
    label: "Conceptual",
    slug: "conceptual",
    definition:
      "Built around a distinctive central PREMISE or idea that the whole film is structured to explore. " +
      'High-concept, puzzle-box, "what if X" hooks. The concept drives the film\'s ARCHITECTURE, not just its plot. ' +
      "OPERATIVE TEST: if the film could be described without its premise and still make sense, it is NOT Conceptual. " +
      "Examples: Primer, Coherence, Predestination, Triangle, Memento, Palm Springs, Arrival, Perfect Blue, Adaptation, " +
      "The Double, Groundhog Day, Eternal Sunshine, The Prestige, Being John Malkovich, Source Code, The Truman Show. " +
      "Do NOT tag Conceptual for: a well-crafted character drama; a twisty thriller whose twist is a plot reveal rather " +
      "than the premise itself; a film that is merely intelligent or merely slow. Being clever or serious does not qualify " +
      "a film; the premise has to be load-bearing, so that removing it leaves the film with no shape.",
  },
] as const;

export const MOOD_LABELS: readonly string[] = MOODS.map((m) => m.label);

const BY_LABEL = new Map(MOODS.map((m) => [m.label, m]));
const BY_SLUG = new Map(MOODS.map((m) => [m.slug, m]));

/** Exact-match only. The tagger's output is checked against this, so a near-miss is dropped rather than coerced. */
export function isMoodLabel(value: string): boolean {
  return BY_LABEL.has(value);
}

export function moodBySlug(slug: string): Mood | undefined {
  return BY_SLUG.get(slug);
}

export function moodByLabel(label: string): Mood | undefined {
  return BY_LABEL.get(label);
}

/**
 * The disambiguations the tagger needs most, for the two regions where moods sit
 * close enough to be mistaken for synonyms. Kept next to the definitions so the
 * two cannot drift.
 *
 * Region 1: Conceptual against Thoughtful and Weird.
 * Region 2: Slow-burn dread against Edge-of-seat and Scary. Without this, the
 * two halves of the old "Tense & gripping" get double-tagged and the split
 * achieves nothing, since half the library would carry both.
 */
export const MOOD_DISAMBIGUATION = [
  "Thoughtful is TONE AND PACE (slow, meditative). Conceptual films can be brisk and fun: Palm Springs is Conceptual but NOT Thoughtful.",
  "Weird is STRANGE EXECUTION (surreal, offbeat). Arrival is Conceptual but NOT Weird: conventional execution, extraordinary premise.",
  "Judge each mood on its own criteria. Do not treat Conceptual, Thoughtful, and Weird as interchangeable.",
  "Slow-burn dread and Edge-of-seat are DIFFERENT APPETITES, not synonyms. PREFER ONE: ask which register dominates the viewing experience. Assigning both by default is WRONG. Both is correct only when a film genuinely sustains both registers throughout (Sicario arguably does; most do not).",
  "Scary means MADE TO FRIGHTEN, with horror mechanics. Slow-burn dread is a TONE and is frequently not horror at all: Michael Clayton, First Reformed, and Zodiac carry dread with no horror. A horror film may carry both; a paranoid thriller carries dread without Scary.",
  "Big & thrilling is SPECTACLE AND SCALE (blockbuster energy). Edge-of-seat is TENSION AND STAKES regardless of budget. Uncut Gems is Edge-of-seat, not Big & thrilling.",
] as const;

/**
 * Worked examples showing that multi-tagging is correct, not a mistake. Chosen
 * to demonstrate both directions: moods that co-occur, and neighbouring moods
 * that deliberately do NOT apply.
 */
export const MOOD_EXAMPLES = [
  'Primer: ["Conceptual", "Thoughtful"]',
  'Palm Springs: ["Conceptual", "Light & funny"] (brisk and funny, so NOT Thoughtful)',
  'Arrival: ["Conceptual", "Thoughtful"] (conventional execution, so NOT Weird)',
  'Perfect Blue: ["Conceptual", "Weird", "Slow-burn dread"] (mounting paranoia, not propulsion)',
  'Hereditary: ["Slow-burn dread", "Scary", "Dark & heavy"] (horror, so dread AND Scary)',
  'Michael Clayton: ["Slow-burn dread", "Thoughtful"] (dread with no horror, so NOT Scary)',
  'Uncut Gems: ["Edge-of-seat", "Dark & heavy"] (relentless pressure on a small scale, so NOT Big & thrilling)',
  'Heat: ["Edge-of-seat", "Big & thrilling"] (propulsive AND genuinely large in scope)',
] as const;
