# Pratibimb: a digital twin for type 2 diabetes

Pratibimb (Sanskrit for "reflection") is a working model of one person's metabolism. It is fitted to their own CGM, meals, walks, sleep and medicines. It plays the next hours forward, explains why, and lets patients and clinicians try a change on the twin before trying it on the person.

> **Research prototype. Not a medical device. All patient data is synthetic.**

| | |
|---|---|
| **Demo video (15 min)** | https://www.youtube.com/watch?v=veTwt_dNIos |
| **Presentation** | [docs/Pratibimb_Presentation.pdf](docs/Pratibimb_Presentation.pdf) |
| **Architecture diagram** | [docs/Pratibimb_Architecture.pdf](docs/Pratibimb_Architecture.pdf) |
| **License** | MIT, see [LICENSE](LICENSE) |

## Team details

| Name | Role | Contact |
|---|---|---|
| Khushi | twin engine, backend, AI integration, tests | Khushiiii24 |
| Pratush Shyam Gupt | frontend, design system, pages, documentation | psg-19 |

## College / incubator

IIIT Lucknow, Lucknow Uttar Pradesh.

## Problem statement

People with type 2 diabetes manage their condition alone for most of the day. A doctor sees them every few months, and a CGM alarm only sounds once glucose is already out of range. The dangerous events are often predictable from the person's own patterns. One example is the overnight low after a light dinner and a long walk. Today they are caught late, often while the person is asleep.

Care teams have the opposite problem. They look after many patients and usually triage by the last reading. A patient whose number looks fine now, but who is heading for a low tonight, does not stand out.

Generic advice does not help much either, because each body responds differently to rice, a walk, a short night's sleep or a missed dose.

## Healthcare use case

**Proactive, personalised glucose care at home, with the clinician in the loop.**

- **Patient (Suresh, 54, type 2 diabetes for 9 years, synthetic):** at 21:40 his twin forecasts a low between about 00:15 and 03:35. It shows the chance, the window and the reason: a long walk straight after a light dinner. One tap plans a bedtime snack, and the twin redraws the night with it. Without the twin, the first warning is the CGM alarm in the middle of the night.
- **Care team:** patients are ranked by what their twins predict for the next six hours, not by their last reading. Each patient comes with the drivers, a suggested next step, a handoff note and a draft message in the patient's language. The clinician edits and sends it.
- **Before a change:** patients and clinicians try a different dinner, walk, sleep or a missed dose on the twin first, and see the evening and the night after.
- **Onboarding:** a new patient signs up, consents to each data source separately, connects a CGM (demo sensor, Dexcom Clarity CSV or LibreView CSV), adds lab reports, and has their own twin in seconds.

## What it does

| Feature | Screen |
|---|---|
| Live forecast with an uncertainty band (2, 6 or 12 h), chance of a low or a long high, risk window | Live twin |
| "Why the twin thinks so": the drivers behind each forecast, measured by replaying the evening with one thing changed | Live twin, Care team |
| Bedtime-snack plan, care-team alert, dismiss, with the forecast redrawn | Live twin |
| Track record: the twin back-tests itself on the last 10 evenings and shows its own error | Live twin |
| Learned facts about this person (meal peaks, walk effect, sleep effect, when lows happen) | Live twin |
| Unlogged meals found in the CGM, for the patient to confirm or reject | Live twin |
| HbA1c outlook: lab results plus the twin's estimate (GMI) and a projection | Live twin |
| What-if simulator: dinner, portion, walk, sleep, evening dose; compare saved scenarios | What-if |
| Patients ranked by predicted risk, with filters, review status and actions | Care team |
| Consent per data source, CSV import, lab-report upload, "Build my twin" | Connect data |
| Messages between patient, twin and care team | Messages |
| Live demo clock (1x, 15x, 60x) with new CGM readings and updated forecasts | All |

### AI features

| Feature | Screen |
|---|---|
| Meal from a photo, or from a description typed or spoken in English, हिन्दी or ಕನ್ನಡ | Live twin, Log a meal |
| **Ask your twin**: a chat agent whose tools run this patient's forecast, what-ifs and learned facts | Live twin |
| Plain-language explanation of tonight's forecast in the patient's language | Live twin alert |
| Lab report or prescription (PDF or photo) to structured records, reviewed before saving | Connect data |
| Dinner ideas suggested by the model and ranked by the twin | What-if |
| SBAR handoff note, and messages drafted in the patient's language for the clinician to edit | Care team |

