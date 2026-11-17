// big-pickle final forecast revision.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR || "/input";
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || "/output";
const Z_VALUES = [-1.645, -0.674, 0, 0.674, 1.645];
const CURVE_PRIOR = [
  0,
  1,
  1.08,
  1.16,
  1.24,
  1.31,
  1.37,
  1.42,
  1.46,
  1.48,
  1.47,
  1.44,
  1.4,
  1.35,
  1.3,
  1.26,
  1.23,
  1.21,
  1.21,
  1.24,
  1.28,
  1.31,
  1.33,
  1.3,
  1.25,
];
const SERIES_KEYS = [
  "history_hourly",
  "historyHourly",
  "hourly_history",
  "hourlyHistory",
  "viewer_history",
  "viewerHistory",
  "ccu_history",
  "ccuHistory",
  "observed_hourly",
  "observedHourly",
  "observed",
  "history",
  "hourly",
  "timeline",
  "series",
  "hours",
  "data",
];
const COMPARABLE_KEYS = [
  "comparables",
  "comps",
  "comparison_cases",
  "comparisonCases",
  "reference_cases",
  "referenceCases",
  "similar_cases",
  "similarCases",
  "peer_cases",
  "peerCases",
  "analogs",
  "analogues",
  "references",
  "refs",
];
const VALUE_KEYS = [
  "viewers",
  "ccu",
  "viewer_count",
  "viewerCount",
  "concurrent_viewers",
  "concurrentViewers",
  "current_viewers",
  "currentViewers",
  "median_viewers",
  "medianViewers",
  "median_ccu",
  "medianCcu",
  "average_viewers",
  "averageViewers",
  "avg_viewers",
  "avgViewers",
  "mean",
  "median",
  "value",
  "count",
  "p50",
  "q50",
  "y",
  "val",
  "v",
];
const P_KEYS = [
  "hour1_viewers",
  "hour_1_viewers",
  "hour1Viewers",
  "hour_1",
  "hour1",
  "first_hour_viewers",
  "firstHourViewers",
  "known_viewers",
  "knownViewers",
  "initial_viewers",
  "initialViewers",
  "starting_viewers",
  "startingViewers",
  "base_viewers",
  "baseViewers",
  "current_viewers",
  "currentViewers",
  "concurrent_viewers",
  "concurrentViewers",
  "viewer_count",
  "viewerCount",
  "viewers",
  "ccu",
  "value",
  "count",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toFinite(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function quantileValue(value) {
  if (Array.isArray(value)) {
    const numbers = value
      .map(toFinite)
      .filter((item) => item !== undefined && item > 0)
      .sort((a, b) => a - b);
    if (numbers.length === 0) {
      return undefined;
    }
    return numbers[Math.floor(numbers.length / 2)];
  }
  if (isObject(value)) {
    for (const key of ["median", "value", "q50", "p50"]) {
      const parsed = toFinite(value[key]);
      if (parsed !== undefined && parsed > 0) {
        return parsed;
      }
    }
    const numbers = Object.values(value)
      .map(toFinite)
      .filter((item) => item !== undefined && item > 0)
      .sort((a, b) => a - b);
    if (numbers.length > 0) {
      return numbers[Math.floor(numbers.length / 2)];
    }
  }
  return undefined;
}

function rowValue(record) {
  for (const key of VALUE_KEYS) {
    if (key in record) {
      const parsed = toFinite(record[key]);
      if (parsed !== undefined && parsed > 0) {
        return parsed;
      }
    }
  }
  const fromQuantiles = quantileValue(record.q);
  if (fromQuantiles !== undefined && fromQuantiles > 0) {
    return fromQuantiles;
  }
  return undefined;
}

function rowHour(record) {
  for (const key of ["hour", "h", "hour_index", "hourIndex", "hour_number", "hourNumber"]) {
    if (key in record) {
      const parsed = toFinite(record[key]);
      if (parsed !== undefined) {
        const rounded = Math.round(parsed);
        if (rounded >= 1 && rounded <= 24) {
          return rounded;
        }
        if (rounded === 0) {
          return 1;
        }
      }
    }
  }
  for (const key of ["idx", "index"]) {
    if (key in record) {
      const parsed = toFinite(record[key]);
      if (parsed !== undefined) {
        const rounded = Math.round(parsed);
        if (rounded >= 0 && rounded <= 23) {
          return rounded + 1;
        }
      }
    }
  }
  return undefined;
}

function addPoint(series, hour, value) {
  if (
    Number.isFinite(hour) &&
    hour >= 1 &&
    hour <= 24 &&
    Number.isFinite(value) &&
    value > 0
  ) {
    series.set(hour, value);
  }
}

function seriesFrom(value) {
  const result = [];
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return result;
    }
    if (value.every((item) => toFinite(item) !== undefined)) {
      const series = new Map();
      value.forEach((item, index) => {
        addPoint(series, index + 1, toFinite(item));
      });
      if (series.size > 0) {
        result.push(series);
      }
      return result;
    }
    if (value.every((item) => Array.isArray(item))) {
      const series = new Map();
      value.forEach((item, index) => {
        const parsed = quantileValue(item);
        if (parsed !== undefined) {
          addPoint(series, index + 1, parsed);
        }
      });
      if (series.size > 0) {
        result.push(series);
      }
      return result;
    }
    const series = new Map();
    for (const item of value) {
      if (!isObject(item)) {
        continue;
      }
      const hour = rowHour(item);
      const parsed = rowValue(item);
      if (hour !== undefined && parsed !== undefined) {
        addPoint(series, hour, parsed);
      }
    }
    if (series.size > 0) {
      result.push(series);
    }
    return result;
  }
  if (isObject(value)) {
    const series = new Map();
    for (const key of Object.keys(value)) {
      const match = /^(?:hour|h)?[_-]?(\d{1,2})$/i.exec(key.trim());
      if (!match) {
        continue;
      }
      const hour = Number(match[1]);
      const raw = value[key];
      let parsed;
      if (isObject(raw)) {
        parsed = rowValue(raw);
      } else if (Array.isArray(raw)) {
        parsed = quantileValue(raw);
      } else {
        parsed = toFinite(raw);
      }
      if (parsed !== undefined) {
        addPoint(series, hour, parsed);
      }
    }
    if (series.size > 0) {
      result.push(series);
    }
  }
  return result;
}

