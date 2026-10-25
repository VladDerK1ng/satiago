# How Satiago estimates expenditure and sets targets

Expenditure (TDEE) is energy balance: what you logged minus the energy your body stored.

```
E = Ī − ρ · Δm/Δt
```

- `Ī` is the average logged intake.
- `ρ` is the energy stored per kg of body-mass change.
- `Δm/Δt` is the rate of change of tissue mass, read from noisy morning weigh-ins.

Every adaptive app shares this identity. They differ in how they read `Δm/Δt` through scale noise,
which `ρ` they use, how they handle gaps, and whether they expect expenditure to move before the scale
shows it. Code: `src/domain/expenditure.ts` (estimate), `src/domain/targets.ts` (targets).

## The estimator

The reported value is the average of two independent estimates.

**Rolling regression**

- Fit a weighted least-squares line through the last ≤ 70 days of weigh-ins.
  - Recency weights `e^(−age/14 d)`.
  - Three Huber passes down-weight odd readings.
  - The weights are first corrected for glycogen water (below).
- The window gives the average expenditure of the last few weeks:
  `recency-weighted mean intake − slope · ρ`. Intake runs through yesterday, because a morning weigh-in
  reflects it and today's log is rarely complete.
- That average is brought up to today with what is known to have moved expenditure since:
  `+ 0.24 · (intake of the last week − window intake) + 0.5 · (E / weight) · (weight now − window weight)`.
  Without this step the estimate lags a diet change by weeks (see "Adaptation" below).
- Each value is blended into the running estimate in proportion to its certainty:
  - the slope's standard error times `ρ`;
  - intake scatter;
  - a 40 kcal prior and a 4.5 kcal/day drift.
- A break of more than 7 days in logging or weighing starts a new window.

**Joint Kalman filter.** State: tissue mass `m`, transient water `w`, expenditure `T`.

