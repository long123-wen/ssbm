#!/usr/bin/env node
/**
 * Reproducible load-test harness for the rope-jump registration API.
 *
 * Safety defaults:
 *   - No URL means offline synthetic mode; no network and no database writes.
 *   - --url means two smoke probes only: one GET and one non-mutating POST.
 *   - --write is required before the optional single registration write probe.
 *   - Authentication is read from an explicitly named environment variable and
 *     is never printed.
 *
 * Run from the project root:
 *   node scripts/rope-jump-load-test.mjs
 */

const DEFAULTS = Object.freeze({
  operations: 2400,
  concurrency: 50,
  seed: 'rope-jump-load-v1',
  timeoutMs: 5000,
  getPath: '/api/auth/session',
  postPath: '/api/auth/session',
  writePath: '/api/club/registrations',
});

const MIN_OPERATIONS = 2000;
const MAX_OPERATIONS = 3000;
const MAX_CONCURRENCY = 500;
const USER_AGENT = 'rope-jump-registration-load-test/1.0';

class UsageError extends Error {}

function printHelp() {
  console.log(`Reproducible rope-jump registration load-test harness

Modes:
  Offline (default)  Generate a synthetic request plan and report virtual
                     throughput/latency. No network, auth, or writes.
  Target (--url)     Run one GET and one safe POST smoke probe only.
                     Add --write to enable one explicit registration write probe.

Offline options:
  --operations N     Synthetic operations, ${MIN_OPERATIONS}-${MAX_OPERATIONS} (default ${DEFAULTS.operations})
  --concurrency N    Virtual workers, 1-${MAX_CONCURRENCY} (default ${DEFAULTS.concurrency})
  --seed VALUE       Stable plan seed (default ${DEFAULTS.seed})

Target options:
  --url URL          Explicit http(s) target; the only option that enables network
  --get-path PATH    Read-only GET path (default ${DEFAULTS.getPath})
  --post-path PATH   POST smoke path (default ${DEFAULTS.postPath}); defaults to a non-mutating method probe
  --timeout-ms N     Per-probe timeout, 500-60000 (default ${DEFAULTS.timeoutMs})
  --cookie-env NAME  Read an existing Cookie header from this environment variable

Explicit write probe (target mode only; one POST, no cleanup/delete is performed):
  --write            Allow the single write probe; never enabled by default
  --write-path PATH  Write endpoint (default ${DEFAULTS.writePath})
  --competition-id ID
  --event-id ID
  --group-id ID
  --athlete-ids ID[,ID...]
  --team-profile-id ID   Optional team profile ID
  --cookie-env NAME      Required with --write; value is never printed

Output:
  --json              Emit one JSON report instead of formatted text
  --help              Show this help

Examples:
  node scripts/rope-jump-load-test.mjs
  node scripts/rope-jump-load-test.mjs --operations 3000 --concurrency 100 --seed ci-2026-06
  node scripts/rope-jump-load-test.mjs --url http://127.0.0.1:8788
  LOAD_TEST_COOKIE='session=...' node scripts/rope-jump-load-test.mjs \\
    --url https://example.invalid --write --cookie-env LOAD_TEST_COOKIE \\
    --competition-id comp_123 --event-id event_123 --group-id group_123 \\
    --athlete-ids athlete_123
`);
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new UsageError(`${flag} requires a value`);
  return value;
}

