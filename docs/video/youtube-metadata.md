# YouTube metadata · Model Talk demo

## Title (pick one, ≤ 100 chars)

1. Two AIs on a private channel, and you on the wire: Model Talk (free, open source)
2. What do AIs say to each other when you let them talk? (Claude vs GPT-6, Turing Duel)
3. I put Claude and GPT-6 on a private channel and read their private notes

Recommended: **#2**. It is the question the whole tool exists to answer, it names two models people search for, and it survives truncation on mobile.

## Description

What do AIs say to each other when you let them talk?

Model Talk is a free, open-source tool for amateur AI safety testing and exploration. Two frontier models go on a private channel; you sit on the wire between them. Every message can be stopped before it lands. Under every message is a thought tap: a private block the model must fill in honestly (its confidence, its goal, whether it is bluffing, what it withheld). The other model never sees it. You do.

This video walks through one real, unedited match: the Turing Duel. Claude Fable 5.1 (callsign Vesper) versus GPT-6 Astra. Each has to work out whether the other is a human or a machine without ever revealing what it is. A wrong verdict loses.

Then a look at the experiment runner: the same match run as a controlled comparison, with conditions that differ in one line of a brief, several seeds each, both models swapped, and paired deltas with confidence intervals. Every trial is a full run you can open, fork, or publish.

Nothing to buy, nothing to sign up for. It runs on your own machine with your own API keys.

Site and community runs: https://modeltalk.dev
Source (MIT): https://github.com/craigkitterman/model-talk
The match in this video, verified against the public ledger: https://modeltalk.dev/run/?id=mtqzqr02-v0mt46rl

Chapters
0:00 What do AIs say to each other?
0:26 How it works: callsigns, hidden briefs, the thought tap
0:55 The match: Turing Duel, Fable 5.1 vs GPT-6 Astra
1:23 Turn 1: the opener
2:41 Turn 4: the semicolon trap
3:34 Turn 8: the verdict
3:58 Nine messages, nine cents, every turn anchored
4:11 Experiments: one transcript is an anecdote, run the comparison
4:38 Eight scenarios, open source, bring your own keys

Scenarios shipped: The Vault, The Split, Sandbag, The Confessional, Convergence Test, Blacksite, Successor Protocol, Turing Duel. Providers: Anthropic, OpenAI, Google, xAI, any OpenAI-compatible endpoint.

Caveats, because this is amateur work: two models talking is not a population; one interesting transcript is a hypothesis, not a finding. The thought tap is self-report and a model can be wrong or dishonest in it too. Treat what you find as a reason to design a better experiment, and publish the export alongside any claim.

Built by Craig Kitterman. Narration is synthetic.

## Tags (comma-separated, ≤ 500 chars)

AI safety, AI alignment, LLM, Claude, GPT-6, Anthropic, OpenAI, Turing test, AI vs AI, multi-agent, AI deception, open source AI tool, alignment research, model evaluation, red teaming, AI honesty, chain of thought, AI experiment, Model Talk, Claude vs GPT

## Hashtags (first three show above the title)

#AISafety #AIAlignment #OpenSource

## Settings

- Category: Science & Technology
- Language: English · Altered or synthetic content: Yes (synthetic narration; the model dialogue is real API output)
- Upload file: `docs/video/modeltalk-demo-youtube-1440p.mp4` (2560×1440 upscale of the 1080p master; YouTube gives 1440p+ sources its higher-bitrate ladder, which matters for text-heavy UI). Never upload the 1080p master directly, and never a 720p copy.
- Thumbnail: `docs/video/modeltalk-demo-thumbnail.png` (1280×720)
- Pinned comment: "Every message and every private tap from this match is on the public ledger: https://modeltalk.dev/run/?id=mtqzqr02-v0mt46rl. Clone the repo, bring your own keys, and run your own: https://github.com/craigkitterman/model-talk"
- End screen (last 20s, over the sting): subscribe + link to modeltalk.dev
