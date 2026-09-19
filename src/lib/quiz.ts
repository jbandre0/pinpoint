// Quiz logic — pure functions over country data + the familiarity map.
// No SRS: the quiz is just a filtered view of the fact pool.

import type {
  Country,
  FactCategory,
  FactStateMap,
  FactStateOrNew,
} from "./types";
import { CATEGORY_LABEL, enumerateFacts, type Fact } from "./facts";

export type QuizMode =
  | "category-isolated"
  | "discriminator"
  | "reverse-recall";

export interface QuizFilter {
  category: FactCategory | "any";
  states: FactStateOrNew[]; // non-empty subset of ["new","familiar","mastered"]
}

export interface PoolFact extends Fact {
  countryName: string;
  state: FactStateOrNew;
}

export interface CategoryIsolatedQuestion {
  mode: "category-isolated";
  fact: PoolFact;
  countryId: string;
  prompt: string; // "Road furniture · Bollard color"
  clue: string; // the field value, country blanked
  options: string[]; // shuffled country names incl. the answer ([] = free-text only)
  answer: string; // correct country name
}

export interface ReverseRecallQuestion {
  mode: "reverse-recall";
  countryId: string;
  countryName: string; // the prompt — everything else is revealed from the full record
}

export interface DiscriminatorQuestion {
  mode: "discriminator";
  countryId: string; // the source country the confusion entry belongs to
  answer: string; // source country name
  lookalike: string; // the confusion entry's country
  sharedTraits: string;
  tiebreaker: string; // the clue
  options: string[]; // shuffled: answer + up to 2 confusion-set countries
}

export type Question =
  | CategoryIsolatedQuestion
  | ReverseRecallQuestion
  | DiscriminatorQuestion;

/** Distinct country ids that have at least one fact matching the filter. */
export function countryPoolSize(
  countries: Country[],
  states: FactStateMap,
  filter: QuizFilter,
): number {
  const ids = new Set(
    factPool(countries, states, filter).map((f) => f.countryId),
  );
  return ids.size;
}

/** Total (country, confusion-entry) rounds available for the discriminator. */
export function discriminatorPoolSize(
  countries: Country[],
  states: FactStateMap,
  filter: QuizFilter,
): number {
  const eligible = new Set(
    factPool(countries, states, filter).map((f) => f.countryId),
  );
  let n = 0;
  for (const c of countries) {
    if (eligible.has(c.id)) n += c.confusion_set.length;
  }
  return n;
}

// --- helpers -------------------------------------------------------------

export function shuffle<T>(items: readonly T[]): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function normalizeGuess(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.’']/g, "");
}

export function matchesCountry(guess: string, country: Country): boolean {
  const g = normalizeGuess(guess);
  if (!g) return false;
  return [country.name, ...country.aliases].some(
    (name) => normalizeGuess(name) === g,
  );
}

/** State filter that means "only quiz facts the user currently has at mastered". */
export function isMasteredOnlyFilter(filter: QuizFilter): boolean {
  return filter.states.length === 1 && filter.states[0] === "mastered";
}

// --- pool + session ----------------------------------------------------

export function factPool(
  countries: Country[],
  states: FactStateMap,
  filter: QuizFilter,
): PoolFact[] {
  const out: PoolFact[] = [];
  for (const country of countries) {
    for (const f of enumerateFacts(country)) {
      if (f.isBlank) continue;
      if (filter.category !== "any" && f.category !== filter.category) continue;
      const state: FactStateOrNew = states[f.id] ?? "new";
      if (!filter.states.includes(state)) continue;
      out.push({ ...f, countryName: country.name, state });
    }
  }
  return out;
}

// --- answer-leak guard ---------------------------------------------------
// Some fact values name their own country or region ("Cooler and wetter than the
// rest of Ukraine..."), which gives the answer away when the value is shown as
// a category-isolated prompt. Such facts stay on the detail page and stay
// trackable; they just aren't used as question prompts.

const GENERIC_TOKENS = new Set(
  [
    "islands", "island", "central", "north", "northern", "south", "southern",
    "east", "eastern", "west", "western", "coast", "plains", "mountains",
    "highlands", "lowlands", "valley", "valleys", "region", "regions", "national",
  ].map((s) => s.toLowerCase()),
);

