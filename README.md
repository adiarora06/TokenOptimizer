# Token Optimizer

Token Optimizer is a local Node.js and vanilla HTML/CSS/JavaScript prototype that generates multi-agent Handoff Contracts, visualizes agent data flow, and optionally routes generation through Groq with OpenAI fallback.

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