function collectCaseSeries(record, out) {
  for (const key of SERIES_KEYS) {
    if (record[key] !== undefined) {
      const parsed = seriesFrom(record[key]);
      for (const series of parsed) {
        out.push(series);
      }
    }
  }
}

function collectComparableValue(value, out) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return;
    }
    if (value.every((item) => toFinite(item) !== undefined)) {
      const parsed = seriesFrom(value);
      for (const series of parsed) {
        out.push(series);
      }
      return;
    }
    if (
      value.every(
        (item) =>
          isObject(item) &&
          rowHour(item) !== undefined &&
          rowValue(item) !== undefined,
      )
    ) {
      const parsed = seriesFrom(value);
      for (const series of parsed) {
        out.push(series);
      }
      return;
    }
    for (const item of value) {
      if (isObject(item)) {
        const before = out.length;
        collectCaseSeries(item, out);
        if (out.length === before) {
          const parsed = seriesFrom(item);
          for (const series of parsed) {
            out.push(series);
          }
        }
        if (isObject(item.case)) {
          collectCaseSeries(item.case, out);
        }
      } else {
        const parsed = seriesFrom(item);
        for (const series of parsed) {
          out.push(series);
        }
      }
    }
    return;
  }
  if (isObject(value)) {
    const before = out.length;
    collectCaseSeries(value, out);
    if (out.length > before) {
      return;
    }
    const direct = seriesFrom(value);
    if (direct.length > 0) {
      for (const series of direct) {
        out.push(series);
      }
      return;
    }
    for (const item of Object.values(value)) {
      if (isObject(item)) {
        const itemBefore = out.length;
        collectCaseSeries(item, out);
        if (out.length === itemBefore) {
          const parsed = seriesFrom(item);
          for (const series of parsed) {
            out.push(series);
          }
        }
      } else {
        const parsed = seriesFrom(item);
        for (const series of parsed) {
          out.push(series);
        }
      }
    }
  }
}

