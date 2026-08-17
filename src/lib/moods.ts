/**
 * The eleven moods, and the ONLY place any of them is spelled out.
 *
 * The tagger's prompt, the response validator, the mood picker, and the
 * /mood/[slug] route all read from here. Nothing else may hardcode a label or a
 * slug: a label that drifts from this list silently stops matching stored rows,
 * because `moods` holds these exact strings.
 *
 * Framing is "I want something…", describing what you want to WATCH, not how
 * you currently feel.
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
  {
    label: "Tense & gripping",
    slug: "tense-gripping",
    definition:
      "Sustained suspense or pressure that makes it hard to look away. Thrillers, heists, slow-burn dread.",
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
    definition: "Spectacle, scale, momentum, action. Blockbuster energy.",
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
 * The disambiguation the tagger needs most. Conceptual sits next to Thoughtful
 * and Weird, and the common failure is treating the three as synonyms rather
 * than as separate axes. Kept next to the definitions so the two can't drift.
 */
export const MOOD_DISAMBIGUATION = [
  "Thoughtful is TONE AND PACE (slow, meditative). Conceptual films can be brisk and fun: Palm Springs is Conceptual but NOT Thoughtful.",
  "Weird is STRANGE EXECUTION (surreal, offbeat). Arrival is Conceptual but NOT Weird: conventional execution, extraordinary premise.",
  "Judge each mood on its own criteria. Do not treat Conceptual, Thoughtful, and Weird as interchangeable.",
] as const;

/**
 * Worked examples showing that multi-tagging is correct, not a mistake. Chosen
 * to demonstrate both directions: moods that co-occur, and neighbouring moods
 * that deliberately do NOT apply.
 */
export const MOOD_EXAMPLES = [
  'Primer: ["Conceptual", "Thoughtful"]',
  'Perfect Blue: ["Conceptual", "Weird", "Tense & gripping"]',
  'Palm Springs: ["Conceptual", "Light & funny"] (brisk and funny, so NOT Thoughtful)',
  'Arrival: ["Conceptual", "Thoughtful"] (conventional execution, so NOT Weird)',
  'Parasite: ["Tense & gripping", "Dark & heavy", "Thoughtful"]',
] as const;
