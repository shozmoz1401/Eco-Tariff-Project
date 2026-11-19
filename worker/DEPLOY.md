# Deploying the AI proxy (only needed for a public copy outside claude.ai)

On claude.ai the simulator already uses Claude through the artifact platform. This Worker is for a public copy (e.g. GitHub Pages).

**Route A: no installs (GitHub deploys it).**
1. Create a free Cloudflare account (dash.cloudflare.com). Free plan: 100,000 requests/day.
2. Cloudflare: My Profile → API Tokens → Create Token → template "Edit Cloudflare Workers". Copy the token. Also copy your Account ID (Workers & Pages overview page, right side).
3. GitHub repo → Settings → Secrets and variables → Actions → New repository secret: `CLOUDFLARE_API_TOKEN` = the token, `CLOUDFLARE_ACCOUNT_ID` = the account ID. The next push deploys the Worker (`tes-ai`).
4. Anthropic Console (platform.claude.com): create a workspace for this site, **set its monthly spend limit (e.g. $5)**, then create an API key in that workspace.
5. Cloudflare → Workers & Pages → `tes-ai` → Settings → Variables and Secrets → Add → type **Secret**, name `ANTHROPIC_API_KEY`, paste the key. It is stored by Cloudflare, never in the repo, the page or GitHub.
6. In `site/js/config.js`, set `aiEndpoint` to `https://tes-ai.<subdomain>.workers.dev/v1/agent`. `ALLOWED_ORIGINS` in `wrangler.toml` is already the GitHub Pages origin.

**Route B: from your own machine.** In this folder: `npx wrangler login`, `npx wrangler secret put ANTHROPIC_API_KEY` (paste at the prompt), `npx wrangler deploy`.

Free route: set `PROVIDER = "openai"`, `OPENAI_COMPAT_URL`, `OPENAI_COMPAT_MODEL`, and the secret `OPENAI_COMPAT_KEY`. The model must support tool calling.

The Worker holds its own system prompts and tool definitions in `src/spec.generated.js`, generated from `site/js/ai.js`. After changing `ai.js` or the data, run `node build_spec.cjs` (the tests fail if it is out of date). The page sends only the task, the question, the scenario, recent chat history and tool results; any other request shape is rejected, so the Worker cannot be used as a general AI proxy. A caller can still type an off-topic question; the fixed prompt tells the model to decline, and the rate limits and the key's monthly spend limit cap the cost.

Test locally: `node test.mjs` (uses a fake upstream; no key needed).
