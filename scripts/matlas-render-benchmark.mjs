#!/usr/bin/env node
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';

const require = createRequire(`${process.cwd()}/package.json`);
const puppeteer = require('puppeteer');

function usage(exitCode = 0) {
  console.log(`Usage:
  node scripts/matlas-render-benchmark.mjs \\
    --target before=http://127.0.0.1:4173 \\
    --target after=http://127.0.0.1:4174 \\
    [--runs 10] [--warmup 3] [--rounds 3] [--cpu 4] \\
    [--markers on|off] [--duration 700] [--selection-duration 120] \\
    [--viewport 1720x911] \\
    [--output benchmark.json]

The script benchmarks interaction-sensitive workloads:
  node-switch  Repeated node-to-node selection changes.
  node-clear   Repeated node selection and background deselection.
  edge-switch  Repeated edge-to-edge selection changes.
  layout       Repeated Layered <-> Compact animated layout changes.
  pan          Repeated animated viewport pans as a control case.

Run both builds from local HTTP servers. The benchmark fixes preferences to:
  Animate graph = on, Refit on change = off, Transitions = off,
  High resolution = off, Motion blur = off. Marker visibility is controlled
  explicitly by --markers (default: on).

Options:
  --target LABEL=URL       Repeat for each build to compare.
  --runs N                 Measured actions per scenario and round (default 10).
  --warmup N               Warm-up actions per scenario (default 3).
  --rounds N               Alternating target rounds (default 3).
  --cpu N                  Chrome CPU throttle factor (default 4; use 1 for native speed).
  --markers on|off         Force secondary-domain markers on or off (default on).
  --duration MS            Layout/pan measurement window per action (default 700 ms).
  --selection-duration MS  Selection measurement window per action (default 120 ms).
  --viewport WIDTHxHEIGHT  Fixed viewport (default 1720x911).
  --device-scale-factor N  Fixed DPR (default 1).
  --headed                 Show Chrome instead of headless mode.
  --output FILE            Write raw and summarized JSON.
  --help                   Show this help.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    targets: [],
    runs: 10,
    warmup: 3,
    rounds: 3,
    cpu: 4,
    markers: true,
    duration: 700,
    selectionDuration: 120,
    viewport: { width: 1720, height: 911 },
    deviceScaleFactor: 1,
    headed: false,
    output: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    if (arg === '--help' || arg === '-h') usage(0);
    else if (arg === '--target') {
      const value = next();
      const separator = value.indexOf('=');
      if (separator <= 0) throw new Error(`Invalid --target ${value}; expected LABEL=URL`);
      options.targets.push({ label: value.slice(0, separator), url: value.slice(separator + 1) });
    } else if (arg === '--runs') options.runs = Number(next());
    else if (arg === '--warmup') options.warmup = Number(next());
    else if (arg === '--rounds') options.rounds = Number(next());
    else if (arg === '--cpu') options.cpu = Number(next());
    else if (arg === '--markers') {
      const value = next();
      if (value !== 'on' && value !== 'off') throw new Error('--markers must be on or off');
      options.markers = value === 'on';
    } else if (arg === '--duration') options.duration = Number(next());
    else if (arg === '--selection-duration') options.selectionDuration = Number(next());
    else if (arg === '--device-scale-factor') options.deviceScaleFactor = Number(next());
    else if (arg === '--viewport') {
      const match = next().match(/^(\d+)x(\d+)$/i);
      if (!match) throw new Error('Invalid --viewport; expected WIDTHxHEIGHT');
      options.viewport = { width: Number(match[1]), height: Number(match[2]) };
    } else if (arg === '--headed') options.headed = true;
    else if (arg === '--output') options.output = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const key of ['runs', 'warmup', 'rounds', 'cpu', 'duration', 'selectionDuration', 'deviceScaleFactor']) {
    if (!Number.isFinite(options[key]) || options[key] < (key === 'warmup' ? 0 : 1)) {
      throw new Error(`Invalid --${key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    }
  }
  if (options.targets.length < 1) throw new Error('At least one --target LABEL=URL is required');
  return options;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarizeRuns(runs) {
  const numericKeys = Object.keys(runs[0] ?? {}).filter((key) => typeof runs[0][key] === 'number');
  return Object.fromEntries(numericKeys.map((key) => [key, {
    median: median(runs.map((run) => run[key])),
    p90: percentile(runs.map((run) => run[key]), 90)
  }]));
}

function metricMap(response) {
  return Object.fromEntries(response.metrics.map(({ name, value }) => [name, value]));
}

function deltaMs(before, after, name) {
  return ((after[name] ?? 0) - (before[name] ?? 0)) * 1000;
}

function frameStats(intervals, elapsedMs) {
  const usable = intervals.filter((value) => value > 0 && value < 1000);
  const missedFrames = usable.reduce((total, value) => total + Math.max(0, Math.round(value / 16.667) - 1), 0);
  return {
    elapsedMs,
    frameCount: usable.length,
    effectiveFps: elapsedMs > 0 ? usable.length * 1000 / elapsedMs : 0,
    frameP95Ms: percentile(usable, 95),
    frameMaxMs: Math.max(0, ...usable),
    framesOver16_7: usable.filter((value) => value > 16.7).length,
    framesOver33_3: usable.filter((value) => value > 33.3).length,
    estimatedMissedFrames: missedFrames
  };
}

async function preparePage(page, url, markers) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.evaluate((markersEnabled) => {
    localStorage.setItem('human-knowledge-atlas:preferences:v1', JSON.stringify({
      version: 1,
      highResolution: false,
      transitions: false,
      animateGraph: true,
      refitOnChange: false,
      motionBlur: false,
      indicateOtherDomains: markersEnabled,
      hideEdgesWhileMoving: true,
      allowNodeMovement: false,
      dimPrerequisites: true,
      highlightPrerequisites: false,
      experimentalFeatures: false
    }));
    localStorage.setItem('human-knowledge-atlas:views-welcome-dismissed:v1', '1');
  }, markers);
  await page.reload({ waitUntil: 'networkidle0', timeout: 60_000 });
  await page.waitForFunction((markersEnabled) => {
    const cy = window.cy;
    const layoutSelect = document.getElementById('layoutSelect');
    const markerToggle = document.getElementById('indicateOtherDomainsToggle');
    return Boolean(cy)
      && !document.body.classList.contains('atlas-loading')
      && layoutSelect instanceof HTMLSelectElement
      && markerToggle instanceof HTMLInputElement
      && markerToggle.checked === markersEnabled;
  }, { timeout: 60_000 }, markers);
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function pageInventory(page, client) {
  await client.send('HeapProfiler.collectGarbage');
  const [heap, domCounters, inventory] = await Promise.all([
    client.send('Runtime.getHeapUsage'),
    client.send('Memory.getDOMCounters'),
    page.evaluate(() => {
      const cy = window.cy;
      let nativeMarkerNodes = 0;
      let visibleNativeMarkerNodes = 0;
      if (cy) {
        cy.nodes().forEach((node) => {
          const image = node.style('background-image');
          const text = Array.isArray(image) ? image.join(',') : String(image ?? '');
          if (text && text !== 'none' && text.includes('data:image/svg+xml')) {
            nativeMarkerNodes += 1;
            if (!node.hasClass('secondary-domain-markers-hidden')) visibleNativeMarkerNodes += 1;
          }
        });
      }
      return {
        documentElements: document.querySelectorAll('*').length,
        markerContainers: document.querySelectorAll('.graph-domain-markers').length,
        markerDots: document.querySelectorAll('.graph-domain-markers span').length,
        markerCanvases: document.querySelectorAll('.graph-domain-marker-canvas').length,
        storyBadges: document.querySelectorAll('.graph-sequence-badge').length,
        cytoscapeNodes: cy?.nodes().length ?? 0,
        cytoscapeEdges: cy?.edges().length ?? 0,
        multiDomainNodes: cy?.nodes('[multiDomain = 1]').length ?? 0,
        nativeMarkerNodes,
        visibleNativeMarkerNodes,
        markersEnabled: (() => {
          try {
            const raw = localStorage.getItem('human-knowledge-atlas:preferences:v1');
            return raw ? JSON.parse(raw).indicateOtherDomains === true : null;
          } catch {
            return null;
          }
        })()
      };
    })
  ]);
  return {
    ...inventory,
    heapUsedMiB: heap.usedSize / 1024 / 1024,
    heapAllocatedMiB: heap.totalSize / 1024 / 1024,
    domCounterNodes: domCounters.nodes,
    eventListeners: domCounters.jsEventListeners,
    documents: domCounters.documents
  };
}

async function runMeasuredAction(page, client, { scenario, target, duration }) {
  const before = metricMap(await client.send('Performance.getMetrics'));
  const result = await page.evaluate(async ({ scenarioName, actionTarget, windowMs }) => {
    const intervals = [];
    const longTasks = [];
    let lastFrame = null;
    let sampling = true;
    let observer = null;
    if ('PerformanceObserver' in window) {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
      } catch {
        observer = null;
      }
    }
    const sample = (time) => {
      if (lastFrame != null) intervals.push(time - lastFrame);
      lastFrame = time;
      if (sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const started = performance.now();
    const cy = window.cy;
    if (!cy) throw new Error('window.cy is unavailable');
    let syncActionMs = 0;
    if (scenarioName === 'layout') {
      const select = document.getElementById('layoutSelect');
      if (!(select instanceof HTMLSelectElement)) throw new Error('#layoutSelect is unavailable');
      const actionStarted = performance.now();
      select.value = actionTarget;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncActionMs = performance.now() - actionStarted;
    } else if (scenarioName === 'pan') {
      const current = cy.pan();
      const actionStarted = performance.now();
      const animation = cy.animation({
        pan: { x: current.x + actionTarget, y: current.y },
        duration: 500,
        easing: 'linear'
      });
      animation.play();
      syncActionMs = performance.now() - actionStarted;
    } else if (scenarioName === 'node-switch' || scenarioName === 'node-clear') {
      const candidates = cy.nodes('[kind = "structure"]').not('.filter-hidden')
        .sort((a, b) => b.connectedEdges().not('.filter-hidden').length - a.connectedEdges().not('.filter-hidden').length);
      if (candidates.empty()) throw new Error('No visible concept nodes are available');
      const node = candidates[actionTarget % candidates.length];
      const actionStarted = performance.now();
      node.emit('tap');
      syncActionMs = performance.now() - actionStarted;
      if (scenarioName === 'node-clear') {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const clearStarted = performance.now();
        cy.emit('tap');
        syncActionMs += performance.now() - clearStarted;
      }
    } else if (scenarioName === 'edge-switch') {
      const candidates = cy.edges().not('.filter-hidden')
        .filter((edge) => Number(edge.data('semanticConnection')) !== 1);
      if (candidates.empty()) throw new Error('No visible concept edges are available');
      const edge = candidates[actionTarget % candidates.length];
      const actionStarted = performance.now();
      edge.emit('tap');
      syncActionMs = performance.now() - actionStarted;
    } else {
      throw new Error(`Unknown scenario: ${scenarioName}`);
    }
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    const elapsedMs = performance.now() - started;
    sampling = false;
    observer?.disconnect();
    return {
      intervals,
      elapsedMs,
      longTaskCount: longTasks.length,
      longTaskMs: longTasks.reduce((sum, value) => sum + value, 0),
      longTaskMaxMs: Math.max(0, ...longTasks),
      syncActionMs
    };
  }, { scenarioName: scenario, actionTarget: target, windowMs: duration });
  const after = metricMap(await client.send('Performance.getMetrics'));
  return {
    ...frameStats(result.intervals, result.elapsedMs),
    longTaskCount: result.longTaskCount,
    longTaskMs: result.longTaskMs,
    longTaskMaxMs: result.longTaskMaxMs,
    syncActionMs: result.syncActionMs,
    taskMs: deltaMs(before, after, 'TaskDuration'),
    scriptMs: deltaMs(before, after, 'ScriptDuration'),
    styleMs: deltaMs(before, after, 'RecalcStyleDuration'),
    layoutMs: deltaMs(before, after, 'LayoutDuration'),
    styleCount: (after.RecalcStyleCount ?? 0) - (before.RecalcStyleCount ?? 0),
    layoutCount: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0)
  };
}

async function warmup(page, scenario, count, duration) {
  for (let i = 0; i < count; i += 1) {
    const target = scenario === 'layout'
      ? (i % 2 === 0 ? 'breadthfirst' : 'atlas')
      : scenario === 'pan' ? (i % 2 === 0 ? 240 : -240) : i;
    await runMeasuredAction(page, { send: async () => ({ metrics: [] }) }, { scenario, target, duration });
  }
}

async function benchmarkTarget(target, options) {
  const launchArgs = (process.env.MATLAS_CHROMIUM_ARGS ?? '').split(/\s+/).filter(Boolean);
  const browser = await puppeteer.launch({
    headless: options.headed ? false : 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: launchArgs
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ ...options.viewport, deviceScaleFactor: options.deviceScaleFactor });
    const client = await page.createCDPSession();
    await client.send('Performance.enable');
    await client.send('Emulation.setCPUThrottlingRate', { rate: options.cpu });
    await preparePage(page, target.url, options.markers);
    const inventory = await pageInventory(page, client);
    const scenarios = {};
    for (const scenario of ['node-switch', 'node-clear', 'edge-switch', 'layout', 'pan']) {
      const duration = scenario === 'layout' || scenario === 'pan' ? options.duration : options.selectionDuration;
      await warmup(page, scenario, options.warmup, duration);
      const runs = [];
      for (let i = 0; i < options.runs; i += 1) {
        const actionTarget = scenario === 'layout'
          ? (i % 2 === 0 ? 'breadthfirst' : 'atlas')
          : scenario === 'pan' ? (i % 2 === 0 ? 240 : -240) : i;
        runs.push(await runMeasuredAction(page, client, {
          scenario,
          target: actionTarget,
          duration
        }));
      }
      scenarios[scenario] = { runs, summary: summarizeRuns(runs) };
    }
    return { label: target.label, url: target.url, inventory, scenarios };
  } finally {
    await browser.close();
  }
}

