window.WDReanalyses = (() => {
  let asset = null, promise = null, choice = 'none', failure = '';
  const colours = {imdaa: '#08736f', erainterim: '#76558f'};
  function setup(api) {
    const host = document.querySelector('#wdMapHeading').parentElement;
    host.insertAdjacentHTML('beforeend', '<label class="mla-field"><span class="mla-label">Matched reanalysis</span><select class="mla-select" id="wdReanalysis"><option value="none">ERA5 only</option><option value="imdaa">+ IMDAA (legacy T42)</option><option value="erainterim">+ ERA-Interim (legacy T63)</option><option value="all">Compare both</option></select></label>');
    document.querySelector('#wdMapDescription').insertAdjacentHTML('afterend', '<p id="wdReanalysisStatus" class="mla-chart-readout" role="status"></p>');
    const select = document.querySelector('#wdReanalysis'), requested = new URLSearchParams(location.search).get('reanalysis');
    if (['none', 'imdaa', 'erainterim', 'all'].includes(requested)) choice = requested;
    select.value = choice;
    select.addEventListener('change', () => { choice = select.value; const url = new URL(location.href); url.searchParams.set('reanalysis', choice); history.replaceState(null, '', url); api.drawMap(); });
  }
  function draw(api) {
    const status = document.querySelector('#wdReanalysisStatus'); if (!status) return;
    if (choice === 'none') { status.textContent = ''; return; }
    if (api.selected < 0) { status.textContent = 'Select a WD to compare matched reanalysis tracks.'; return; }
    if (!asset) {
      status.textContent = failure || 'Loading matched reanalysis tracks…';
      if (!promise && !failure) promise = api.fetchInflated('assets/wd-reanalysis-matches-v1.json.gz').then(buffer => {
        const value = JSON.parse(new TextDecoder().decode(buffer));
        if (value.schema !== 'wd-reanalysis-matches-v1' || value.track_ids.length !== api.meta.ntracks || value.track_ids.some((id, i) => id !== api.cat.id[i])) throw new Error('Reanalysis asset does not match WD v6');
        asset = value;
        Object.values(asset.sources).forEach(source => source.lookup = new Map(source.matches.map(m => [m.era5_track_id, m])));
        api.drawMap();
      }).catch(error => { failure = `Matched reanalyses unavailable: ${error.message}`; status.textContent = failure; });
      return;
    }
    const notes = [], ctx = api.map.overlayContext;
    for (const [key, source] of Object.entries(asset.sources)) {
      if (choice !== 'all' && choice !== key) continue;
      const match = source.lookup.get(api.cat.id[api.selected]);
      if (!match) { notes.push(`${source.label}: no unambiguous match`); continue; }
      const points = source.tracks[match.source_track_id];
      ctx.save(); ctx.strokeStyle = colours[key]; ctx.lineWidth = 2.5; ctx.setLineDash(key === 'imdaa' ? [7, 3] : [2, 4]); ctx.beginPath();
      points.forEach((p, i) => { const x = api.projectX(p[1]), y = api.projectY(p[2]); if (!i || Math.abs(p[1] - points[i - 1][1]) > 180) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke(); ctx.restore();
      notes.push(`${source.label} ${source.truncation}: ${match.median_distance_km.toFixed(0)} km median separation, ${match.overlap_hours} h overlap`);
    }
    status.textContent = notes.join(' · ') + '. Legacy methods differ from v6; no match is not evidence that the WD was absent.';
  }
  return {setup, draw};
})();