function baseName(name: string): string {
  return name.replace(/\s*\(.*$/, "").trim();
}

function parentheticalTokens(name: string): string[] {
  const m = name.match(/\(([^)]*)\)/);
  if (!m) return [];
  return m[1]
    .split(/[·,/&]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !GENERIC_TOKENS.has(t.toLowerCase()));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const leakRegexCache = new WeakMap<Country, RegExp | null>();

function leakRegex(country: Country, byId: Map<string, Country>): RegExp | null {
  const cached = leakRegexCache.get(country);
  if (cached !== undefined) return cached;
  const terms = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (t.length >= 3 && !GENERIC_TOKENS.has(t.toLowerCase())) terms.add(t);
  };
  add(baseName(country.name));
  country.aliases.forEach(add);
  parentheticalTokens(country.name).forEach(add);
  const parent = country.parent ? byId.get(country.parent) : undefined;
  if (parent) {
    add(baseName(parent.name));
    parent.aliases.forEach(add);
  }
  const re = terms.size
    ? new RegExp(
        `(?<![\\p{L}\\p{N}])(?:${Array.from(terms).map(escapeRe).join("|")})(?![\\p{L}\\p{N}])`,
        "iu",
      )
    : null;
  leakRegexCache.set(country, re);
  return re;
}

/** True when the fact's own text names its country, region or parent country. */
export function leaksAnswer(
  fact: Fact,
  country: Country,
  byId: Map<string, Country>,
): boolean {
  const re = leakRegex(country, byId);
  return re ? re.test(fact.value) : false;
}

function distractorNames(country: Country, all: Country[]): string[] {
  const names = new Set<string>();
  for (const c of all) if (c.id !== country.id) names.add(c.name);
  for (const entry of country.confusion_set) names.add(entry.country);
  return Array.from(names);
}

export function buildSession(
  countries: Country[],
  states: FactStateMap,
  mode: QuizMode,
  filter: QuizFilter,
  length: number,
): Question[] {
  const byId = new Map(countries.map((c) => [c.id, c] as const));

  if (mode === "category-isolated") {
    const promptable = factPool(countries, states, filter).filter(
      (f) => !leaksAnswer(f, byId.get(f.countryId)!, byId),
    );
    const picks = shuffle(promptable).slice(0, length);
    return picks.map((fact): CategoryIsolatedQuestion => {
      const country = byId.get(fact.countryId)!;
      const distractors = shuffle(distractorNames(country, countries)).slice(
        0,
        3,
      );
      return {
        mode: "category-isolated",
        fact,
        countryId: fact.countryId,
        prompt: `${CATEGORY_LABEL[fact.category as FactCategory]} · ${fact.label}`,
        clue: fact.value,
        options:
          distractors.length > 0
            ? shuffle([country.name, ...distractors])
            : [],
        answer: country.name,
      };
    });
  }

  if (mode === "reverse-recall") {
    const byCountry = new Map<string, PoolFact[]>();
    for (const f of factPool(countries, states, filter)) {
      const bucket = byCountry.get(f.countryId);
      if (bucket) bucket.push(f);
      else byCountry.set(f.countryId, [f]);
    }
    return shuffle(Array.from(byCountry.keys()))
      .slice(0, length)
      .map((countryId): ReverseRecallQuestion => ({
        mode: "reverse-recall",
        countryId,
        countryName: byId.get(countryId)!.name,
      }));
  }

  if (mode === "discriminator") {
    const eligible = new Set(
      factPool(countries, states, filter).map((f) => f.countryId),
    );
    const rounds: DiscriminatorQuestion[] = [];
    for (const country of shuffle(
      countries.filter(
        (c) => eligible.has(c.id) && c.confusion_set.length > 0,
      ),
    )) {
      for (const entry of shuffle(country.confusion_set)) {
        const others = country.confusion_set
          .filter((e) => e.country !== entry.country)
          .map((e) => e.country);
        const distractors = [entry.country, ...shuffle(others)].slice(0, 2);
        rounds.push({
          mode: "discriminator",
          countryId: country.id,
          answer: country.name,
          lookalike: entry.country,
          sharedTraits: entry.shared_traits,
          tiebreaker: entry.tiebreaker,
          options: shuffle([country.name, ...distractors]),
        });
      }
    }
    return shuffle(rounds).slice(0, length);
  }

  return [];
}