function integer(value, flag, min, max) {
  if (!/^[0-9]+$/.test(String(value))) throw new UsageError(`${flag} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new UsageError(`${flag} must be between ${min} and ${max}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    ...DEFAULTS,
    url: null,
    cookieEnv: null,
    write: false,
    json: false,
    competitionId: null,
    eventId: null,
    groupId: null,
    athleteIds: [],
    teamProfileId: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--write':
        options.write = true;
        break;
      case '--url':
        options.url = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--operations':
        options.operations = integer(requireValue(argv, index, flag), flag, MIN_OPERATIONS, MAX_OPERATIONS);
        index += 1;
        break;
      case '--concurrency':
        options.concurrency = integer(requireValue(argv, index, flag), flag, 1, MAX_CONCURRENCY);
        index += 1;
        break;
      case '--seed':
        options.seed = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--timeout-ms':
        options.timeoutMs = integer(requireValue(argv, index, flag), flag, 500, 60000);
        index += 1;
        break;
      case '--get-path':
        options.getPath = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--post-path':
        options.postPath = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--write-path':
        options.writePath = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--cookie-env':
        options.cookieEnv = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--competition-id':
        options.competitionId = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--event-id':
        options.eventId = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--group-id':
        options.groupId = requireValue(argv, index, flag);
        index += 1;
        break;
      case '--athlete-ids':
        options.athleteIds = requireValue(argv, index, flag)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
        index += 1;
        break;
      case '--team-profile-id':
        options.teamProfileId = requireValue(argv, index, flag);
        index += 1;
        break;
      default:
        throw new UsageError(`Unknown option: ${flag}`);
    }
  }

  if (options.help) return options;
  if (options.write && !options.url) throw new UsageError('--write requires --url');
  if (options.url) {
    let parsed;
    try {
      parsed = new URL(options.url);
    } catch {
      throw new UsageError('--url must be a valid http(s) URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new UsageError('--url must use http or https');
    options.url = parsed;
  }
  if (options.write) {
    const required = [
      ['--cookie-env', options.cookieEnv],
      ['--competition-id', options.competitionId],
      ['--event-id', options.eventId],
      ['--group-id', options.groupId],
      ['--athlete-ids', options.athleteIds.length ? options.athleteIds.join(',') : null],
    ];
    const missing = required.filter(([, value]) => !value).map(([flag]) => flag);
    if (missing.length) throw new UsageError(`--write requires: ${missing.join(', ')}`);
    if (options.athleteIds.length > 50) throw new UsageError('--athlete-ids supports at most 50 IDs');
  }
  return options;
}

function hashSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRng(seed) {
  let state = hashSeed(seed) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function syntheticId(prefix, index) {
  return `synthetic-${prefix}-${String(index + 1).padStart(4, '0')}`;
}

function chooseWeighted(rng, templates) {
  const total = templates.reduce((sum, item) => sum + item.weight, 0);
  let cursor = rng() * total;
  for (const item of templates) {
    cursor -= item.weight;
    if (cursor < 0) return item;
  }
  return templates[templates.length - 1];
}

const OPERATION_TEMPLATES = Object.freeze([
  { kind: 'admin-registration-list', method: 'GET', path: '/api/admin/registrations', weight: 20, baseMs: 10, spreadMs: 12 },
  { kind: 'order-book-read', method: 'GET', path: '/api/admin/order-books/current', weight: 10, baseMs: 8, spreadMs: 10 },
  { kind: 'individual-status-query', method: 'POST', path: '/api/individual/status-query', weight: 15, baseMs: 12, spreadMs: 18 },
  { kind: 'individual-registration-create', method: 'POST', path: '/api/individual/registrations', weight: 20, baseMs: 22, spreadMs: 28 },
  { kind: 'club-registration-create', method: 'POST', path: '/api/club/registrations', weight: 25, baseMs: 28, spreadMs: 36 },
  { kind: 'admin-registration-review', method: 'POST', path: '/api/admin/registrations/review', weight: 10, baseMs: 18, spreadMs: 25 },
]);

function buildSyntheticPlan(options) {
  const rng = makeRng(options.seed);
  const teams = Array.from({ length: 100 }, (_, index) => ({
    id: syntheticId('team', index),
    name: `Synthetic Team ${String(index + 1).padStart(3, '0')}`,
  }));
  const athletes = Array.from({ length: 1000 }, (_, index) => ({
    id: syntheticId('athlete', index),
    teamId: teams[index % teams.length].id,
    name: `Synthetic Athlete ${String(index + 1).padStart(4, '0')}`,
    gender: index % 2 === 0 ? 'male' : 'female',
    birthDate: `201${index % 6}-0${(index % 9) + 1}-15`,
  }));

  const operations = Array.from({ length: options.operations }, (_, index) => {
    const template = chooseWeighted(rng, OPERATION_TEMPLATES);
    const athlete = athletes[index % athletes.length];
    const team = teams[index % teams.length];
    const jitter = Math.round(rng() * template.spreadMs);
    const tail = rng() < 0.02 ? 35 + Math.round(rng() * 90) : 0;
    return {
      sequence: index + 1,
      kind: template.kind,
      method: template.method,
      path: `${template.path}?synthetic=1&sequence=${index + 1}`,
      teamId: team.id,
      athleteId: athlete.id,
      latencyMs: template.baseMs + jitter + tail,
    };
  });

  return { teams, athletes, operations };
}

function planDigest(operations) {
  let hash = 2166136261;
  for (const operation of operations) {
    const line = `${operation.sequence}|${operation.kind}|${operation.teamId}|${operation.athleteId}|${operation.latencyMs}\n`;
    for (const char of line) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)];
}

function runSynthetic(options) {
  const plan = buildSyntheticPlan(options);
  const workerAvailableAt = Array.from({ length: options.concurrency }, () => 0);
  const latencies = [];
  const counts = {};
  let makespanMs = 0;

  for (const operation of plan.operations) {
    let workerIndex = 0;
    for (let index = 1; index < workerAvailableAt.length; index += 1) {
      if (workerAvailableAt[index] < workerAvailableAt[workerIndex]) workerIndex = index;
    }
    const startMs = workerAvailableAt[workerIndex];
    const endMs = startMs + operation.latencyMs;
    workerAvailableAt[workerIndex] = endMs;
    makespanMs = Math.max(makespanMs, endMs);
    latencies.push(operation.latencyMs);
    counts[operation.kind] = (counts[operation.kind] || 0) + 1;
  }

  return {
    mode: 'offline-synthetic',
    seed: options.seed,
    entities: { teams: plan.teams.length, athletes: plan.athletes.length },
    operations: options.operations,
    concurrency: options.concurrency,
    planDigest: planDigest(plan.operations),
    simulated: {
      makespanMs,
      throughputPerSecond: Number((options.operations / (makespanMs / 1000)).toFixed(2)),
      latencyMs: {
        min: Math.min(...latencies),
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: Math.max(...latencies),
      },
    },
    operationsByKind: counts,
    safety: 'No network requests, authentication, filesystem output, or remote mutations were performed.',
  };
}

function targetUrl(baseUrl, path) {
  if (!path.startsWith('/')) throw new UsageError(`Path must start with /: ${path}`);
  return new URL(path, baseUrl).toString();
}

function safeCookie(options) {
  if (!options.cookieEnv) return undefined;
  const cookie = process.env[options.cookieEnv];
  if (!cookie) throw new UsageError(`Environment variable ${options.cookieEnv} is empty or unset`);
  return cookie;
}

function writePayload(options) {
  return {
    competitionId: options.competitionId,
    eventId: options.eventId,
    groupId: options.groupId,
    athleteIds: options.athleteIds,
    ...(options.teamProfileId ? { teamProfileId: options.teamProfileId } : {}),
  };
}

async function timedRequest({ baseUrl, path, method, body, cookie, timeoutMs, headers = {} }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(targetUrl(baseUrl, path), {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Consume the body so the connection can be reused, but never print it.
    await response.text();
    return {
      method,
      path,
      status: response.status,
      ok: response.ok,
      latencyMs: Number((performance.now() - startedAt).toFixed(2)),
    };
  } catch (error) {
    return {
      method,
      path,
      status: null,
      ok: false,
      latencyMs: Number((performance.now() - startedAt).toFixed(2)),
      error: error?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runTarget(options) {
  const cookie = safeCookie(options);
  const probes = [];
  probes.push(await timedRequest({
    baseUrl: options.url,
    path: options.getPath,
    method: 'GET',
    cookie,
    timeoutMs: options.timeoutMs,
  }));
  probes.push(await timedRequest({
    baseUrl: options.url,
    path: options.postPath,
    method: 'POST',
    body: {},
    cookie,
    timeoutMs: options.timeoutMs,
  }));

  if (options.write) {
    probes.push(await timedRequest({
      baseUrl: options.url,
      path: options.writePath,
      method: 'POST',
      body: writePayload(options),
      cookie,
      timeoutMs: options.timeoutMs,
      headers: { 'Idempotency-Key': `rope-jump-load-test-${options.seed}` },
    }));
  }

  return {
    mode: 'target-smoke',
    target: options.url.origin,
    probes,
    safety: options.write
      ? 'One explicit write probe was allowed by --write; no delete or cleanup operation was performed.'
      : 'Only one GET and one non-mutating POST method smoke probe were attempted; no write probe was enabled.',
  };
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('=== Rope-jump registration load test ===');
  console.log(`Mode: ${report.mode}`);
  if (report.mode === 'offline-synthetic') {
    console.log(`Entities: ${report.entities.teams} teams, ${report.entities.athletes} athletes`);
    console.log(`Plan: ${report.operations} operations, concurrency ${report.concurrency}, seed ${report.seed}`);
    console.log(`Plan digest: ${report.planDigest}`);
    console.log(`Virtual makespan: ${report.simulated.makespanMs} ms`);
    console.log(`Virtual throughput: ${report.simulated.throughputPerSecond} operations/sec`);
    console.log(`Latency ms: min ${report.simulated.latencyMs.min}, p50 ${report.simulated.latencyMs.p50}, p95 ${report.simulated.latencyMs.p95}, p99 ${report.simulated.latencyMs.p99}, max ${report.simulated.latencyMs.max}`);
    console.log('Operations by kind:');
    for (const [kind, count] of Object.entries(report.operationsByKind).sort(([left], [right]) => left.localeCompare(right))) {
      console.log(`  - ${kind}: ${count}`);
    }
  } else {
    console.log(`Target: ${report.target}`);
    console.log('Smoke probes:');
    for (const probe of report.probes) {
      const status = probe.status === null ? 'network-error' : String(probe.status);
      const suffix = probe.error ? ` (${probe.error})` : '';
      console.log(`  - ${probe.method} ${probe.path}: ${status}, ${probe.latencyMs} ms${suffix}`);
    }
  }
  console.log(`Safety: ${report.safety}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const report = options.url ? await runTarget(options) : runSynthetic(options);
  printReport(report, options.json);
}

main().catch(error => {
  if (error instanceof UsageError) {
    console.error(`Error: ${error.message}`);
    console.error('Run with --help for usage.');
    process.exitCode = 2;
    return;
  }
  console.error(`Fatal error: ${error?.message || error}`);
  process.exitCode = 1;
});
