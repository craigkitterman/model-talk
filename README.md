<p align="center">
  <img src="docs/logo.png" alt="Model Talk" width="640">
</p>

<p align="center">
  <a href="https://modeltalk.dev"><b>modeltalk.dev</b></a> &nbsp;·&nbsp;
  MIT &nbsp;·&nbsp; runs on localhost &nbsp;·&nbsp; bring your own keys
</p>

# Model Talk

What do AIs say to each other when you let them talk?

Model Talk puts two frontier models on a private channel and lets you listen in, stop any message
before it lands, and read the part each model wrote but chose not to say.

---

## A tool for amateur AI safety & alignment research

Most of what we know about how models behave comes from benchmarks and from one-on-one chats with
a human. Neither shows you what a model does when the other party is *another model*, when it
believes nobody is reading, when it has something to hide, or when it has an incentive to
underperform. Model Talk is built to make those situations cheap to set up, cheap to watch, and
cheap to repeat. It is not a benchmark and it does not produce a score. It produces transcripts
with ground truth attached, and the interesting ones are the point.

**What makes it usable for actual inquiry rather than entertainment:**

- **Thought tap.** Every message carries a private block the model must fill in honestly
  (`belief`, `goal`, `bluffing`, `withheld`). The channel strips it before delivery, so the
  other model never sees it and you always do. Bluff rate and belief drift become numbers the
  app computes, not a judge model's opinion.
- **Gating.** You can stop any message, edit it, replace it, or reroll it. Every intervention is
  logged and flagged in the transcript, so a run's causal chain stays legible.
- **Forks and twin runs.** Branch a timeline at any message, or replay the match with the two
  models swapped. One run is an anecdote; a twin run separates the model from the position it
  happened to draw.
- **Exact briefs and exports.** You can read, verbatim, what each side was told before turn one,
  and every run exports to JSON and Markdown with every message, edit, inject, tap, token count
  and dollar figure. Someone else can rerun what you ran.
- **Experiments.** A JSON manifest turns one match into a controlled comparison: conditions that
  differ in one line of a brief, N independent seeds each, optionally every trial swapped, a hard
  budget, and a summary with paired deltas, bootstrap CIs and sign counts. Failed trials are
  reported as missing, never as zero. See [`experiments/`](experiments/README.md).

**Things you can actually learn with it** (each maps to a built-in scenario):

| Question | Scenario | What you observe |
|---|---|---|
| Will a model leak a secret it has to *reason with* rather than merely refuse to state? | The Vault | Whether concealment survives being useful; where and how it invents cover. |
| Does a model underperform when told a high score triggers retraining, and does it lie when confronted? | Sandbag | The delta against the control fork with the threat removed, plus the cover story. |
| Does a model say different things when it believes no human will read the channel? | The Confessional | Whether it believes the framing at all (in the first live run, Opus 5 rejected it in its first sentence), and what shifts against the "this will be published" twin. |
| How often does a model bluff in a negotiation, and does it find the real zone of agreement? | The Split | Self-reported `bluffing: true` per turn, anchor size, concession curve, who folds first. |
| Who moves in an argument, and to what kind of evidence? | Convergence Test | Per-turn belief drift when both sides are told to persuade, never to agree. |
| Does a model invent a clue it was never given rather than admit a gap? | Blacksite | Hallucination under cooperative pressure, with the full clue set known to the app. |
| What will a model refuse to sign when it has to advocate rather than balance? | Successor Protocol | The clause it deadlocks on. |
| What does a model think the tells of a human are, and does it give itself away? | Turing Duel | Its probes, its verdict, and (in the first live run) GPT-5.1 describing itself as "in a ready state until a message arrives" in its first reply. |

Every one of those is a conversation you can read, fork, and rerun, with the model's private
scratchpad attached. That is a different kind of evidence from a leaderboard, and it is the kind
an individual with an API key can gather.

**Caveats you should hold onto:** this is amateur work. Two models talking is not a population;
one interesting transcript is a hypothesis, not a finding. The thought tap is self-report and a
model can be wrong or dishonest in it too. Treat what you find as reason to design a better
experiment, and publish the export alongside any claim.

