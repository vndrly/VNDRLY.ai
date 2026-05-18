// Aggregate per-run output of the assistant language drift eval into
// a long-lived CSV history + a markdown trend report.
//
// Wired up from `.github/workflows/assistant-language-eval.yml`. The
// workflow:
//
//   1. Runs the eval, which writes a JSON summary to `--summary`.
//   2. Worktree-checks-out the orphan `assistant-language-eval-history`
//      branch into `--out`.
//   3. Runs this script to append rows + regenerate `TREND.md`.
//   4. Commits + pushes the worktree.
//
// Keeping the script side-effect-free at import time (no top-level
// I/O) makes it trivially testable from a Node REPL if we ever want
// to add unit coverage.
//
// Why a dedicated branch: nightly commits to `main` would create a
// flood of merge-base churn for unrelated PRs. The orphan branch
// holds *only* this dataset, so it's easy to browse and easy to
// nuke + rebuild from the workflow artifacts if the data is ever
// corrupted.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";

interface SummaryRow {
  prompt: string;
  role: string;
  language: "en" | "es";
  expected: "en" | "es";
  detected: "en" | "es" | "unknown" | null;
  pass: boolean;
  error?: string;
}

interface Summary {
  runAt: string;
  model?: string;
  results: SummaryRow[];
}

interface HistoryRow {
  runAt: string;
  runId: string;
  commit: string;
  prompt: string;
  role: string;
  language: string;
  expected: string;
  detected: string;
  pass: boolean;
}

const CSV_HEADER = [
  "run_at",
  "run_id",
  "commit",
  "prompt",
  "role",
  "language",
  "expected",
  "detected",
  "pass",
] as const;

// CSV escaping per RFC 4180: wrap in double quotes if the field
// contains a comma, double quote, or newline; double-up internal
// quotes. Prompts contain commas and apostrophes today and may
// contain quotes in the future, so we always escape defensively.
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsv(row: HistoryRow): string {
  return [
    row.runAt,
    row.runId,
    row.commit,
    row.prompt,
    row.role,
    row.language,
    row.expected,
    row.detected,
    row.pass ? "1" : "0",
  ]
    .map(csvEscape)
    .join(",");
}

// Minimal RFC-4180 CSV parser for our own output. We control both
// the writer and the reader so we don't need full-spec coverage —
// just enough to round-trip the fields we emit.
function parseCsv(text: string): HistoryRow[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      // Handle CRLF as a single break.
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the trailing field/row if the file doesn't end with a
  // newline — defensive against hand-edits.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  // Drop the header row.
  const dataRows = rows.slice(1).filter((r) => r.length >= CSV_HEADER.length);
  return dataRows.map((r) => ({
    runAt: r[0],
    runId: r[1],
    commit: r[2],
    prompt: r[3],
    role: r[4],
    language: r[5],
    expected: r[6],
    detected: r[7],
    pass: r[8] === "1",
  }));
}

function loadHistory(csvPath: string): HistoryRow[] {
  if (!existsSync(csvPath)) return [];
  const text = readFileSync(csvPath, "utf8");
  if (text.trim().length === 0) return [];
  return parseCsv(text);
}

