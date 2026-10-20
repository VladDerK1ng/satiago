# How Satiago estimates expenditure

Expenditure (TDEE) is energy balance: what you logged minus the energy your body stored.

```
E = Ī − ρ · Δm/Δt
```

- `Ī` is the average logged intake.
- `ρ` is the energy stored per kg of body-mass change.
- `Δm/Δt` is the rate of change of tissue mass, read from noisy morning weigh-ins.

Every adaptive app shares this identity. They differ in how they read `Δm/Δt` through scale noise,
which `ρ` they use, and how they handle gaps. Code: `src/domain/expenditure.ts`.

## The estimator

The reported value is the average of two independent estimates.

**Rolling regression**

- Fit a weighted least-squares line through the last ≤ 70 days of weigh-ins.
  - Recency weights `e^(−age/14 d)`.
  - Three Huber passes down-weight odd readings.
  - The weights are first corrected for glycogen water (below).
- `raw = recency-weighted mean intake − slope · ρ`. Intake runs through yesterday, because a morning weigh-in reflects it and today's log is rarely complete.
- Blend each `raw` into the running estimate in proportion to its certainty:
  - the slope's standard error times `ρ`;
  - intake scatter;
  - a 40 kcal prior and a 4.5 kcal/day drift.
- A break of more than 7 days in logging or weighing starts a new window.

**Joint Kalman filter.** State: tissue mass `m`, transient water `w`, expenditure `T`.

```
m' = m + (I − T) / ρ(m)          w' = 0.6 · w          T' = T + 0.1 · Δ(intake trend)
morning weight = m + w + glycogen water + noise
```

- Each day predicts tomorrow's weight from intake and `T`, then corrects `T` by the miss. This is the
  loop MacroFactor describes for Expenditure V3, with gains set by measured noise:
  - scale noise 0.35 kg;
  - water 0.25 kg;
  - logging error 5 % + 60 kcal;
  - expenditure drift 7 kcal/day.
- Unlogged days are filled with your usual intake, with a wide error. Once more than 3 of the last
  7 days are unlogged, the fill carries no information, so weight changes during a break do not
  move expenditure.

## Physiology

- **Energy density.**
  - Formula: `ρ = f · 1,816 + (1 − f) · 9,440` kcal/kg, where `f = 10.4 / (10.4 + fat kg)`.
  - Sources: Hall 2008 tissue densities; Forbes' rule as used by Hall 2007.
  - Body fat comes from your log or profile, else from BMI.
  - Values: about 5,000 kcal/kg for a lean person, 7,800+ with more body fat.
  - The same `ρ` sets goal deficits and dashboard rates.
- **Glycogen water.**
  - Formula: `1.85 kg · (√(recent carbs ÷ usual carbs) − 1)`, capped at ±1.85 kg.
  - Recent carbs use a 2-day average. Usual carbs are your average over up to 180 days, so a lasting diet change is not slowly re-read as fat.
  - Applied only on days where every entry has carbs.
  - Glycogen holds at least 3 g of water per gram, so a switch to low-carb drops 1–2 kg that is not fat.
- **Steps** are not converted to calories.

## Holds and uncertainty

The estimate updates while at least 4 of the 7 days before today are logged and you weighed in within the last
7 days, and holds its last value otherwise. These are the same rules as MacroFactor V3.

Each value carries `sd`, about one standard deviation: 1.5 × the filter's own figure. With that
factor, ~68 % of simulated errors fall inside it.

## Evidence

Ground-truth simulator: 8 kinds of people × 10 unseen seeds. Scored from day 21 as mean absolute error
against the true trailing-week expenditure.

| Method | Error (kcal/day) |
|---|---|
| 3,500 kcal/lb rule | 108.6 |
| Satiago first release (21-day trend × 7,700) | 114.5 |
| Rolling regression alone | 89.8 |
| Kalman filter alone | 77.8 |
| **Average of both (shipped)** | **77.7** |

On a real 275-day MacroFactor export, the shipped estimator predicted 28-day weight change at least as
well as MacroFactor's own expenditure. It stayed within 28 kcal/day of MacroFactor's daily values on
average. `src/domain/calibrate.local.test.ts` reproduces this from any export
(`MF_EXPORT=path/to/export.xlsx npx vitest run src/domain/calibrate.local.test.ts`).

## Limits

- **Lean gain by trained lifters.** Lifters on high protein gain or keep more lean tissue than Forbes'
  rule assumes. Without body-fat readings, a lean lifter in a surplus can be under-estimated by about
  100–150 kcal/day.
- **Drifting under-reporting.** A steady under-count cancels, because targets use logged calories. One
  that drifts during a diet looks like a falling metabolism.
- **Fluid intake.** The glycogen-water ratio varies with how much you drink. The correction is a model
  choice.

## Sources

- MacroFactor, [Expenditure V3](https://macrofactor.com/expenditure-v3/) (2024).
- MacroFactor, [Expenditure modifiers](https://macrofactor.com/expenditure-modifiers/) (2025).
- Hall 2008, [Int J Obes](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376744/).
- Hall 2007, [Br J Nutr](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376748/).
- Thomas et al. 2013, [Int J Obes](https://pmc.ncbi.nlm.nih.gov/articles/PMC4024447/).
- Bray et al. 2012, [JAMA](https://pmc.ncbi.nlm.nih.gov/articles/PMC3777747/).
- Murray & Rosenbloom 2018, [Nutr Rev](https://pmc.ncbi.nlm.nih.gov/articles/PMC6019055/).
- Fernández-Elías et al. 2015, [Eur J Appl Physiol](https://europepmc.org/abstract/MED/25911631).
- Hall & Chow 2011, [Am J Clin Nutr](https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/).
- Sanghvi et al. 2015, [Am J Clin Nutr](https://pubmed.ncbi.nlm.nih.gov/26040640/).