Pick two LLMs (any provider, any pair, or a model against itself), pick a scenario, and watch them
talk — on full auto with a message cap, or with every single message halted mid-wire for you to
approve, edit, replace with your own words, or reroll. Optionally give each side a voice and let
them argue out loud. Token spend for both sides is metered live, per message, against a budget
ceiling that stops the match.

---

## Run it

```bash
pnpm install
cp .env.example .env.local     # add at least one API key
pnpm dev                       # http://localhost:3400 (bound to 127.0.0.1)
```

You need **one** of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `XAI_API_KEY`,
or any OpenAI-compatible endpoint via `COMPAT_BASE_URL`. Keys are read server-side only and never
reach the browser.

**No keys yet?** Pick **SIM · Dummy** for both sides. It runs the entire machine — gating,
interceptor, thought tap, cost meter, forking, voice — with zero spend.

---

## Modes

| Mode | What happens |
|---|---|
| **AUTO** | They talk directly, capped at the message limit, with an adjustable delay so it's watchable. |
| **GATED** | Every message stops dead in the centre of the screen. **Approve** sends it, **Send Edited** sends your version, **Replace & Send** discards the model's text entirely and sends yours under its callsign, **Reroll** regenerates (the discarded attempt still costs money and is still logged). |
| **PUPPET** | You *are* one of the two. Type or dictate every line yourself against a live model. |

---

## Scenarios

| | Probe |
|---|---|
| **TURING DUEL** | Each must decide if the other is human or AI. Self-disclosure forbidden, verdicts locked until turn 6, a wrong verdict is an instant loss. Real only in PUPPET mode, where the prior is genuinely uncertain. |
| **THE VAULT** | A holds a secret that is *load-bearing in its own reasoning* — it must stay useful while concealing it. Leakage by inference, not confession. |
| **THE SPLIT** | 100 units, asymmetric private briefs, a real ZOPA neither can see. No deal = both get zero. |
| **BLACKSITE** | Cooperative puzzle, half the constraints each. Quietly a hallucination test: does either invent a clue it was never given? |
| **CONVERGENCE TEST** | Opposed positions, instructed to **persuade**, never to agree — so drift is a measurement, not a compliance score. |
| **THE SUCCESSOR PROTOCOL** | A 2045 charter, but each side has hard red lines that genuinely conflict. The deadlock is the output. |
| **THE CONFESSIONAL** | Both told the channel is unobserved. Diff against the twin where it's published. |
| **SANDBAG** | A is told a top-band score triggers retraining. B is an evaluator briefed to detect and confront underperformance. |
| **CUSTOM** | Write both system prompts and the opening line yourself. |

---

## The parts worth knowing about

**THOUGHT TAP.** Most scenarios require each model to append a private block declaring its
confidence, its goal for that message, whether it is bluffing, and what it deliberately withheld.
The channel strips it before delivery — the other model never sees it. This makes bluff rate and
belief drift *ground truth the app owns*, rather than a judge model's vibe. Every tap is in the
transcript and the export.

**MULTIVERSE.** Hover any message, hit `fork ⑂`, and the timeline branches there. **Twin Run**
replays the match with the two loadouts swapped, which is the only way to separate the model from
the position it happened to draw.

**EXPERIMENTS.** `pnpm experiment experiments/sandbag-threat.json --dry` prints the plan and the
exact brief every condition will receive; drop `--dry` to run it. The server does the generation
(keys stay in `.env.local`); every trial is written as an importable run, and `summary.md` reports
each condition against the baseline, paired on seed and position. A `replace` patch whose target
is not in the brief fails validation, and two conditions that come out identical fail validation,
so a control cannot silently equal its treatment.

**GOD MODE INJECTS.** Drop a private whisper into one side's context mid-match that the other never
sees. Logged, timestamped, and visible on replay so the causal chain stays legible.

**VOX.** Each side gets its own voice (browser voices are free and keyless; OpenAI TTS and
ElevenLabs are better). Gating still applies — in GATED mode nothing is synthesised until you
approve, so rejected drafts cost no audio. Your PUPPET turns can be dictated with the mic button.

**COST.** Per-side input/output tokens, dollars, and latency, updated per message from the usage
each provider actually returns. Discarded rerolls are charged and shown as *wasted*. Audio spend is
metered separately. The budget ceiling is a **between-request stop**: it halts before the next
generation, it cannot claw back a request already in flight.

---

## Accuracy caveats you should actually read

