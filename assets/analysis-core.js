/* Pure numerical contracts, shared by the atlas and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WDAnalysis = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const DAY = 86400000;
  function quantile(values, p) {
    if (!values.length) return null;
    const x = (values.length - 1) * p, i = Math.floor(x);
    return values[i] + (values[Math.min(i + 1, values.length - 1)] - values[i]) * (x - i);
  }
  function firstPeak(times, values) {
    let best = -Infinity, result = null;
    values.forEach((v, i) => { if (v != null && Number.isFinite(v) && v > best) { best = v; result = times[i]; } });
    return result;
  }
  function periods(start, end) {
    const result = [];
    let d = new Date(start), a = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    while (a <= end) {
      d = new Date(a);
      const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      result.push({year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, start: Math.max(start, a), end: Math.min(end, b), fullStart: a, fullEnd: b});
      a = b;
    }
    return result;
  }
  function monthMask(start, end) {
    return periods(start, end).reduce((mask, p) => mask | (1 << (p.month - 1)), 0);
  }
  function annual(records, selection, coverage) {
    const start = Math.max(selection.start, coverage.start), end = Math.min(selection.end, coverage.end);
    if (end <= start || !selection.months.size) return [];
    const bins = new Map();
    for (const p of periods(start, end - 1)) {
      if (!selection.months.has(p.month)) continue;
      if (!bins.has(p.year)) bins.set(p.year, {year: p.year, count: 0, days: 0, systemDays: 0, fullDays: 0, periods: []});
      const row = bins.get(p.year), stop = Math.min(end, p.fullEnd);
      row.days += (stop - p.start) / DAY;
      row.periods.push([p.start, stop]);
    }
    for (const row of bins.values()) {
      for (const month of selection.months) row.fullDays += (Date.UTC(row.year, month, 1) - Date.UTC(row.year, month - 1, 1)) / DAY;
      row.complete = Math.abs(row.days - row.fullDays) < 1e-8;
    }
    for (const record of records) {
      for (const row of bins.values()) {
        let included = false;
        for (const [a, b] of row.periods) {
          row.systemDays += Math.max(0, Math.min(record.end, b) - Math.max(record.start, a)) / DAY;
          if (selection.mode === 'active' ? record.end >= a && record.start < b : record.anchor != null && record.anchor >= a && record.anchor < b) included = true;
        }
        if (included) row.count++;
      }
    }
    const rows = [...bins.values()];
    for (const row of rows) row.rate = row.days ? row.count * 100 / row.days : null;
    for (let i = 0; i < rows.length; i++) {
      const window = rows.slice(Math.max(0, i - 5), i + 6);
      for (const key of ['count', 'rate', 'systemDays']) rowMean(rows[i], window, key);
    }
    return rows;
  }
  function rowMean(row, window, key) {
    row[key + 'Mean'] = window.length === 11 && window.every((r, i) => r.complete && r.year === row.year - 5 + i) ? window.reduce((sum, r) => sum + r[key], 0) / 11 : null;
  }
  function box(values) {
    const sorted = values.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    return {n: sorted.length, low: quantile(sorted, .05), q1: quantile(sorted, .25), median: quantile(sorted, .5), q3: quantile(sorted, .75), high: quantile(sorted, .95)};
  }
  return {quantile, firstPeak, periods, monthMask, annual, box};
});