function firstPositive(values) {
  for (const value of values) {
    let parsed;
    if (Array.isArray(value)) {
      parsed = quantileValue(value);
    } else if (isObject(value)) {
      parsed = rowValue(value);
    } else {
      parsed = toFinite(value);
    }
    if (parsed !== undefined && Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function firstString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function addRatioSamples(series, baseline, samples) {
  if (baseline === undefined || !Number.isFinite(baseline) || baseline <= 0) {
    return;
  }
  for (let hour = 2; hour <= 24; hour += 1) {
    const observed = series.get(hour);
    if (observed === undefined || observed <= 0) {
      continue;
    }
    const ratio = observed / baseline;
    if (!Number.isFinite(ratio) || ratio <= 0) {
      continue;
    }
    const logRatio = Math.max(-3, Math.min(3, Math.log(ratio)));
    const bucket = samples.get(hour);
    if (bucket === undefined) {
      samples.set(hour, [logRatio]);
    } else {
      bucket.push(logRatio);
    }
  }
}

function clampQuantile(value) {
  let result = Number.isFinite(value) ? Math.round(value) : 1;
  if (result < 1) {
    result = 1;
  }
  if (result > 1000000000) {
    result = 1000000000;
  }
  return result;
}

function safeId(value) {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+$/, "_")
    .trim();
  return cleaned.length > 0 ? cleaned : "case";
}

function forecastFor(data, fallbackId) {
  const root = isObject(data) ? data : {};
  const nestedCase = isObject(root.case) ? root.case : undefined;
  const caseRecord = nestedCase ?? root;
  const id =
    firstString([
      caseRecord.id,
      root.id,
      caseRecord.case_id,
      root.case_id,
      caseRecord.caseId,
      root.caseId,
      caseRecord.name,
      root.name,
    ]) ?? fallbackId;

  const currentSeries = [];
  collectCaseSeries(caseRecord, currentSeries);
  if (nestedCase !== undefined) {
    collectCaseSeries(root, currentSeries);
  }

  const comparableSeries = [];
  for (const key of COMPARABLE_KEYS) {
    if (root[key] !== undefined) {
      collectComparableValue(root[key], comparableSeries);
    }
    if (nestedCase !== undefined && caseRecord[key] !== undefined) {
      collectComparableValue(caseRecord[key], comparableSeries);
    }
  }

  const pKeys = [];
  for (const key of P_KEYS) {
    pKeys.push(caseRecord[key]);
  }
  for (const key of P_KEYS) {
    pKeys.push(root[key]);
  }
  for (const series of currentSeries) {
    pKeys.push(series.get(1));
  }
  for (const series of comparableSeries) {
    pKeys.push(series.get(1));
  }
  const p = Math.max(1, firstPositive(pKeys) ?? 1);

  const samples = new Map();
  for (const series of currentSeries) {
    addRatioSamples(series, p, samples);
  }
  for (const series of comparableSeries) {
    addRatioSamples(series, series.get(1), samples);
  }

  const deviations = new Array(25);
  for (let hour = 2; hour <= 24; hour += 1) {
    const bucket = samples.get(hour);
    if (bucket === undefined || bucket.length === 0) {
      continue;
    }
    const sorted = bucket.slice().sort((a, b) => a - b);
    const medianLog = sorted[Math.floor((sorted.length - 1) / 2)];
    const priorLog = Math.log(CURVE_PRIOR[hour]);
    const weight = bucket.length / (bucket.length + 2);
    deviations[hour] = weight * (medianLog - priorLog);
  }

  const logRatios = new Array(25).fill(0);
  for (let hour = 2; hour <= 24; hour += 1) {
    let deviation = deviations[hour];
    if (deviation === undefined) {
      let previous = -1;
      let next = -1;
      for (let index = hour - 1; index >= 2; index -= 1) {
        if (deviations[index] !== undefined) {
          previous = index;
          break;
        }
      }
      for (let index = hour + 1; index <= 24; index += 1) {
        if (deviations[index] !== undefined) {
          next = index;
          break;
        }
      }
      const previousDeviation = previous >= 0 ? deviations[previous] : undefined;
      const nextDeviation = next >= 0 ? deviations[next] : undefined;
      if (previousDeviation !== undefined && nextDeviation !== undefined) {
        deviation =
          previousDeviation +
          ((nextDeviation - previousDeviation) * (hour - previous)) /
            (next - previous);
      } else if (previousDeviation !== undefined) {
        deviation = previousDeviation;
      } else if (nextDeviation !== undefined) {
        deviation = nextDeviation;
      } else {
        deviation = 0;
      }
    }
    logRatios[hour] = Math.max(
      -3.5,
      Math.min(3.5, Math.log(CURVE_PRIOR[hour]) + deviation),
    );
  }

  const hours = [];
  for (let hour = 2; hour <= 24; hour += 1) {
    const median = Math.max(1e-9, p * Math.exp(logRatios[hour]));
    const sigma = Math.min(0.85, 0.12 + 0.045 * Math.sqrt(hour - 1));
    const q = Z_VALUES.map((z) => clampQuantile(median * Math.exp(z * sigma)));
    for (let index = 1; index < q.length; index += 1) {
      if (q[index] < q[index - 1]) {
        q[index] = q[index - 1];
      }
    }
    hours.push({ hour, q });
  }

  return { id, output: { hours } };
}

function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const names = readdirSync(INPUT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".in"))
    .map((entry) => entry.name)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const name of names) {
    const fallbackId = name.replace(/\.in$/i, "");
    let data = {};
    try {
      data = JSON.parse(readFileSync(path.join(INPUT_DIR, name), "utf8"));
    } catch {
      data = {};
    }
    const forecast = forecastFor(data, fallbackId);
    writeFileSync(
      path.join(OUTPUT_DIR, `${safeId(forecast.id)}.out`),
      JSON.stringify(forecast.output),
    );
  }
}

main();