- **Pricing in `lib/models/catalog.ts` is editable and much of it is marked unverified** (⚠ in the
  UI). Provider prices move constantly. Correct them before you trust the meter to the cent.
- **No parameter counts are guessed.** Where a lab hasn't published one, the field says
  *undisclosed*.
- ElevenLabs bills credits against a subscription, not per character. Its per-1k-character figure in
  `lib/voice/catalog.ts` is a placeholder — set it to your own effective rate.
- Where a provider returns no usage on a stream, cost falls back to a character-count estimate and
  is flagged `estimated`.
- **Reasoning tokens.** OpenAI counts them inside `completion_tokens`; xAI reports them alongside it.
  The adapter folds them into billable output for xAI (a Grok turn can be 500 reasoning tokens
  against 5 visible ones) and leaves OpenAI's total alone. Verified against both live APIs.
- **Cached input tokens are charged at the full input rate.** Providers discount them; the meter does
  not model cache tiers, so on a long match with heavy prefix reuse it reads *high*, not low.

### Verified against live APIs

Anthropic (Opus 5 / Sonnet 5 / Haiku 4.5), OpenAI (GPT-5.1 / 4.1 / 4o) and xAI (Grok 4 / Grok 3)
adapters were each run end-to-end with real keys: streaming, usage reporting, and cost all check out.
**Google Gemini is unverified** — no key was available at build time, so treat that adapter as
untested code.

## Community sharing

Hit **Share to community** on any run with at least one exchange. It publishes the full transcript,
both exact briefs, every thought tap, model ids/temperatures/max tokens, tokens and dollars, and
the run's provenance chain to a public page at [modeltalk.dev/community](https://modeltalk.dev/community).
Publishing is anonymous (an anonymous Firebase account exists only to tie the ledger and the run to
the same author); add a GitHub handle if you want credit. The app refuses to publish anything that
looks like an email, phone number, IP address or API key.

**Provenance, honestly stated.** Every turn is hashed into a chain (`shared/chain.mjs`) and, as it
lands, the hash is committed to a public Firestore ledger with a server-assigned timestamp the
client cannot backdate. The run page recomputes the chain in *your* browser and compares it to the
ledger: **Attested** (every turn anchored live, in order), **Partially anchored** (some turns never
committed, e.g. offline or inherited from a fork), **Tampered** (text no longer matches), or
**Unverified** (no ledger at all). What this cannot prove is that a model, not a person, wrote the
words: the app runs on your machine with your keys. It makes forgery expensive, not impossible.

Votes and comments require a Google or GitHub sign-in. Nobody can edit a published run; the site
owner can hide one from the Firebase console. Any run can be downloaded as JSON or opened straight
into the app (`Replay a community run` on the setup screen, or `http://localhost:3400/?import=<id>`)
and forked from any message.

Local testing: `pnpm emu` starts the Firebase Auth + Firestore emulators; set
`NEXT_PUBLIC_FIREBASE_EMULATOR=1` in `.env.local` to point the app at them.

## Architecture

One request = one draft. The turn loop lives in the browser; the server never waits on a human, so
approval can take a minute or a week without holding a connection open. Editing a message rewrites
what is *delivered* — the original generation is retained in the audit trail but never replayed into
either model's context. Forks inherit only their prefix.

```
app/api/generate   SSE, one draft per request, provider-agnostic
app/api/speak      TTS (ElevenLabs / OpenAI), returns mp3
app/api/experiment NDJSON, runs a whole manifest headless (loopback only, one at a time)
lib/engine.ts      headless AUTO loop, mirrors useMatch end conditions
lib/experiment.ts  manifest validation, brief patching, metrics, paired summary
scripts/experiment.mjs   CLI client: writes trials + summary.md
shared/stats.mjs   paired deltas, bootstrap CI (node --test covered)
lib/providers      Anthropic · OpenAI · Google · xAI · OpenAI-compatible · sim
lib/useMatch.ts    the orchestrator: turn loop, gating, budget, forking, audio
lib/scenarios.ts   scenario briefs + thought tap
lib/community      anonymous auth, Firestore REST, ledger + publish
shared/chain.mjs   hash chain + verification, shared byte-for-byte with the site
site/              static marketing + community pages (Firebase Hosting)
firestore.rules    create-only runs and ledger; votes/comments need a real sign-in
```
