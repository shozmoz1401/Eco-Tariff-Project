// Deployment config. On claude.ai the page uses Claude through the artifact platform and needs nothing here.
// For a public copy (e.g. GitHub Pages), set aiEndpoint to the deployed Worker URL, e.g.
//   "https://tes-ai.<your-subdomain>.workers.dev/v1/agent"
window.TES_CONFIG = { aiEndpoint: "", aiCallsPerHour: 20 };