Guardrails: the AI never suggests changing a medicine dose, and every number it quotes comes from the twin (tool results or data passed in). Without a key, or when the API is rate-limited, meal text uses a built-in Indian food table, and dinner ideas, messages, briefs and explanations use templates. Photo reading, record extraction and chat need the key.

## Technical stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, React Router; hand-built SVG charts (no chart library); CSS custom properties generated from design tokens |
| Backend | Node.js, Fastify, Server-Sent Events for live updates, cookie sessions with scrypt password hashing |
| Database | SQLite (better-sqlite3) |
| Twin engine | Plain TypeScript in `shared/`, used by the server, the browser and the tests; model fitting runs in Node worker threads |
| Generative AI | Google Gemini through the `@google/genai` SDK |
| Validation and tests | zod, Vitest (128 tests), ESLint with jsx-a11y |
| Deployment | One Node process serves the API and the built app; Dockerfile and docker-compose included |

## AI/ML model and framework details

### 1. The digital twin (personalised physiological model)

- **Physiology** (`shared/physio/model.ts`): a Bergman-style minimal model of glucose and insulin with a simple pancreas. It is extended with two-speed meal absorption (gamma-shaped fast and slow parts), the immediate and delayed effects of a walk, metformin and sulfonylurea pharmacokinetics, sleep debt, illness and the dawn rise.
- **Personal fit** (`shared/twin/fit.ts`): ten parameters per person (basal glucose, insulin sensitivity, carb gain, absorption, walk effects, metformin effect, sleep sensitivity, dawn rise). They are estimated from 14 days of that person's CGM by maximum a posteriori estimation with a population prior, optimised with Nelder–Mead. A Laplace approximation gives the parameter uncertainty.
- **Unlogged-meal detection** (`detect.ts`): rises that no logged meal explains are found and sized by least squares, then the model is refitted with them (an EM-style loop). They appear in the timeline for the patient to confirm or reject.
- **Routine learning** (`routine.ts`): usual meal times and sizes, walks and doses, used to fill the hours ahead.
- **Probabilistic forecast** (`forecast.ts`): the hidden state now (insulin action, gut contents, walk load) is estimated, then 60 plausible versions of the person are played forward, with parameter uncertainty and day-to-day variability. This gives the median, the band, P(low), P(high) and the risk window.
- **Self-calibration** (`calibrate.ts`): after each fit, the twin back-tests itself on its last 10 evenings and widens or shifts its forecasts by its own measured error.
- **Explanations** (`drivers.ts`): counterfactual replays (dinner at its usual size, no walk, the missed dose taken, and so on) measure how much each factor moved tonight's forecast.
- **What-if, insights, outlook, triage**: controlled experiments on the fitted twin; HbA1c estimate from the glucose management indicator; ranking patients by predicted six-hour risk.
- **Synthetic patients** (`shared/synth`): six personas, each with a hidden "true" physiology, Indian daily routines, day-to-day variability, CGM lag and noise, sensor gaps and imperfect logging. A live loop keeps simulating them on the demo clock.

### 2. Generative AI (Google Gemini)

- **Model:** `gemini-3.8-flash` by default, set with `AI_MODEL` (for example `gemini-3.5-flash-lite`).
- **SDK:** `@google/genai`, with structured output through JSON Schema (validated with zod) and vision input for meal photos, PDFs and images.
- **Agent:** "Ask your twin" is a function-calling agent with five tools that run on the patient's own twin: `get_status`, `get_forecast`, `simulate_dinner`, `get_learned_physiology` and `lookup_food`. Answers stream to the browser.
- **Safety:** system prompts forbid dose advice and invented numbers. Blocked or cut-off answers are never shown as real answers. Every AI feature with an offline equivalent falls back to it.

## Architecture

The full diagram is in [docs/Pratibimb_Architecture.pdf](docs/Pratibimb_Architecture.pdf).