function formatNumber(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

function pctChange(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null;
  return ((after - before) / before) * 100;
}

function printInventory(results) {
  const keys = [
    ['documentElements', 'DOM elements', 0],
    ['domCounterNodes', 'DOM counter nodes', 0],
    ['markerContainers', 'Marker containers', 0],
    ['markerDots', 'Marker dot elements', 0],
    ['markerCanvases', 'Marker canvases', 0],
    ['nativeMarkerNodes', 'Native marker nodes', 0],
    ['visibleNativeMarkerNodes', 'Visible native markers', 0],
    ['heapUsedMiB', 'Used JS heap MiB', 2],
    ['eventListeners', 'Event listeners', 0]
  ];
  console.log('\nStatic inventory after GC');
  for (const [key, label, digits] of keys) {
    const values = results.map((result) => result.inventory[key]);
    const comparison = results.length === 2 ? pctChange(values[0], values[1]) : null;
    console.log(`${label.padEnd(24)} ${results.map((result, index) => `${result.label}=${formatNumber(values[index], digits)}`).join('  ')}${comparison == null ? '' : `  change=${comparison >= 0 ? '+' : ''}${formatNumber(comparison, 1)}%`}`);
  }
}

function printScenario(results, scenario) {
  const metrics = [
    ['syncActionMs', 'Synchronous handler ms', false],
    ['taskMs', 'Main-thread task ms', false],
    ['scriptMs', 'Script ms', false],
    ['styleMs', 'Style recalc ms', false],
    ['layoutMs', 'DOM layout ms', false],
    ['effectiveFps', 'Effective FPS', true],
    ['frameP95Ms', 'Frame p95 ms', false],
    ['frameMaxMs', 'Worst frame ms', false],
    ['framesOver33_3', 'Frames >33.3 ms', false],
    ['estimatedMissedFrames', 'Estimated missed frames', false],
    ['longTaskMs', 'Long-task total ms', false]
  ];
  const titles = {
    'node-switch': 'Node-to-node selection',
    'node-clear': 'Node selection + background deselection',
    'edge-switch': 'Edge-to-edge selection',
    layout: 'Layered <-> Compact layout animation',
    pan: 'Animated viewport pan control'
  };
  console.log(`\n${titles[scenario] ?? scenario} (median per action)`);
  for (const [key, label, higherIsBetter] of metrics) {
    const values = results.map((result) => result.scenarios[scenario].summary[key]?.median ?? 0);
    const comparison = results.length === 2 ? pctChange(values[0], values[1]) : null;
    const assessment = comparison == null ? '' : higherIsBetter ? -comparison : comparison;
    const suffix = comparison == null ? '' : `  raw=${comparison >= 0 ? '+' : ''}${formatNumber(comparison, 1)}%  ${assessment < 0 ? 'better' : assessment > 0 ? 'worse' : 'same'}`;
    console.log(`${label.padEnd(24)} ${results.map((result, index) => `${result.label}=${formatNumber(values[index], 2)}`).join('  ')}${suffix}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage(1);
  }
  console.log(`mAtlas renderer benchmark: ${options.rounds} round(s), ${options.runs} measured actions/scenario/round, CPU ${options.cpu}x, markers ${options.markers ? 'on' : 'off'}, viewport ${options.viewport.width}x${options.viewport.height}@${options.deviceScaleFactor}`);
  const collected = new Map(options.targets.map((target) => [target.label, []]));
  for (let round = 0; round < options.rounds; round += 1) {
    const order = round % 2 === 0 ? options.targets : [...options.targets].reverse();
    console.log(`\nRound ${round + 1}/${options.rounds}: ${order.map((target) => target.label).join(' -> ')}`);
    for (const target of order) {
      console.log(`  Benchmarking ${target.label} at ${target.url}`);
      collected.get(target.label).push(await benchmarkTarget(target, options));
    }
  }
  const results = options.targets.map((target) => {
    const rounds = collected.get(target.label);
    const inventoryKeys = Object.keys(rounds[0].inventory);
    const inventory = Object.fromEntries(inventoryKeys.map((key) => [key, median(rounds.map((round) => round.inventory[key]))]));
    const scenarios = {};
    for (const scenario of ['node-switch', 'node-clear', 'edge-switch', 'layout', 'pan']) {
      const runs = rounds.flatMap((round) => round.scenarios[scenario].runs);
      scenarios[scenario] = { runs, summary: summarizeRuns(runs) };
    }
    return { label: target.label, url: target.url, inventory, scenarios, rounds };
  });
  printInventory(results);
  printScenario(results, 'node-switch');
  printScenario(results, 'node-clear');
  printScenario(results, 'edge-switch');
  printScenario(results, 'layout');
  printScenario(results, 'pan');
  console.log('\nInterpretation: selection synchronous-handler and main-thread metrics are primary for interaction changes. Pan verifies viewport responsiveness, layout verifies no large regression, and idle CPU must be checked separately. Prefer medians across several alternating rounds.');
  const report = {
    generatedAt: new Date().toISOString(),
    options: { ...options, targets: options.targets },
    results
  };
  if (options.output) {
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`\nWrote ${options.output}`);
  }
}

await main();
