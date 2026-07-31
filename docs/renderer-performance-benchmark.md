# Renderer performance benchmark

`scripts/matlas-render-benchmark.mjs` compares renderer-sensitive behavior across one or more locally served mAtlas builds. It uses the repository's pinned Puppeteer dependency and prints both static inventory and runtime timing metrics.

The benchmark covers:

- repeated animated **Layered ↔ Compact** layout changes;
- repeated animated viewport pans as a control workload;
- DOM size, event-listener count, and JavaScript heap after forced garbage collection;
- main-thread, script, style, layout, frame, missed-frame, and long-task measurements.

The layout animation has a deliberately fixed duration, so compare CPU work and frame consistency rather than elapsed animation time.

## Prepare the builds

Build and serve each repository state on a different origin:

```bash
# Pre-change checkout
npm run build
PORT=4173 npm run preview
```

```bash
# Post-change checkout
npm run build
PORT=4174 npm run preview
```

Run the benchmark from a checkout containing the script and its `node_modules`:

```bash
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
npm run benchmark:renderer -- \
  --target before=http://127.0.0.1:4173 \
  --target after=http://127.0.0.1:4174 \
  --runs 10 \
  --warmup 3 \
  --rounds 5 \
  --cpu 4 \
  --markers on \
  --output renderer-markers-on.json
```

Omit `PUPPETEER_EXECUTABLE_PATH` when Puppeteer can use its bundled browser. Set `--cpu 1` to measure native-speed performance rather than a throttled lower-end machine.

## Isolate secondary-domain marker cost

The script writes a fresh preferences object before every browser reload. Use `--markers on` or `--markers off` to force the **Mark additional domains** preference in every target and round.

Run the same comparison twice:

```bash
npm run benchmark:renderer -- \
  --target before=http://127.0.0.1:4173 \
  --target after=http://127.0.0.1:4174 \
  --rounds 5 \
  --markers on \
  --output renderer-markers-on.json
```

```bash
npm run benchmark:renderer -- \
  --target before=http://127.0.0.1:4173 \
  --target after=http://127.0.0.1:4174 \
  --rounds 5 \
  --markers off \
  --output renderer-markers-off.json
```

Interpret the four measurements as:

```text
old marker cost    = before-on − before-off
new marker cost    = after-on  − after-off
unrelated variance = after-off − before-off
```

`before-off` and `after-off` should be close. A substantial difference means the compared repository states contain another performance-relevant change.

## Repeatability

- Keep the viewport, CPU throttle, run count, warm-up count, and round count identical.
- Close DevTools and unrelated applications.
- Keep the machine plugged in and avoid interaction during the run.
- Prefer at least five alternating rounds; the script reverses target order every round to reduce ordering and thermal bias.
- Compare medians first. Inspect the emitted JSON when distributions or p90 values matter.

Run `npm run benchmark:renderer -- --help` for every option.
