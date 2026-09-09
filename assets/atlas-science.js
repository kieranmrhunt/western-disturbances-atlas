/* Source-backed catalogue comparisons. No independent filter state. */
window.createWDScience = function (api) {
  'use strict';
  const $ = s => document.querySelector(s), A = window.WDAnalysis, esc = api.escapeHtml;
  const blue = '#233f78', grey = '#686868';
  let reference = null, referenceDescription = '', referenceSnapshot = null, serial = 0, scatterHits = [], scatterRows = [];
  const referenceCache = new Map();
  const chart = (id, title, body = '') => `<section class="mla-card mla-chart-card"><h3>${title}</h3>${body}<canvas class="mla-chart" id="${id}" role="img" tabindex="0" aria-label="${title}"></canvas><p class="mla-chart-readout" id="${id}Status"></p><details class="mla-a11y-data"><summary>Accessible data</summary><div id="${id}Data"></div></details></section>`;
  function field(id, label, options) { return `<label class="mla-field"><span class="mla-label">${label}</span><select class="mla-select" id="${id}">${options}</select></label>`; }
  function parameter(name, value) {
    const url = new URL(location.href);
    if (value == null) url.searchParams.delete(name); else url.searchParams.set(name, value);
    history.replaceState(null, '', url);
    api.scheduleUrlUpdate();
  }
  function initialise() {
    window.WDReanalyses?.setup(api);
    const annualCard = $('#wdAnnualChart').closest('section');
    annualCard.querySelector('h3').textContent = 'Annual WD activity';
    annualCard.querySelector('p').id = 'wdAnnualStatus';
    annualCard.insertAdjacentHTML('afterbegin', field('wdAnnualMeasure', 'Measure', '<option value="count">Systems</option><option value="rate">Systems per 100 selected days</option><option value="systemDays">WD-days</option>'));
    $('#wdAnnualMeasure').addEventListener('change', () => { parameter('annualMeasure', $('#wdAnnualMeasure').value); drawAnnual(); });
    $('#wdPanelClimatology .mla-panel-heading p').textContent = 'Frequency, movement and circulation in the filtered catalogue.';
    $('#wdMonthChart').closest('section').querySelector('p').textContent = 'Shared month definition; a WD active across months can contribute to each.';
    $('#wdPanelClimatology .mla-chart-grid').insertAdjacentHTML('beforeend',
      chart('wdPathwayChart', 'Genesis-to-lysis pathways', field('wdPathwayMeasure', 'Display', '<option value="share">Share of each genesis group</option><option value="count">Systems</option>')) +
      chart('wdClimateComposition', 'Climate-state composition', field('wdClimateCompositionIndex', 'Index at genesis', '<option value="nao">NAO</option><option value="ao">AO</option><option value="oni">ENSO</option><option value="pna">PNA</option><option value="mjo">MJO</option>') + '<p>Subset (filled) · all WDs in the same time/month selection (outline).</p>'));
    $('#wdPathwayMeasure').addEventListener('change', drawPathways);
    $('#wdClimateCompositionIndex').addEventListener('change', drawClimate);
    const profileCard = $('#wdProfileCharts').closest('section.mla-card');
    profileCard.insertAdjacentHTML('afterbegin', '<div class="mla-toolbar"><button class="mla-btn mla-btn-small" id="wdPinReference" type="button">Pin subset as reference</button><button class="mla-btn mla-btn-small" id="wdClearReference" type="button" hidden>Use all WDs</button></div>');
    $('#wdPinReference').addEventListener('click', () => {
      if (!api.filtered.length) return;
      referenceSnapshot = api.snapshot();
      pin(api.filtered.slice(), referenceSnapshot);
      parameter('reference', JSON.stringify(referenceSnapshot));
    });
    $('#wdClearReference').addEventListener('click', () => { reference = null; referenceSnapshot = null; referenceDescription = ''; referenceCache.clear(); parameter('reference', null); updateReference(); api.drawProfileChart(); });
    const section = $('#wdPanelExtremes .mla-section-card');
    const options = $('#wdExtremeMetric').innerHTML;
    section.insertAdjacentHTML('beforeend', `<div class="mla-chart-grid wd-science-charts">${chart('wdExtremeHistogram', 'Diagnostic distribution')}${chart('wdExtremeBox', 'Distribution by group', field('wdExtremeGroup', 'Group', '<option value="genesis">Genesis region</option><option value="route">Route archetype</option>') + '<p>Median and IQR; whiskers: 5th–95th percentiles.</p>')}<section class="mla-card mla-chart-card mla-chart-wide"><h3>Diagnostic relationship</h3><div class="mla-toolbar">${field('wdScatterX', 'Horizontal', options)}${field('wdScatterY', 'Vertical', options)}<button type="button" class="mla-btn mla-btn-small" id="wdScatterExport">Export plotted points</button></div><canvas class="mla-chart wd-scatter-chart" id="wdScatter" tabindex="0" role="img" aria-label="Two event diagnostics; click a point to select a WD"></canvas><p id="wdScatterStatus" class="mla-chart-readout" role="status"></p><details class="mla-a11y-data"><summary>Accessible plotted systems</summary><div id="wdScatterData"></div></details></section></div>`);
    $('#wdScatterY').value = 'rain';
    // Keep diagnostic charts above the long ranked-system lookup table.
    section.insertBefore(section.querySelector('.wd-science-charts'),section.querySelector('.mla-table-wrap'));
    for (const id of ['wdScatterX', 'wdScatterY', 'wdExtremeGroup']) $('#' + id).addEventListener('change', drawExtremes);
    $('#wdExtremeMetric').addEventListener('change', () => parameter('extreme', $('#wdExtremeMetric').value));
    $('#wdScatter').addEventListener('pointermove', event => {
      const hit = hitScatter(event);
      $('#wdScatter').style.cursor = hit ? 'pointer' : 'default';
      if (hit) $('#wdScatterStatus').textContent = `${api.trackName(hit.index)} · ${api.formatExtreme(hit.index, $('#wdScatterX').value)} / ${api.formatExtreme(hit.index, $('#wdScatterY').value)}`;
    });
    $('#wdScatter').addEventListener('click', event => { const hit = hitScatter(event); if (hit) { api.selectTrack(hit.index, {fit: false}); api.switchTab('explore'); } });
    $('#wdScatterData').addEventListener('click', event => { const button = event.target.closest('[data-wd-index]'); if (button) { api.selectTrack(Number(button.dataset.wdIndex), {fit: false}); api.switchTab('explore'); } });
    $('#wdScatterExport').addEventListener('click', () => api.downloadBlob(api.csvText(['track_id', 'name', api.extremeLabel($('#wdScatterX').value), api.extremeLabel($('#wdScatterY').value)], scatterRows.map(row => [api.cat.id[row.index], api.trackName(row.index), row.x, row.y])), 'text/csv', 'wd-diagnostic-relationship.csv'));
    const params = new URLSearchParams(location.search);
    for (const [key, id] of [['annualMeasure', 'wdAnnualMeasure'], ['extreme', 'wdExtremeMetric'], ['scatterX', 'wdScatterX'], ['scatterY', 'wdScatterY']]) {
      if ([...$('#' + id).options].some(o => o.value === params.get(key))) $('#' + id).value = params.get(key);
    }
    if (params.has('reference')) {
      try { const snapshot = JSON.parse(params.get('reference')); if (snapshot && Array.isArray(snapshot.months) && typeof snapshot.climate === 'object') pin(api.indicesForSnapshot(snapshot), snapshot, false); } catch (_) { parameter('reference', null); }
    }
    updateReference();
  }
  function pin(indices, snapshot, redraw = true) {
    reference = indices; referenceSnapshot = snapshot; referenceCache.clear();
    const dates = snapshot.timeMode === 'dates' ? `${snapshot.dateMin}–${snapshot.dateMax}` : `${snapshot.yearMin}–${snapshot.yearMax}`;
    referenceDescription = `${indices.length.toLocaleString()} WDs · ${dates} · months ${snapshot.months.join(', ')}`;
    updateReference(); if (redraw) api.drawProfileChart();
  }
  function updateReference() {
    $('#wdClearReference').hidden = !reference;
    $('#wdPinReference').disabled = !api.filtered.length;
    $('#wdProfileCharts').closest('section.mla-card').querySelector('p').textContent = reference ? 'Solid: subset median · dashed: pinned median · coloured/grey bands: respective IQRs.' : 'Solid line: median · filled band: IQR · dashed line: all-WD median.';
  }
  function referenceProfile(metric) {
    if (!reference) return null;
    if (!referenceCache.has(metric)) referenceCache.set(metric, api.profileSummary(reference, metric));
    return referenceCache.get(metric);
  }
  function drawReferenceBand(ctx, rows, x, y) {
    ctx.save(); ctx.fillStyle = 'rgba(70,70,70,.13)';
    let run = [];
    function flush() {
      if (!run.length) return;
      ctx.beginPath(); run.forEach((i, j) => j ? ctx.lineTo(x(i), y(rows[i].q3)) : ctx.moveTo(x(i), y(rows[i].q3)));
      run.slice().reverse().forEach(i => ctx.lineTo(x(i), y(rows[i].q1))); ctx.closePath(); ctx.fill(); run = [];
    }
    rows.forEach((r, i) => { if (r.q1 != null && r.q3 != null) run.push(i); else flush(); }); flush(); ctx.restore();
  }
  function drawAnnual() {
    const c = api.prepareCanvas($('#wdAnnualChart')); if (!c) return;
    const context = api.filterContext(), mode = api.state.monthMode;
    const rows = A.annual(api.filtered.map(i => ({start: api.genesisMillis(i), end: api.lysisMillis(i), anchor: api.timeAnchor(i)})),
      {start: context.minimumActive, end: context.maximumActive + 1, months: api.state.months, mode}, {start: Date.UTC(1950, 0, 1), end: Date.UTC(2026, 0, 1)});
    if (!rows.length) { api.drawEmptyChart(c.context, c.width, c.height, 'No selected calendar exposure.'); $('#wdAnnualData').innerHTML = ''; return; }
    const key = $('#wdAnnualMeasure').value, label = $('#wdAnnualMeasure').selectedOptions[0].textContent;
    const max = Math.max(1, ...rows.map(r => r[key])) * 1.1;
    const p = api.chartFrame(c.context, c.width, c.height, {left: 60, right: 20, top: 20, bottom: 42, yMax: max, yLabel: label, xLabel: 'Calendar year'});
    const x = i => p.left + (i + .5) * p.width / rows.length, y = v => p.bottom - v / max * p.height;
    c.context.fillStyle = blue;
    rows.forEach((r, i) => { c.context.globalAlpha = r.complete ? .7 : .35; c.context.fillRect(p.left + i * p.width / rows.length, y(r[key]), Math.max(1, p.width / rows.length - 1), p.bottom - y(r[key])); }); c.context.globalAlpha = 1;
    api.drawLineSeries(c.context, rows.map(r => r[key + 'Mean']), x, y, '#111111', false, p);
    c.context.font = '11px effra, Arial, sans-serif'; c.context.fillStyle = grey; c.context.textAlign = 'center';
    rows.forEach((r, i) => { if (i % Math.max(1, Math.ceil(rows.length / 10)) === 0) c.context.fillText(r.year, x(i), p.bottom + 17); });
    $('#wdAnnualStatus').textContent = `${label}; ${rows.reduce((s, r) => s + r.days, 0).toLocaleString()} selected days. Counts use ${mode==='active'?'active overlap':mode==='genesis'?'genesis':mode==='peakIntensity'?'peak-vorticity':'peak-precipitation'} dates within each interval. Black line: centred 11-year mean of complete years. Pale bars: partial years. WD-days sum elapsed lifetimes; simultaneous WDs count separately.`;
    $('#wdAnnualData').innerHTML = api.accessibleTable(['Year', 'Systems', 'Selected days', 'Systems / 100 days', 'WD-days', 'Complete selected months'], rows.map(r => [r.year, r.count, r.days.toFixed(2), r.rate.toFixed(3), r.systemDays.toFixed(2), r.complete ? 'Yes' : 'No']));
  }
  function drawPathways() {
    const c = api.prepareCanvas($('#wdPathwayChart')); if (!c) return;
    const counts = api.genesisDefinitions.map(() => api.lysisDefinitions.map(() => 0));
    api.filtered.forEach(i => counts[api.genesisGroups[i]][api.lysisGroups[i]]++);
    const mode = $('#wdPathwayMeasure').value, left = Math.min(132, c.width * .34), top = 32, w = (c.width - left - 10) / 4, h = (c.height - top - 30) / counts.length;
    const maximum = mode === 'share' ? 100 : Math.max(1, ...counts.flat());
    c.context.font = '11px effra, Arial, sans-serif'; c.context.textBaseline = 'middle';
    const table = [];
    counts.forEach((row, g) => {
      const n = row.reduce((a, b) => a + b, 0);
      c.context.textAlign = 'right'; c.context.fillStyle = grey; c.context.fillText(api.genesisDefinitions[g].label, left - 7, top + (g + .5) * h);
      row.forEach((count, l) => {
        const share = n ? count * 100 / n : null, value = mode === 'share' ? share : count;
        c.context.fillStyle = value == null ? '#eeeeee' : `rgba(35,63,120,${.07 + .83 * value / maximum})`;
        c.context.fillRect(left + l * w + 1, top + g * h + 1, w - 2, h - 2);
        c.context.fillStyle = value != null && value / maximum > .6 ? '#ffffff' : '#242424'; c.context.textAlign = 'center';
        c.context.fillText(value == null ? '—' : mode === 'share' ? `${value.toFixed(0)}%` : value.toLocaleString(), left + (l + .5) * w, top + (g + .5) * h);
        table.push([api.genesisDefinitions[g].longLabel, api.lysisDefinitions[l].label, count, share == null ? '—' : share.toFixed(2)]);
      });
    });
    c.context.fillStyle = grey; c.context.textAlign = 'center';
    ['<60°E', '60–70°E', '70–80°E', '≥80°E'].forEach((label, i) => c.context.fillText(label, left + (i + .5) * w, 15));
    $('#wdPathwayChartStatus').textContent = `${api.filtered.length.toLocaleString()} WDs · rows: genesis; columns: lysis.`;
    $('#wdPathwayChartData').innerHTML = api.accessibleTable(['Genesis', 'Lysis', 'Systems', 'Row share (%)'], table);
  }
  function drawClimate() {
    const c = api.prepareCanvas($('#wdClimateComposition')); if (!c) return;
    if (!api.climate) { api.drawEmptyChart(c.context, c.width, c.height, 'Climate indices unavailable.'); return; }
    const key = $('#wdClimateCompositionIndex').value, mjo = key === 'mjo', values = mjo ? api.climate.mjo_phase : api.climate.categories[key];
    const groups = mjo ? [0, 1, 2, 3, 4, 5, 6, 7, 8, -9] : [-1, 0, 1, -9];
    const labels = mjo ? ['Weak', ...Array.from({length: 8}, (_, i) => `Phase ${i + 1}`), 'Unavailable'] : [key === 'oni' ? 'La Niña' : 'Negative', 'Neutral', key === 'oni' ? 'El Niño' : 'Positive', 'Unavailable'];
    const context = api.filterContext(), baseline = Array.from({length: api.meta.ntracks}, (_, i) => i).filter(i => api.matchesTimeWindow(i, context) && api.trackMonths(i, context).some(m => api.state.months.has(m)));
    const counts = indices => groups.map(group => indices.filter(i => (groups.includes(values[i]) ? values[i] : -9) === group).length);
    const a = counts(api.filtered), b = counts(baseline), left = 82, right = c.width - 20, row = (c.height - 22) / groups.length;
    const table = [];
    c.context.font = '11px effra, Arial, sans-serif';
    groups.forEach((group, i) => {
      const av = api.filtered.length ? a[i] * 100 / api.filtered.length : 0, bv = baseline.length ? b[i] * 100 / baseline.length : 0;
      const y = 7 + i * row; c.context.textAlign = 'right'; c.context.fillStyle = grey; c.context.fillText(labels[i], left - 6, y + row / 2);
      c.context.fillStyle = blue; c.context.fillRect(left, y, av / 100 * (right - left), row * .32);
      c.context.strokeStyle = grey; c.context.lineWidth = 1; c.context.strokeRect(left, y + row * .4, bv / 100 * (right - left), row * .32);
      c.context.textAlign = 'left'; c.context.fillStyle = '#222'; c.context.fillText(`${av.toFixed(0)} / ${bv.toFixed(0)}%`, Math.min(right - 56, left + Math.max(av, bv) / 100 * (right - left) + 4), y + row * .5);
      table.push([labels[i], a[i], av.toFixed(2), b[i], bv.toFixed(2)]);
    });
    $('#wdClimateCompositionStatus').textContent = `${api.filtered.length.toLocaleString()} subset WDs; ${baseline.length.toLocaleString()} time/month-matched reference WDs. Unavailable indices remain in the denominator.`;
    $('#wdClimateCompositionData').innerHTML = api.accessibleTable(['State', 'Subset n', 'Subset %', 'Reference n', 'Reference %'], table);
  }
  async function ready(keys) {
    await Promise.all([...new Set(keys)].filter(k => k.startsWith('diag:')).map(k => api.loadDiagnostic(k.slice(5))));
  }
  async function drawExtremes() {
    const request = ++serial, metric = $('#wdExtremeMetric').value, xMetric = $('#wdScatterX').value, yMetric = $('#wdScatterY').value;
    scatterHits = []; scatterRows = [];
    for(const id of ['wdExtremeHistogram','wdExtremeBox','wdScatter']){const c=api.prepareCanvas($('#'+id));if(c)api.drawEmptyChart(c.context,c.width,c.height,'Loading selected diagnostics…');$('#'+id+'Status').textContent='Loading selected diagnostics…';$('#'+id+'Data').innerHTML='';}
    try { await ready([metric, xMetric, yMetric]); } catch (e) { if (request === serial) for (const id of ['wdExtremeHistogram', 'wdExtremeBox', 'wdScatter']) { const c = api.prepareCanvas($('#' + id)); if (c) api.drawEmptyChart(c.context, c.width, c.height, `Diagnostic unavailable: ${e.message}`); } return; }
    if (request !== serial) return;
    parameter('scatterX', xMetric); parameter('scatterY', yMetric);
    const rows = api.filtered.map(index => ({index, value: api.extremeValue(index, metric)})).filter(r => Number.isFinite(r.value));
    drawHistogram(rows, metric); drawBoxes(rows, metric); drawScatter(xMetric, yMetric);
  }
  function drawHistogram(rows, metric) {
    const c = api.prepareCanvas($('#wdExtremeHistogram')); if (!c) return;
    if (!rows.length) { api.drawEmptyChart(c.context, c.width, c.height, 'No finite diagnostic values in this subset.'); $('#wdExtremeHistogramData').innerHTML = ''; return; }
    const range = api.metricRange(rows.map(r => r.value), false), low = range.minimum, high = range.maximum, bins = Math.min(30, Math.max(5, Math.ceil(Math.sqrt(rows.length)))), step = (high - low) / bins;
    const counts = Array(bins).fill(0); rows.forEach(r => counts[Math.max(0, Math.min(bins - 1, Math.floor((r.value - low) / step)))]++);
    const p = api.chartFrame(c.context, c.width, c.height, {left: 48, right: 15, top: 20, bottom: 48, yMax: Math.max(...counts) * 1.1, yLabel: 'Systems', xLabel: api.extremeLabel(metric)});
    c.context.fillStyle = blue;
    counts.forEach((n, i) => c.context.fillRect(p.left + i / bins * p.width, p.bottom - n / p.yMax * p.height, Math.max(1, p.width / bins - 1), n / p.yMax * p.height));
    xLabels(c.context, p, low, high);
    const value = api.selected >= 0 ? api.extremeValue(api.selected, metric) : null;
    if (Number.isFinite(value) && value >= low && value <= high) { const x = p.left + (value - low) / (high - low) * p.width; c.context.strokeStyle = '#000'; c.context.lineWidth = 2; c.context.beginPath(); c.context.moveTo(x, p.top); c.context.lineTo(x, p.bottom); c.context.stroke(); }
    $('#wdExtremeHistogramStatus').textContent = `${rows.length.toLocaleString()} WDs with values; ${(api.filtered.length - rows.length).toLocaleString()} unavailable. Black marker: selected WD.`;
    $('#wdExtremeHistogramData').innerHTML = api.accessibleTable(['Bin start', 'Bin end', 'Systems'], counts.map((n, i) => [api.formatAxis(low + i * step), api.formatAxis(low + (i + 1) * step), n]));
  }
  function drawBoxes(rows, metric) {
    const c = api.prepareCanvas($('#wdExtremeBox')); if (!c) return;
    const route = $('#wdExtremeGroup').value === 'route', definitions = route ? api.routeDefinitions : api.genesisDefinitions, membership = route ? api.routes : api.genesisGroups;
    if (!membership || !rows.length) { api.drawEmptyChart(c.context, c.width, c.height, 'No finite grouped values.'); $('#wdExtremeBoxData').innerHTML = ''; return; }
    const boxes = definitions.map((d, g) => ({label: d.label, ...A.box(rows.filter(r => membership[r.index] === g).map(r => r.value))}));
    const range = api.metricRange(boxes.flatMap(b => [b.low, b.high]), false), left = Math.min(145, c.width * .38), top = 15, width = c.width - left - 22, h = (c.height - 58) / boxes.length;
    const x = v => left + (v - range.minimum) / (range.maximum - range.minimum) * width;
    c.context.font = '11px effra, Arial, sans-serif';
    boxes.forEach((b, i) => {
      const y = top + (i + .5) * h; c.context.fillStyle = grey; c.context.textAlign = 'right';
      const label = b.label.length > 24 ? b.label.slice(0, 22) + '…' : b.label;
      c.context.fillText(label, left - 7, y + 4);
      if (!b.n) return;
      c.context.strokeStyle = blue; c.context.lineWidth = 1; c.context.beginPath(); c.context.moveTo(x(b.low), y); c.context.lineTo(x(b.high), y); c.context.stroke();
      c.context.fillStyle = 'rgba(35,63,120,.2)'; c.context.fillRect(x(b.q1), y - 7, Math.max(1, x(b.q3) - x(b.q1)), 14); c.context.strokeRect(x(b.q1), y - 7, Math.max(1, x(b.q3) - x(b.q1)), 14);
      c.context.lineWidth = 2; c.context.beginPath(); c.context.moveTo(x(b.median), y - 7); c.context.lineTo(x(b.median), y + 7); c.context.stroke();
    });
    xLabels(c.context, {left, width, bottom: c.height - 42}, range.minimum, range.maximum);
    $('#wdExtremeBoxStatus').textContent = api.extremeLabel(metric);
    $('#wdExtremeBoxData').innerHTML = api.accessibleTable(['Group', 'Systems', 'P5', 'Q1', 'Median', 'Q3', 'P95'], boxes.map(b => [b.label, b.n, ...[b.low, b.q1, b.median, b.q3, b.high].map(v => v == null ? '—' : api.formatAxis(v))]));
  }
  function xLabels(ctx, p, low, high) {
    ctx.font = '11px effra, Arial, sans-serif'; ctx.fillStyle = grey; ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) ctx.fillText(api.formatAxis(low + (high - low) * i / 4), p.left + p.width * i / 4, p.bottom + 17);
  }
  function drawScatter(xMetric, yMetric) {
    const c = api.prepareCanvas($('#wdScatter')); if (!c) return;
    scatterHits = [];
    scatterRows = api.filtered.map(index => ({index, x: api.extremeValue(index, xMetric), y: api.extremeValue(index, yMetric)})).filter(r => Number.isFinite(r.x) && Number.isFinite(r.y));
    if (!scatterRows.length) { api.drawEmptyChart(c.context, c.width, c.height, 'No WDs with both diagnostics.'); $('#wdScatterData').innerHTML = ''; $('#wdScatterStatus').textContent = 'No finite pairs.'; return; }
    const xr = api.metricRange(scatterRows.map(r => r.x), false), yr = api.metricRange(scatterRows.map(r => r.y), false);
    const p = api.chartFrame(c.context, c.width, c.height, {left: 65, right: 20, top: 20, bottom: 50, yMin: yr.minimum, yMax: yr.maximum, yLabel: api.extremeLabel(yMetric), xLabel: api.extremeLabel(xMetric)});
    scatterHits = scatterRows.map(r => ({...r, px: p.left + (r.x - xr.minimum) / (xr.maximum - xr.minimum) * p.width, py: p.bottom - (r.y - yr.minimum) / (yr.maximum - yr.minimum) * p.height}));
    c.context.fillStyle = 'rgba(35,63,120,.27)';
    for (const r of scatterHits) { c.context.beginPath(); c.context.arc(r.px, r.py, 2.4, 0, 2 * Math.PI); c.context.fill(); }
    const chosen = scatterHits.find(r => r.index === api.selected);
    if (chosen) { c.context.strokeStyle = '#000'; c.context.lineWidth = 2; c.context.beginPath(); c.context.arc(chosen.px, chosen.py, 6, 0, Math.PI * 2); c.context.stroke(); }
    xLabels(c.context, p, xr.minimum, xr.maximum);
    $('#wdScatterStatus').textContent = `${scatterRows.length.toLocaleString()} WDs with both values; ${(api.filtered.length - scatterRows.length).toLocaleString()} excluded. Click a point to open it.`;
    $('#wdScatterData').innerHTML = '<p>First 200 plotted WDs; export includes every plotted point.</p>' + api.accessibleTable(['WD', api.extremeLabel(xMetric), api.extremeLabel(yMetric)], scatterRows.slice(0, 200).map(r => [api.trackName(r.index), api.formatExtreme(r.index, xMetric), api.formatExtreme(r.index, yMetric)]));
    $('#wdScatterData').querySelectorAll('tbody tr').forEach((tr, i) => { tr.cells[0].innerHTML = `<button type="button" class="mla-row-button" data-wd-index="${scatterRows[i].index}">${esc(api.trackName(scatterRows[i].index))}</button>`; });
  }
  function hitScatter(event) {
    const rect = $('#wdScatter').getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    let closest = null, distance = 100;
    for (const row of scatterHits) { const d = (x - row.px) ** 2 + (y - row.py) ** 2; if (d < distance) { closest = row; distance = d; } }
    return closest;
  }
  function drawClimatology() { drawPathways(); drawClimate(); }
  function render(tab) {
    updateReference();
    if (tab === 'forecast') window.WDForecast?.show(api);
    if (tab === 'climate-change') window.WDClimateChange?.show(api);
    if (tab === 'explore' || tab === 'climatology') window.WDComposites?.render(api, tab, reference);
  }
  return {initialise, render, drawClimatology, drawAnnual, drawExtremes, referenceProfile, hasReference: () => reference !== null, referenceLabel: () => referenceDescription, drawReferenceBand};
};