function writeHistory(csvPath: string, rows: HistoryRow[]): void {
  mkdirSync(dirname(csvPath), { recursive: true });
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(rowToCsv(row));
  }
  // Trailing newline so successive appends produce clean diffs.
  writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function buildTrendReport(rows: HistoryRow[], generatedAt: Date): string {
  const cutoff = new Date(generatedAt.getTime() - 30 * 24 * 60 * 60 * 1000);
  const recent = rows.filter((r) => {
    const t = Date.parse(r.runAt);
    return Number.isFinite(t) && t >= cutoff.getTime();
  });

  // Index by prompt × language for the main table.
  type Cell = { passes: number; total: number };
  const byPromptLang = new Map<string, Map<string, Cell>>();
  // Preserve first-seen prompt order so the report is stable across
  // runs even if the CSV is sorted differently later.
  const promptOrder: string[] = [];
  const promptRole = new Map<string, string>();
  for (const r of recent) {
    if (!byPromptLang.has(r.prompt)) {
      byPromptLang.set(r.prompt, new Map());
      promptOrder.push(r.prompt);
      promptRole.set(r.prompt, r.role);
    }
    const langMap = byPromptLang.get(r.prompt)!;
    const cell = langMap.get(r.language) ?? { passes: 0, total: 0 };
    cell.total += 1;
    if (r.pass) cell.passes += 1;
    langMap.set(r.language, cell);
  }

  // Index by language alone for the per-language summary.
  const byLang = new Map<string, Cell>();
  for (const r of recent) {
    const cell = byLang.get(r.language) ?? { passes: 0, total: 0 };
    cell.total += 1;
    if (r.pass) cell.passes += 1;
    byLang.set(r.language, cell);
  }

  // Distinct nightly runs in the window — useful at-a-glance number.
  const distinctRuns = new Set(recent.map((r) => r.runId)).size;

  // Recent failures table (last 20 failures across all runs).
  const recentFailures = rows
    .filter((r) => !r.pass)
    .sort((a, b) => Date.parse(b.runAt) - Date.parse(a.runAt))
    .slice(0, 20);

  const lines: string[] = [];
  lines.push("# Assistant language eval — trend dashboard");
  lines.push("");
  lines.push(`_Last updated: ${generatedAt.toISOString()}_`);
  lines.push("");
  lines.push(
    "Generated by `scripts/src/aggregate-language-eval.ts`, invoked from " +
      "`.github/workflows/assistant-language-eval.yml` after every nightly " +
      "(and manual) run. The raw row-per-test data lives in `history.csv` " +
      "in the same directory.",
  );
  lines.push("");
  lines.push("## Trailing 30-day pass rate");
  lines.push("");
  lines.push(
    `Window: last 30 days (${cutoff.toISOString().slice(0, 10)} → ` +
      `${generatedAt.toISOString().slice(0, 10)}). ` +
      `${distinctRuns} distinct run(s) in window.`,
  );
  lines.push("");

  if (byLang.size > 0) {
    lines.push("### By language");
    lines.push("");
    lines.push("| Language | Passes | Runs | Pass rate |");
    lines.push("|---|---|---|---|");
    for (const lang of ["en", "es"] as const) {
      const cell = byLang.get(lang);
      if (!cell) continue;
      lines.push(
        `| ${lang} | ${cell.passes} | ${cell.total} | ${pct(
          cell.passes,
          cell.total,
        )} |`,
      );
    }
    lines.push("");
  }

  if (promptOrder.length > 0) {
    lines.push("### By prompt × language");
    lines.push("");
    lines.push(
      "Each cell is `passes / runs (rate)`. A streak of `0/N` for a single " +
        "prompt × language combination is the slow-burn drift this report " +
        "exists to surface.",
    );
    lines.push("");
    lines.push("| Prompt | Role | en | es |");
    lines.push("|---|---|---|---|");
    for (const prompt of promptOrder) {
      const role = promptRole.get(prompt) ?? "";
      const langMap = byPromptLang.get(prompt)!;
      const cells: string[] = [];
      for (const lang of ["en", "es"] as const) {
        const c = langMap.get(lang);
        cells.push(
          c ? `${c.passes}/${c.total} (${pct(c.passes, c.total)})` : "—",
        );
      }
      // Escape pipes that might appear in a prompt to avoid breaking
      // the markdown table layout.
      const safePrompt = prompt.replace(/\|/g, "\\|");
      lines.push(`| ${safePrompt} | ${role} | ${cells[0]} | ${cells[1]} |`);
    }
    lines.push("");
  } else {
    lines.push(
      "_No runs recorded in the trailing 30-day window yet._ The first " +
        "nightly run after this workflow lands will populate this section.",
    );
    lines.push("");
  }

  lines.push("## Recent failures (last 20)");
  lines.push("");
  if (recentFailures.length === 0) {
    lines.push("_No failures recorded._");
    lines.push("");
  } else {
    lines.push("| Run timestamp (UTC) | Prompt | Role | Lang | Detected | Run ID |");
    lines.push("|---|---|---|---|---|---|");
    for (const f of recentFailures) {
      const safePrompt = f.prompt.replace(/\|/g, "\\|");
      lines.push(
        `| ${f.runAt} | ${safePrompt} | ${f.role} | ${f.language} | ${f.detected} | ${f.runId} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Cumulative footprint");
  lines.push("");
  lines.push(`* Total rows in history: **${rows.length}**`);
  lines.push(
    `* Distinct runs recorded: **${new Set(rows.map((r) => r.runId)).size}**`,
  );
  if (rows.length > 0) {
    const sorted = rows
      .map((r) => Date.parse(r.runAt))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    if (sorted.length > 0) {
      lines.push(
        `* First recorded run: **${new Date(sorted[0]).toISOString()}**`,
      );
      lines.push(
        `* Most recent run: **${new Date(sorted[sorted.length - 1]).toISOString()}**`,
      );
    }
  }
  lines.push("");
  // When run from GitHub Actions we have GITHUB_SERVER_URL +
  // GITHUB_REPOSITORY in the environment, so we can produce a real
  // clickable link back to the docs on the default branch. Locally
  // this falls back to the bare path.
  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  const docsUrl =
    serverUrl && repo
      ? `${serverUrl}/${repo}/blob/HEAD/docs/assistant-language-eval.md`
      : "../../docs/assistant-language-eval.md";
  lines.push(`See [\`docs/assistant-language-eval.md\`](${docsUrl}) on the default branch for triage instructions.`);
  lines.push("");

  return lines.join("\n");
}

interface CliArgs {
  summary: string;
  out: string;
  runId: string;
  commit: string;
  runAt?: string;
}

function parseCli(argv: string[]): CliArgs {
  // pnpm forwards any user-supplied flags after `--`, which means
  // that literal `--` ends up as the first slice(2) element. Strip
  // it so parseArgs doesn't switch into positional-only mode.
  const cleaned = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args: cleaned,
    options: {
      summary: { type: "string" },
      out: { type: "string" },
      "run-id": { type: "string" },
      commit: { type: "string" },
      "run-at": { type: "string" },
    },
    strict: true,
  });
  if (!values.summary) {
    throw new Error("Missing --summary <path-to-eval-summary.json>");
  }
  if (!values.out) {
    throw new Error("Missing --out <history-output-dir>");
  }
  return {
    summary: resolve(values.summary),
    out: resolve(values.out),
    runId: values["run-id"] ?? "local",
    commit: values.commit ?? "local",
    runAt: values["run-at"],
  };
}

function main(): void {
  const args = parseCli(process.argv.slice(2));

  if (!existsSync(args.summary)) {
    // No summary means the eval suite never wrote one — most likely
    // it crashed before the first `it` block (e.g. the
    // ANTHROPIC_API_KEY guard). Treat that as a no-op rather than
    // a hard error: failing here would block the post-run commit and
    // we'd lose the chance to update TREND.md with a "no data" notice.
    console.warn(
      `[aggregate-language-eval] summary not found at ${args.summary}; ` +
        "regenerating TREND.md from existing history only.",
    );
  }

  const csvPath = resolve(args.out, "history.csv");
  const trendPath = resolve(args.out, "TREND.md");

  const existing = loadHistory(csvPath);

  let appended = 0;
  if (existsSync(args.summary)) {
    const summary = JSON.parse(readFileSync(args.summary, "utf8")) as Summary;
    const runAt = args.runAt ?? summary.runAt ?? new Date().toISOString();

    // Idempotency: if rows for this runId already exist (e.g. a
    // workflow re-run that re-uses the same GITHUB_RUN_ID), skip
    // append. This keeps the CSV append-only without duplicating
    // rows on a CI rerun.
    const alreadyRecorded = existing.some((r) => r.runId === args.runId);
    if (alreadyRecorded) {
      console.warn(
        `[aggregate-language-eval] run id ${args.runId} already in history; ` +
          "skipping append.",
      );
    } else {
      for (const r of summary.results) {
        existing.push({
          runAt,
          runId: args.runId,
          commit: args.commit,
          prompt: r.prompt,
          role: r.role,
          language: r.language,
          expected: r.expected,
          detected: r.detected ?? "unknown",
          pass: r.pass,
        });
        appended += 1;
      }
    }
  }

  writeHistory(csvPath, existing);
  writeFileSync(trendPath, buildTrendReport(existing, new Date()), "utf8");

  console.log(
    `[aggregate-language-eval] wrote ${existing.length} total rows ` +
      `(+${appended} from this run) to ${csvPath}`,
  );
  console.log(`[aggregate-language-eval] wrote trend report to ${trendPath}`);
}

main();
