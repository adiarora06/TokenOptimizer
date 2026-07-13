# Token Optimizer

Token Optimizer is a local Node.js and vanilla HTML/CSS/JavaScript prototype that converts long prompts into self-optimizing multi-agent runs using Handoff Contracts, staged prompts, Groq, and OpenAI fallback.

## Run Locally

```bash
npm start
```

Then open:

```text
http://127.0.0.1:8787/token-optimizer-file-generator.html
```

## Optional Provider Keys

Copy the example env file and add rotated keys:

```bash
cp .env.local.example .env.local
```

```env
GROQ_API_KEY=
OPENAI_API_KEY=
```

The browser never stores provider keys. The local Node server proxies provider calls through `/api/generate`.

## What It Does

- Converts a long prompt into a compact handoff contract.
- Creates staged Optimizer, Executor, and Verifier prompts.
- Runs the staged prompts through Groq with OpenAI fallback when keys are configured.
- Falls back to a deterministic offline run when provider keys are missing.
- Shows the final result, generated prompts, token report, and structure graph.