```
Data sources                Server (Node.js, Fastify)                         Browser (React)
CGM / CSV import  ──┐       ┌──────────────────────────────────────────┐      ┌──────────────────────┐
Smartwatch        ──┤       │ REST API + SSE ── auth, consent, routes  │◀────▶│ Patient: live twin,  │
Meal log          ──┼──────▶│ Twin service ── fit pool (workers)       │      │ what-if, messages    │
Health records    ──┤       │   twin engine: fit · detect · forecast   │      │ Care team: triage,   │
BP cuff           ──┘       │   calibrate · drivers · what-if · triage │      │ handoff, messages    │
                            │ AI service ──▶ Google Gemini (optional)  │      └──────────────────────┘
                            │ SQLite                                   │
                            └──────────────────────────────────────────┘
```

## Outcomes

Results from the six synthetic patients, 14 days of data each:

| Measure | Result |
|---|---|
| Fit error (RMSE) | 6.6 to 12.4 mg/dL (MARD 3.6 to 5.3%) |
| Back-tested forecast error, 1 h ahead | 2.9 to 4.8 mg/dL (9 to 10 evenings per patient) |
| Back-tested forecast error, 4 h ahead | 3.0 to 6.8 mg/dL |
| Unlogged meals found in the CGM | 2 to 5 per patient |
| Demo night | At 21:40 the twin flags Suresh's low for 00:15 to 03:35, more than two hours before the risk window opens |
| Triage | Suresh (low) and Arjun (fever, persistent high) ranked High; Meera Medium; three stable patients Low |

The engine and the synthetic patients share the same family of models, so these numbers are optimistic. Validation on real CGM data is still to come.

The app itself: 128 automated tests (engine, importers, API, AI against a mock of the Gemini API), keyboard and screen-reader support, 44 px touch targets, contrast of at least 4.5:1, and layouts from 360 px phones to 1440 px desktops.

## Run it

Needs Node.js 20.6 or newer (Node 22 LTS recommended).

```bash
npm install
cp .env.example .env        # optional: add GEMINI_API_KEY to turn on the AI features
npm run dev                 # API on :8787, web on http://localhost:5173
```

On Windows, double-click `start-pratibimb.cmd`, or see [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md).

The first start seeds six synthetic patients with 21 days of data each and fits their twins, which takes about 10 seconds. Data lives in `data/pratibimb.db`. Delete it, or run `npm run seed:reset`, to start over.

### Demo accounts (password `pratibimb`)

| Email | Who |
|---|---|
| `suresh@pratibimb.demo` | Patient. Light dinner plus a long walk: the twin expects a low tonight |
| `doctor@pratibimb.demo` | Care team. Sees all patients ranked by their twins |
| `lakshmi@`, `arjun@`, `meera@`, `fatima@`, `imran@pratibimb.demo` | Other patients |

You can also sign up as a new patient, connect the demo sensor (or import a Dexcom Clarity or LibreView CSV) and build your own twin.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) and web app with hot reload |
| `npm run check` | tokens, typecheck, lint and tests |
| `npm run build` | web bundle (`dist/`) and server bundle (`build/`) |
| `npm start` | production server: API and app on one port (8787) |
| `npm run seed:reset` | wipe the demo data and reseed |

Docker: `docker compose up --build`, then open http://localhost:8787.

### Configuration

See `.env.example`: `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `AI_MODEL`, `DEMO_START` (IST), `DEMO_SPEED`, `PORT`, `HOST`, `DB_FILE`, `COOKIE_SECURE`.

On the Gemini free tier, Google may use prompts, photos and documents to improve its products. Use synthetic or non-personal data only. Real patients would need a paid key and a data-processing agreement.

## Project layout

```
shared/    twin engine, physiology, synthetic patients, CSV importers, API types
server/    Fastify API, SQLite, auth, live loop, fitting worker pool, AI service
src/       React app (Vite, React Router)
tests/     engine, importers, API integration, AI (mock Gemini API)
design/    design tokens (colours, palettes) used to generate the CSS
docs/      presentation, architecture diagram, Windows setup
```

## Limits

- All patients and devices are synthetic. CGM, smartwatch and ABHA/ABDM integrations are represented by the synthetic sensor, CSV import and record upload. Real integrations would write to the same tables.
- The twin is a research model. Its error has been measured only on synthetic patients so far.
- Hindi and Kannada message templates should be reviewed by native speakers before use with patients.
- The twin suggests; it never changes a prescription. Any dose change goes to the patient's doctor.

## License

Released under the [MIT License](LICENSE).
