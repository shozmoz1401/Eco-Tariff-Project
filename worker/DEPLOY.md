# Deploying the AI proxy (only needed for a public copy outside claude.ai)

On claude.ai the simulator already uses Claude through the artifact platform. This Worker is for a public copy (e.g. GitHub Pages).

1. Create a free Cloudflare account. Free plan: 100,000 requests/day, 10 ms CPU per request (this Worker only forwards, so CPU use is tiny).
2. Get an Anthropic API key at console.anthropic.com and **set a monthly spend limit** on it there.
3. In this folder: `npx wrangler login`, then `npx wrangler secret put ANTHROPIC_API_KEY` and paste the key at the prompt. It is stored by Cloudflare, never in the repo or the page.
4. `npx wrangler deploy`. Note the URL, e.g. `https://tes-ai.<subdomain>.workers.dev`.
5. In `site/js/config.js`, set `aiEndpoint` to `<that URL>/v1/agent`. Set `ALLOWED_ORIGINS` in `wrangler.toml` to the site's origin.
6. Free route: set `PROVIDER = "openai"`, `OPENAI_COMPAT_URL`, `OPENAI_COMPAT_MODEL`, and the secret `OPENAI_COMPAT_KEY`. The model must support tool calling.

The Worker holds its own system prompts and tool definitions in `src/spec.generated.js`, generated from `site/js/ai.js`. After changing `ai.js` or the data, run `node build_spec.cjs` (the tests fail if it is out of date). The page sends only the task, the question, the scenario, recent chat history and tool results; any other request shape is rejected, so the Worker cannot be used as a general AI proxy. A caller can still type an off-topic question; the fixed prompt tells the model to decline, and the rate limits and the key's monthly spend limit cap the cost.

Test locally: `node test.mjs` (uses a fake upstream; no key needed).