```
m' = m + (I − T) / ρ(m)     w' = 0.6 · w     T' = T + 0.24 · Δ(intake trend) + 0.5 · (T / m) · (m' − m)
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
  - **High protein.** Forbes' data come from people who did not train. With resistance training and
    high protein, lean tissue is largely kept in a deficit (Longland 2016: +1.2 kg lean on 2.4 g/kg at
    −40 % energy; Hall 2008 notes his model cannot capture this). When your logged protein averages at
    least 1.6 g/kg over 14+ days of the last 4 weeks, `f` is halved. For a 70 kg man at 13 % body fat
    this moves `ρ` from about 5,350 to 7,400 kcal/kg.
  - The same `ρ` sets goal deficits and dashboard rates.
- **Adaptation.** Expenditure follows a change in intake: the thermic effect of food (about 10 % of
  intake) and adaptive thermogenesis. Satiago uses 24 % of the change within about a week. That matches
  CALERIE: on about 25 % calorie restriction, 24-h expenditure adjusted for body composition fell
  135 kcal/day (Heilbronn 2006), and total expenditure fell 9.6 % within 2–4 weeks (Racette 2012).
  Expenditure also falls as body mass falls; half of it is taken to scale with mass.
- **Glycogen water.**
  - Formula: `1.85 kg · (√(recent carbs ÷ usual carbs) − 1)`, capped at ±1.85 kg.
  - Recent carbs use a 2-day average. Usual carbs are your average over up to 180 days, so a lasting diet change is not slowly re-read as fat.
  - Applied only on days where every entry has carbs.
  - Glycogen holds at least 3 g of water per gram, so a switch to low-carb drops 1–2 kg that is not fat.
- **Steps** are not converted to calories.

## Targets

The goal rate (% of body weight per week) is a tissue balance: `rate × weight × ρ / 7` kcal/day. The
target intake allows for expenditure following intake:

```
target = I₀ + (E + goal balance − I₀) / (1 − 0.24)
```

- `I₀` is the average of your complete days in the last two weeks (at least 10).
- Starting a cut from maintenance (`I₀ = E`), the cut is a third larger than the tissue balance alone,
  because about a quarter of it is soon offset by lower expenditure. MacroFactor gets a similar effect
  from a fixed 3,500 kcal/lb.
- Once you eat the target, `I₀` equals it and the target is `E + goal balance`. The loop then settles
  on the goal rate instead of overshooting it.
- A fortnight far from the target (holiday, illness) moves it by at most a quarter of `E`.
- Targets update by themselves on your check-in day, and again whenever the method changes. The
  check-in screen is for a fresh weigh-in and a look at the week; it never asks you to adjust calories.

## Incomplete days, holds and uncertainty

A logged day below half of your usual intake (median of the previous 14 logged days) is left out, as a
forgotten meal would otherwise read as a large deficit. Marking it complete in the check-in brings it
back. Days marked fasted count as zero.

The estimate updates while at least 4 of the 7 days before today are logged and you weighed in within the last
7 days, and holds its last value otherwise. These are the same rules as MacroFactor V3.

Each value carries `sd`, about one standard deviation: 1.5 × the filter's own figure. With that
factor, ~68 % of simulated errors fall inside it.

## Evidence

**Ground-truth simulator.** 8 kinds of people × 10 unseen seeds, scored from day 21 against the true
trailing-week expenditure. The simulator follows Hall's model with Forbes partitioning and no
resistance training, so the high-protein adjustment never applies there.

| Method | Expenditure error (kcal/day) | 28-day weight forecast error (kg) |
|---|---|---|
| 3,500 kcal/lb rule | 108.6 | |
| Satiago first release (21-day trend × 7,700) | 114.5 | |
| Satiago 1.1.0 | 77.7 | 0.621 |
| **Satiago 1.1.1 (adaptation)** | **74.9** | **0.599** |

**Closed loop.** Five simulated people (cuts at 0.5–1 %/week, a lean bulk) eat each week's target for
16 weeks. Mean shortfall of the achieved rate against the goal:

| Method | Weeks 2–5 | Weeks 9–16 |
|---|---|---|
| Satiago 1.1.0 | 21 % | 26 % |
| **Satiago 1.1.1** | **15 %** | **16 %** |
| 1.1.1 with the high-protein density | 10 % | 16 % |

The remaining shortfall is mostly the simulated people eating about 1 % above their targets.

**A real 282-day log** (imported from MacroFactor, then continued in Satiago). Each estimate predicts
the weight change of the next 14 or 28 days from the intake actually logged, converting energy with its
own kcal/kg (MacroFactor's series at the 7,500 kcal/kg its goal deficits imply).

| Estimate | 14 days (kg) | 28 days (kg) |
|---|---|---|
| Satiago 1.1.0 | 0.623 | 0.660 |
| **Satiago 1.1.1** | **0.574** | **0.562** |
| MacroFactor's own expenditure | 0.565 | 0.542 |

Release 1.1.0 said Satiago forecast this log slightly better than MacroFactor. That test converted both
estimates with Satiago's own kcal/kg, which favours Satiago. Scored as above, 1.1.0 was clearly behind.
1.1.1 is close to MacroFactor, but not better.

`src/domain/calibrate.local.test.ts` scores an export (`MF_EXPORT=path/to/export.xlsx npx vitest run
src/domain/calibrate.local.test.ts`).

## Limits

- **Training is inferred from protein.** Someone who eats 1.6 g/kg of protein without training keeps
  less lean tissue than assumed, so their expenditure reads high while losing. Targets still reach the
  goal rate, because estimate and target use the same `ρ`.
- **Drifting under-reporting.** A steady under-count cancels, because targets use logged calories. One
  that drifts during a diet looks like a falling metabolism.
- **Fluid intake.** The glycogen-water ratio varies with how much you drink. The correction is a model
  choice.
- **Short-term water.** Two weeks of weigh-ins can show a rate from −0.9 to −0.2 kg/week on the same
  diet. The estimate weighs several weeks, so it reacts to such swings more slowly than MacroFactor.

## Sources

- MacroFactor, [Expenditure V3](https://macrofactor.com/expenditure-v3/) (2024).
- MacroFactor, [Expenditure modifiers](https://macrofactor.com/expenditure-modifiers/) (2025).
- Hall 2008, [Int J Obes](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376744/).
- Hall 2007, [Br J Nutr](https://pmc.ncbi.nlm.nih.gov/articles/PMC2376748/).
- Hall et al. 2011, [Lancet](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/).
- Heilbronn et al. 2006, [JAMA](https://pubmed.ncbi.nlm.nih.gov/16595757/).
- Racette et al. 2012, [Am J Physiol Endocrinol Metab](https://pubmed.ncbi.nlm.nih.gov/22127229/).
- Longland et al. 2016, [Am J Clin Nutr](https://europepmc.org/abstract/MED/26817506).
- Thomas et al. 2013, [Int J Obes](https://pmc.ncbi.nlm.nih.gov/articles/PMC4024447/).
- Bray et al. 2012, [JAMA](https://pmc.ncbi.nlm.nih.gov/articles/PMC3777747/).
- Murray & Rosenbloom 2018, [Nutr Rev](https://pmc.ncbi.nlm.nih.gov/articles/PMC6019055/).
- Fernández-Elías et al. 2015, [Eur J Appl Physiol](https://europepmc.org/abstract/MED/25911631).
- Hall & Chow 2011, [Am J Clin Nutr](https://pmc.ncbi.nlm.nih.gov/articles/PMC3127505/).
- Sanghvi et al. 2015, [Am J Clin Nutr](https://pubmed.ncbi.nlm.nih.gov/26040640/).
