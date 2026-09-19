"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { Country, FactCategory } from "@/lib/types";
import { FACT_CATEGORIES } from "@/lib/types";
import { enumerateFacts, type Fact } from "@/lib/facts";
import { cycleFactState, useFactStateMap } from "@/lib/factState";
import { countrySimulatedMiles } from "@/lib/simulatedDistance";
import FamiliarityToggle from "./FamiliarityToggle";

const CATEGORY_LABEL: Record<FactCategory, string> = {
  language: "Language",
  road_furniture: "Road furniture",
  architecture: "Architecture",
  nature: "Nature",
  vehicles: "Vehicles",
  google_coverage: "Google coverage",
};

const CARD = "rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:p-6";
const CARD_HEADING =
  "font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/70";

export interface FamilyEntry {
  id: string;
  name: string;
  isNational: boolean;
}

export default function CountryDetail({
  country,
  family,
  parent,
}: {
  country: Country;
  family: FamilyEntry[];
  parent?: Country;
}) {
  const factState = useFactStateMap();

  // A blank field on a region is shown with the national value, greyed, so it
  // isn't mistaken for "unknown". These are display-only — never learnable facts.
  const inheritedValues = useMemo(() => {
    const map: Record<string, string> = {};
    if (!parent) return map;
    for (const f of enumerateFacts(parent)) {
      if (!f.isBlank) map[`${f.category}.${f.field}`] = f.value;
    }
    return map;
  }, [parent]);

  const factsByCategory = useMemo(() => {
    const groups = {} as Record<FactCategory, Fact[]>;
    for (const cat of FACT_CATEGORIES) groups[cat] = [];
    for (const f of enumerateFacts(country)) groups[f.category].push(f);
    return groups;
  }, [country]);

  const { learnable, mastered, miles } = useMemo(() => {
    const learnableFacts = FACT_CATEGORIES.flatMap((c) =>
      factsByCategory[c].filter((f) => !f.isBlank),
    );
    return {
      learnable: learnableFacts.length,
      mastered: learnableFacts.filter((f) => factState[f.id] === "mastered")
        .length,
      miles: countrySimulatedMiles(
        learnableFacts.map((f) => f.id),
        factState,
      ),
    };
  }, [factsByCategory, factState]);

  const isDraft = country.status === "draft";
  const nationalName = family.find((f) => f.isNational)?.name;

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
      <Link
        href="/"
        className="text-sm text-cyan-300/80 transition-colors hover:text-cyan-200"
      >
        ← World map
      </Link>

      {/* ---- header ---- */}
      <header className="mt-5 border-b border-slate-800 pb-6">
        {country.parent && nationalName && (
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
            Region of {nationalName}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-3xl font-semibold text-slate-50">
            <span className="mr-2">{country.quick_id.flag_emoji}</span>
            {country.name}
          </h1>
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">
            Tier {country.tier}
          </span>
          <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
            {country.continent}
          </span>
          {isDraft ? (
            <span
              className="inline-flex items-center gap-1.5 text-xs text-amber-400"
              title="unverified — fact-check before trusting"
            >
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              draft
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              reviewed
            </span>
          )}
        </div>

        <p className="mt-2 text-sm text-slate-400">
          Drives on the{" "}
          <span className="text-slate-200">{country.quick_id.driving_side}</span>
          {" · "}
          Capital{" "}
          <span className="text-slate-200">{country.quick_id.capital}</span>
        </p>

        <p className="mt-3 font-mono text-xs text-slate-400">
          <span className="text-cyan-200">{mastered}</span>
          <span className="text-slate-500"> / {learnable}</span> facts mastered
          <span className="mx-2 text-slate-700">·</span>~
          <span className="text-cyan-200">{miles.toLocaleString()}</span> mi
          simulated miss
        </p>
      </header>

      {/* ---- family nav (national + regions) ---- */}
      {family.length > 1 && (
        <nav className="mt-6 flex flex-wrap gap-2">
          {family.map((f) => {
            const active = f.id === country.id;
            return (
              <Link
                key={f.id}
                href={`/country/${f.id}`}
                aria-current={active ? "page" : undefined}
                title={f.name}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-100"
                    : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                }`}
              >
                {f.isNational
                  ? `${f.name} · national`
                  : shortRegionLabel(f.name, nationalName)}
              </Link>
            );
          })}
        </nav>
      )}

      {/* ---- fact sections, fixed order ---- */}
      <div className="mt-6 space-y-4">
        {FACT_CATEGORIES.map((cat) => (
          <section key={cat} className={CARD}>
            <h2 className={CARD_HEADING}>{CATEGORY_LABEL[cat]}</h2>
            <dl className="mt-3 divide-y divide-slate-800/70">
              {factsByCategory[cat].map((fact) => (
                <FactRow
                  key={fact.id}
                  fact={fact}
                  state={factState[fact.id] ?? "new"}
                  onCycle={() => cycleFactState(fact.id)}
                  inherited={
                    fact.isBlank
                      ? inheritedValues[`${fact.category}.${fact.field}`]
                      : undefined
                  }
                />
              ))}
            </dl>
          </section>
        ))}

        {/* ---- confusion set ---- */}
        {country.confusion_set.length > 0 && (
          <section className={CARD}>
            <h2 className={CARD_HEADING}>Confusion set</h2>
            <ul className="mt-3 space-y-4">
              {country.confusion_set.map((c, i) => (
                <li
                  key={`${c.country}-${i}`}
                  className="border-l-2 border-slate-700 pl-3"
                >
                  <p className="text-sm font-medium text-slate-100">
                    {c.country}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    <span className="text-slate-500">Shared — </span>
                    {c.shared_traits}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    <span className="text-slate-500">Tiebreaker — </span>
                    {c.tiebreaker}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---- sources ---- */}
        {country.sources.length > 0 && (
          <section className={CARD}>
            <h2 className={CARD_HEADING}>Sources</h2>
            <ol className="mt-3 space-y-1.5">
              {country.sources.map((url) => (
                <li key={url} className="text-sm">
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="break-all text-cyan-300/80 underline-offset-2 hover:text-cyan-200 hover:underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-slate-500">
              {isDraft
                ? "Draft — verify each field against these before trusting it."
                : "Reviewed against these sources."}
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

/** "Southeast Brazil (São Paulo · …)" -> "Southeast" for the nav pill. */
function shortRegionLabel(name: string, nationalName?: string): string {
  const parenIdx = name.indexOf(" (");
  let short = parenIdx > 0 ? name.slice(0, parenIdx) : name;
  if (nationalName && short.endsWith(` ${nationalName}`)) {
    short = short.slice(0, -(nationalName.length + 1));
  }
  return short;
}

function FactRow({
  fact,
  state,
  onCycle,
  inherited,
}: {
  fact: Fact;
  state: "new" | "familiar" | "mastered";
  onCycle: () => void;
  inherited?: string;
}) {
  const isSampleText =
    fact.category === "language" && fact.field === "sample_text";

  const tint =
    state === "mastered"
      ? "bg-amber-400/[0.04]"
      : state === "familiar"
        ? "bg-cyan-400/[0.04]"
        : "";

  return (
    <div className={`flex gap-3 py-3 ${tint}`}>
      <div className="pt-0.5">
        {fact.isBlank ? (
          <span
            className="inline-flex h-6 w-6 items-center justify-center"
            title="not documented — nothing to learn yet"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
          </span>
        ) : (
          <FamiliarityToggle state={state} onCycle={onCycle} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-500">
          {fact.label}
        </dt>
        <dd className="mt-1">
          {fact.isBlank && inherited ? (
            <span className="text-sm text-slate-500">
              {inherited}{" "}
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-600">
                · inherited from national
              </span>
            </span>
          ) : fact.isBlank ? (
            <span className="text-sm italic text-slate-600">not documented</span>
          ) : isSampleText ? (
            <span className="inline-block rounded border border-slate-700 bg-slate-950/60 px-2 py-1 font-mono text-sm text-slate-200">
              {fact.value}
            </span>
          ) : (
            <span className="text-sm text-slate-200">{fact.value}</span>
          )}
        </dd>
      </div>
    </div>
  );
}
