# AI System Architecture Designer

A visual, browser-based designer for AI systems. Assemble components such as an **LLM, vector database,
retriever, reranker, embedding model, API gateway, cache, queue, GPU server, guardrails and monitoring**,
connect them, and see:

- **Data flow**: requests/second on every connection, with animated flow and sync / async / telemetry link types
- **Dependencies**: select a component to highlight everything upstream and downstream, plus its blast radius
- **Bottlenecks**: utilisation per component (amber ≥ 75%, red > 100%), the primary bottleneck, max sustainable traffic
- **Latency and cost**: critical (slowest) path, end-to-end latency, average latency with cache hits, monthly cost
- **Findings**: overloads, single points of failure, cycles, missing monitoring/caches/GPU, disconnected parts
- **Export**: Mermaid (`.mmd` / `.md`, copy to clipboard) and standalone SVG, plus save/open as JSON

There are no dependencies and no build step. Everything runs in the browser, and designs auto-save to `localStorage`.

## Run locally

Requires Node.js 16 or newer.

```bash
node server.js
```

Then open <http://localhost:4173>. To use a different port: `PORT=5000 node server.js`
(PowerShell: `$env:PORT=5000; node server.js`).

## Files

| Path | Purpose |
| --- | --- |
| `server.js` | Tiny static file server, bound to 127.0.0.1 |
| `public/index.html` | Page layout, plus the "What is this tool for", "How to use this tool" and "How the analysis works" sections |
| `public/styles.css` | Styles |
| `public/app.js` | Component catalogue, templates, canvas editor, analysis engine, Mermaid/SVG export |

## Analysis model (summary)

- Traffic enters at *Client / Users* nodes and propagates along connections, multiplied by each link's *calls per request*.
- Caches forward only misses, load balancers split evenly, and telemetry links never carry traffic further.
- `utilisation = load ÷ (capacity per replica × replicas)`; `max sustainable = traffic ÷ highest utilisation`.
- Latency is the longest chain of **synchronous** calls; async links are off the request path.

This is a planning estimate, not a load test. Replace the default capacities and latencies with your own benchmarks.
