/* Live upper-level WD guidance; deliberately separate from catalogue filters. */
window.WDForecast = (() => {
  'use strict';
  let api, manifest, loading, selected = null, lead = 0, hits = [], dragging = null;
  const data = new Map(), requested = new Set(), colours = {gfs: '#aa3d2d', ifs: '#233f78', aifs: '#76558f', gefs: '#08736f'};
  const initial = {west: 15, east: 110, south: 10, north: 60};
  let view = {...initial}, mode = 'latest', cycle = '', model = 'gfs', weather = 'vorticity', members = false;
  const $ = s => document.querySelector(s);
  function setup() {
    const tab = '<button class="mla-tab" role="tab" id="wdTabForecast" aria-selected="false" aria-controls="wdPanelForecast" data-tab="forecast" type="button">Forecasts</button>';
    $('#wdTabExplore').insertAdjacentHTML('afterend', tab);
    $('#wdPanelExplore').insertAdjacentHTML('afterend', `<section class="mla-panel" id="wdPanelForecast" role="tabpanel" aria-labelledby="wdTabForecast" data-panel="forecast" hidden><div class="mla-panel-heading"><h2>Forecasts</h2></div><section class="mla-card mla-section-card"><div class="mla-toolbar"><label class="mla-field"><span class="mla-label">Initialisation</span><select class="mla-select" id="wdForecastCycle"><option value="latest">Latest available</option></select></label><label class="mla-field"><span class="mla-label">Model</span><select class="mla-select" id="wdForecastModel"><option value="gfs">GFS</option><option value="ifs">IFS</option><option value="aifs">AIFS</option><option value="gefs">GEFS ensemble</option><option value="all">Compare models</option></select></label><label class="mla-field"><span class="mla-label">Weather layer</span><select class="mla-select" id="wdForecastWeather"><option value="none">No weather</option><option value="vorticity">450–300 hPa vorticity</option><option value="precipitation">Trailing 24 h precipitation</option></select></label><label><input type="checkbox" id="wdForecastMembers"> Member tracks</label><button class="mla-btn mla-btn-small" type="button" id="wdForecastRefresh">Refresh</button><button class="mla-btn mla-btn-small" type="button" id="wdForecastReset">Reset map</button></div><p class="mla-chart-readout" id="wdForecastStatus" role="status">Loading forecast inventory…</p><canvas class="wd-forecast-map" id="wdForecastMap" tabindex="0" role="img" aria-label="Operational WD forecast tracks; drag to pan, scroll to zoom, click a track to select"></canvas><div class="mla-toolbar"><button class="mla-btn mla-btn-small" type="button" id="wdForecastPrevious">−6 h</button><input class="mla-range" id="wdForecastLead" type="range" min="0" max="168" step="6" value="0" aria-label="Forecast lead hour"><button class="mla-btn mla-btn-small" type="button" id="wdForecastNext">+6 h</button><output id="wdForecastValid"></output></div><p id="wdForecastLegend" class="mla-chart-readout"></p><p class="mla-caution">Experimental track guidance, updated from operational forecasts; not an official warning. Forecast detection and sampling differ from the ERA5 catalogue.</p></section><section class="mla-card mla-chart-card"><h3>Forecast-system evolution</h3><label class="mla-field"><span class="mla-label">System</span><select class="mla-select" id="wdForecastSystem"><option value="">Select a forecast track</option></select></label><canvas class="mla-chart" id="wdForecastEvolution" tabindex="0" role="img" aria-label="Upper-level vorticity and precipitation; drag marker to change forecast time"></canvas><p class="mla-chart-readout" id="wdForecastEvolutionStatus"></p><details class="mla-a11y-data"><summary>Track points and provenance</summary><div id="wdForecastData"></div></details></section></section>`);
  }
  setup();
  function key(r) { return `${r.model}-${r.cycle}-${r.member}`; }
  function base() { return api.config.forecastBase || 'forecast-data'; }
  async function loadManifest() {
    if (loading) return loading;
    loading = fetch(`${base()}/manifest.json`, {cache: 'no-store'}).then(r => { if (!r.ok) throw new Error(`Inventory HTTP ${r.status}`); return r.json(); }).then(value => {
      if (value.schema !== 'wd-forecast-manifest-v1') throw new Error('Unsupported forecast inventory');
      manifest = value;
      const cycles = [...new Set(value.runs.map(r => r.cycle))].sort().reverse();
      $('#wdForecastCycle').innerHTML = '<option value="latest">Latest available</option>' + cycles.map(c => `<option value="${c}">${c.slice(0,4)}-${c.slice(4,6)}-${c.slice(6,8)} ${c.slice(8)} UTC</option>`).join('');
      if (cycle && cycles.includes(cycle)) $('#wdForecastCycle').value = cycle;
      else { cycle = ''; mode = 'latest'; }
      return loadRuns();
    }).catch(error => { $('#wdForecastStatus').textContent = `Forecasts unavailable: ${error.message}. Retry with Refresh.`; }).finally(() => { loading = null; });
    return loading;
  }
  function entries() {
    if (!manifest) return [];
    let rows = manifest.runs.filter(r => model === 'all' || r.model === model);
    if (cycle) rows = rows.filter(r => r.cycle === cycle);
    else if(model==='all'){
      // Model comparisons must represent the same initialization/valid time.
      const cycles=[...new Set(rows.map(r=>r.cycle))].sort().reverse();
      const common=cycles.find(c=>['gfs','ifs','aifs','gefs'].every(m=>rows.some(r=>r.cycle===c&&r.model===m)));
      rows=rows.filter(r=>r.cycle===(common||cycles[0]));
    }
    else {
      const latest = new Map(); rows.forEach(r => latest.set(r.model, [latest.get(r.model) || '', r.cycle].sort().at(-1)));
      rows = rows.filter(r => r.cycle === latest.get(r.model));
    }
    return rows;
  }
  async function loadRuns() {
    const wanted = entries(); requested.clear(); wanted.forEach(r => requested.add(key(r)));
    $('#wdForecastStatus').textContent = `Loading ${wanted.length} forecast run${wanted.length === 1 ? '' : 's'}…`;
    await Promise.all(wanted.map(async r => {
      if (data.has(key(r))) return;
      try {
        const buffer = await api.fetchInflated(`${base()}/${r.model === 'gefs' && r.member !== 'c00' && r.tracks_url ? r.tracks_url : r.url}`);
        const payload = JSON.parse(new TextDecoder().decode(buffer));
        if (payload.schema !== 'wd-operational-forecast-v1' || !payload.qa.complete || payload.model !== r.model || payload.cycle !== r.cycle || payload.member !== r.member) throw new Error('Forecast identity/QA mismatch');
        data.set(key(r), payload);
      } catch (e) { console.warn('WD forecast run unavailable', key(r), e.message); }
    }));
    render();
  }
  function runs() { return [...requested].map(k => data.get(k)).filter(Boolean); }
  function tracks() { return runs().flatMap(run => run.tracks.map(t => ({...t, key: `${key(run)}:${t.id}`, run, colour: colours[run.model] || '#444'}))); }
  function at(t, hour) {
    const points = t.points, exact = points.find(p => p[0] === hour);
    return exact || null;
  }
  function ensembleMeans(all) {
    const ensemble = all.filter(t => t.run.model === 'gefs'), groups = [];
    const distance = (a, b) => Math.hypot((a[1] - b[1]) * Math.cos((a[2] + b[2]) * Math.PI / 360), a[2] - b[2]) * 111;
    for (const track of ensemble.sort((a,b) => b.points.length - a.points.length || a.key.localeCompare(b.key))) {
      let best = null, score = 400;
      for (const g of groups) {
        if (g.some(t => t.run.cycle !== track.run.cycle || t.member === track.member)) continue;
        const same = track.points.map(p => [p, at(g[0], p[0])]).filter(pair => pair[1]);
        if (same.length < 4) continue;
        const d = same.reduce((s, pair) => s + distance(...pair), 0) / same.length;
        if (d < score) { score = d; best = g; }
      }
      if (best) best.push(track); else groups.push([track]);
    }
    return groups.map((g, i) => {
      const leads = [...new Set(g.flatMap(t => t.points.map(p => p[0])))].sort((a,b) => a-b);
      const points = leads.map(hour => { const sample = g.map(t => at(t, hour)).filter(Boolean), means = [1,2,3,4].map(column => { const v = sample.map(p => p[column]).filter(Number.isFinite); return v.length ? v.reduce((a,b) => a+b,0)/v.length : null; }); return [hour, ...means, sample.length]; });
      return {key: `gefs-${g[0].run.cycle}-mean-${i}`, id: `GEFS group ${i+1}`, member: 'mean', run: g[0].run, points, colour: colours.gefs, children: g, support: g.length};
    });
  }
  function render() {
    if (!api || $('#wdPanelForecast').hidden) return;
    const loaded = runs(), all = tracks(), means = ensembleMeans(all), shown = all.filter(t => t.run.model !== 'gefs').concat(means);
    const selectable=members?shown.concat(all.filter(t=>t.run.model==='gefs')):shown;
    const options = selectable.map(t => `<option value="${api.escapeHtml(t.key)}">${api.escapeHtml(t.run.model.toUpperCase() + ' · ' + t.id)}${t.support ? ` · ${t.support} members` : ''}</option>`).join('');
    $('#wdForecastSystem').innerHTML = '<option value="">Select a forecast track</option>' + options;
    if (selected && selectable.some(t => t.key === selected)) $('#wdForecastSystem').value = selected; else if(loaded.length===requested.size)selected = null;
    // Keep the selected lead while a newly chosen model is still downloading.
    const max = Math.max(0, ...entries().map(r => r.horizon)); lead = Math.min(max, lead); $('#wdForecastLead').max = max; $('#wdForecastLead').value = lead;
    const cycles = [...new Set(loaded.map(r => r.cycle_utc))], latest = Math.max(...cycles.map(Date.parse));
    const stale = Number.isFinite(latest) && Date.now() - latest > 30*3600000;
    $('#wdForecastStatus').textContent = loaded.length ? `${stale ? 'STALE GUIDANCE · ' : ''}${loaded.length}/${requested.size} requested member runs available · ${shown.length} systems/groups · initialised ${cycles.map(c => c.slice(0,16).replace('T',' ') + ' UTC').join(', ')}${loaded.some(r => r.model === 'gefs') ? ' · GEFS support is conditional on matched, detected tracks, not a calibrated probability.' : ''}` : 'No completed forecast runs available for this selection.';
    $('#wdForecastStatus').dataset.tone = stale ? 'flag' : '';
    if(model==='all'){$('#wdForecastStatus').textContent+=' · common initialisation';const missing=['gfs','ifs','aifs','gefs'].filter(m=>!loaded.some(r=>r.model===m));if(missing.length)$('#wdForecastStatus').textContent+=` · unavailable: ${missing.join(', ').toUpperCase()}`;}
    $('#wdForecastValid').textContent = `T+${lead} h${cycles.length === 1 ? ' · ' + new Date(Date.parse(cycles[0]) + lead*3600000).toISOString().slice(0,16).replace('T',' ') + ' UTC' : ' · each run uses its own initialisation'}`;
    drawMap(shown, all); drawEvolution(selectable.find(t => t.key === selected));
    const url = new URL(location.href); for (const [k,v] of Object.entries({f_model:model,f_cycle:cycle || 'latest',f_lead:lead,f_weather:weather,f_members:members?'1':'0',f_view:[view.west,view.east,view.south,view.north].map(v=>v.toFixed(3)).join(',')})) url.searchParams.set(k,v);if(selected)url.searchParams.set('f_selected',selected);else url.searchParams.delete('f_selected');history.replaceState(null,'',url);
  }
  function drawMap(shown, all) {
    const c = api.prepareCanvas($('#wdForecastMap')); if (!c) return;
    const {context: ctx, width, height} = c;
    const x = lon => (lon-view.west)/(view.east-view.west)*width, y = lat => (view.north-lat)/(view.north-view.south)*height;
    ctx.fillStyle = '#f6f3ec'; ctx.fillRect(0,0,width,height);
    const weatherRun = runs().find(r => r.frames?.length && r.model !== 'gefs') || runs().find(r => r.frames?.length);
    const f = weatherRun?.frames.find(f => f.lead === lead), grid = weatherRun?.grid;
    if (weather !== 'none' && f?.[weather]) {
      const values = f[weather], maximum = weather === 'vorticity' ? 15 : 100, nx = grid.lon.length;
      values.forEach((v,i) => { const a = v * grid.scale / maximum; if (a <= .015) return; const lon=grid.lon[i%nx],lat=grid.lat[Math.floor(i/nx)]; ctx.fillStyle = weather === 'vorticity' ? `rgba(170,61,45,${Math.min(.82,a*.82)})` : `rgba(35,63,120,${Math.min(.85,a*.85)})`; ctx.fillRect(x(lon-.5),y(lat+.5), width/(view.east-view.west)+.5,height/(view.north-view.south)+.5); });
    }
    const context = window.WD_MAP_CONTEXT || window.WDMapContext || window.MAP_CONTEXT;
    // The atlas map context is provided via the shared interface below.
    ctx.strokeStyle = '#888'; ctx.lineWidth = .65;
    for (const lines of [api.mapContext?.coast, api.mapContext?.borders]) for (const line of lines || []) {
      ctx.beginPath(); line.forEach((p,i) => i ? ctx.lineTo(x(p[0]),y(p[1])) : ctx.moveTo(x(p[0]),y(p[1]))); ctx.stroke();
    }
    ctx.font = '11px effra, Arial, sans-serif'; ctx.fillStyle = '#555'; ctx.textAlign = 'center';
    for(let lon=Math.ceil(view.west/10)*10;lon<view.east;lon+=10) { ctx.strokeStyle='rgba(100,100,100,.15)';ctx.beginPath();ctx.moveTo(x(lon),0);ctx.lineTo(x(lon),height);ctx.stroke();ctx.fillText(`${lon}°`,x(lon),height-8); }
    hits=[];
    function path(t, alpha, lineWidth) {
      ctx.strokeStyle=t.key===selected?'#000':t.colour;ctx.globalAlpha=alpha;ctx.lineWidth=lineWidth;ctx.setLineDash(t.run.model==='ifs'?[7,3]:t.run.model==='aifs'?[2,3]:[]);ctx.beginPath();
      t.points.forEach((p,i)=>{if(!i || p[0]-t.points[i-1][0]>6)ctx.moveTo(x(p[1]),y(p[2]));else {ctx.lineTo(x(p[1]),y(p[2]));hits.push({track:t,x1:x(t.points[i-1][1]),y1:y(t.points[i-1][2]),x2:x(p[1]),y2:y(p[2])});}});ctx.stroke();ctx.globalAlpha=1;ctx.setLineDash([]);
      const point=at(t,lead); if(point) {ctx.fillStyle=t.key===selected?'#000':t.colour;ctx.beginPath();ctx.arc(x(point[1]),y(point[2]),t.member==='mean'?5:4,0,2*Math.PI);ctx.fill();}
    }
    if(members) all.filter(t=>t.run.model==='gefs').forEach(t=>path(t,.18,1));
    shown.forEach(t=>path(t,t.key===selected?1:.8,t.key===selected?3:2));
    const selectedMember=all.find(t=>t.key===selected&&t.run.model==='gefs');if(selectedMember)path(selectedMember,1,3);
    $('#wdForecastLegend').textContent = `GFS: red solid · IFS: blue dashed · AIFS: purple dotted · GEFS: teal · selected: black. ${weather==='none'?'': `${weatherRun?.model.toUpperCase() || ''} weather: ${weather==='vorticity'?'0–15 ×10⁻⁵ s⁻¹ (T42 layer mean)':'0–100 mm / 24 h'}${!f?.[weather]?' · unavailable at this lead':''}.`}`;
  }
  let evolutionHit = null;
  function drawEvolution(track) {
    const c=api.prepareCanvas($('#wdForecastEvolution'));if(!c)return;
    evolutionHit=null;
    if(!track){api.drawEmptyChart(c.context,c.width,c.height,'Select a forecast track.');$('#wdForecastEvolutionStatus').textContent='';$('#wdForecastData').innerHTML='';return;}
    const max=Math.max(1,...track.points.map(p=>p[3]))*1.1, rainMax=Math.max(1,...track.points.map(p=>p[4]||0))*1.1;
    const p=api.chartFrame(c.context,c.width,c.height,{left:60,right:60,top:20,bottom:45,yMax:max,yLabel:'450–300 hPa ζ (10⁻⁵ s⁻¹)',xLabel:'Forecast lead (h)'});
    const x=h=>p.left+h/track.run.horizon*p.width,y=v=>p.bottom-v/max*p.height;
    c.context.fillStyle='rgba(35,63,120,.23)';track.points.forEach(point=>{if(point[4]!=null)c.context.fillRect(x(point[0])-3,p.bottom-point[4]/rainMax*p.height,6,point[4]/rainMax*p.height);});
    api.drawLineSeries(c.context,track.points.map(point=>point[3]),i=>x(track.points[i][0]),y,track.colour,false,p);
    c.context.save();c.context.setLineDash([5,4]);c.context.strokeStyle='#111';c.context.beginPath();c.context.moveTo(x(lead),p.top);c.context.lineTo(x(lead),p.bottom);c.context.stroke();c.context.restore();
    c.context.font='11px effra,Arial,sans-serif';c.context.fillStyle='#555';c.context.textAlign='center';for(let h=0;h<=track.run.horizon;h+=24)c.context.fillText(h,x(h),p.bottom+18);
    c.context.textAlign='left';for(let i=0;i<=4;i++)c.context.fillText((rainMax*i/4).toFixed(0),p.right+6,p.bottom-i*p.height/4+3);
    evolutionHit={left:p.left,width:p.width,horizon:track.run.horizon};
    const point=at(track,lead);
    $('#wdForecastEvolutionStatus').textContent=`Line: layer vorticity · bars/right axis: trailing 24 h precipitation (mm). ${point?`T+${lead}: ${point[3].toFixed(2)} ×10⁻⁵ s⁻¹; ${point[4]==null?'precipitation unavailable':point[4].toFixed(1)+' mm'}${point[5]?' · '+point[5]+' matched members':''}`:''}`;
    $('#wdForecastData').innerHTML=api.accessibleTable(['Lead (h)','Longitude','Latitude','Vorticity (10⁻⁵ s⁻¹)','24 h precipitation (mm)','Members'],track.points.map(p=>[...p.slice(0,4),p[4]??'—',p[5]??1]))+`<p>${api.escapeHtml(track.run.method.tracking)}. ${api.escapeHtml(track.run.method.precipitation)} ${track.run.method.interpolated_levels.length?'350/450 hPa interpolated from 300/400/500-hPa fields.':''}</p>`;
  }
  function setLead(value){lead=Math.max(0,Math.round(value/6)*6);render();}
  let bound=false;
  function bind() {
    if(bound)return;bound=true;
    $('#wdForecastCycle').addEventListener('change',e=>{cycle=e.target.value==='latest'?'':e.target.value;selected=null;loadRuns();});
    $('#wdForecastModel').addEventListener('change',e=>{model=e.target.value;selected=null;loadRuns();});
    $('#wdForecastWeather').addEventListener('change',e=>{weather=e.target.value;render();});
    $('#wdForecastMembers').addEventListener('change',e=>{members=e.target.checked;render();});
    $('#wdForecastSystem').addEventListener('change',e=>{selected=e.target.value;render();});
    $('#wdForecastLead').addEventListener('input',e=>setLead(Number(e.target.value)));
    $('#wdForecastLead').addEventListener('wheel',e=>{e.preventDefault();setLead(lead+(e.deltaY>0?6:-6));},{passive:false});
    $('#wdForecastPrevious').addEventListener('click',()=>setLead(lead-6));$('#wdForecastNext').addEventListener('click',()=>setLead(lead+6));
    $('#wdForecastRefresh').addEventListener('click',loadManifest);$('#wdForecastReset').addEventListener('click',()=>{view={...initial};render();});
    const canvas=$('#wdForecastMap');
    canvas.addEventListener('pointerdown',e=>{dragging={x:e.clientX,y:e.clientY,view:{...view},moved:false};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(!dragging)return;const dx=e.clientX-dragging.x,dy=e.clientY-dragging.y;dragging.moved ||=Math.hypot(dx,dy)>5;const r=canvas.getBoundingClientRect(),v=dragging.view;view={west:v.west-dx/r.width*(v.east-v.west),east:v.east-dx/r.width*(v.east-v.west),south:v.south+dy/r.height*(v.north-v.south),north:v.north+dy/r.height*(v.north-v.south)};render();});
    canvas.addEventListener('pointerup',e=>{if(dragging&&!dragging.moved){const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;let best=null,distance=100;for(const h of hits){const dx=h.x2-h.x1,dy=h.y2-h.y1,t=Math.max(0,Math.min(1,((x-h.x1)*dx+(y-h.y1)*dy)/(dx*dx+dy*dy||1))),d=(x-h.x1-t*dx)**2+(y-h.y1-t*dy)**2;if(d<distance){distance=d;best=h.track;}}if(best)selected=best.key;}dragging=null;canvas.releasePointerCapture(e.pointerId);render();});
    canvas.addEventListener('pointercancel',()=>{dragging=null;});
    canvas.addEventListener('wheel',e=>{e.preventDefault();const scale=e.deltaY>0?1.2:1/1.2,cx=(view.west+view.east)/2,cy=(view.north+view.south)/2,w=Math.max(10,Math.min(150,(view.east-view.west)*scale)),h=Math.max(8,Math.min(70,(view.north-view.south)*scale));view={west:cx-w/2,east:cx+w/2,south:cy-h/2,north:cy+h/2};render();},{passive:false});
    const evolution=$('#wdForecastEvolution');let scrub=false;const move=e=>{if(!evolutionHit)return;setLead((e.clientX-evolution.getBoundingClientRect().left-evolutionHit.left)/evolutionHit.width*evolutionHit.horizon);};
    evolution.addEventListener('pointerdown',e=>{scrub=true;evolution.setPointerCapture(e.pointerId);move(e);});evolution.addEventListener('pointermove',e=>{if(scrub)move(e);});evolution.addEventListener('pointerup',()=>{scrub=false;});evolution.addEventListener('pointercancel',()=>{scrub=false;});evolution.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setLead(lead+(e.key==='ArrowRight'?6:-6));}});
    const params=new URLSearchParams(location.search);if(['gfs','ifs','aifs','gefs','all'].includes(params.get('f_model')))model=params.get('f_model');if(/^\d{10}$/.test(params.get('f_cycle')||''))cycle=params.get('f_cycle');lead=Math.max(0,Number(params.get('f_lead'))||0);if(['none','vorticity','precipitation'].includes(params.get('f_weather')))weather=params.get('f_weather');members=params.get('f_members')==='1';
    selected=params.get('f_selected');const v=(params.get('f_view')||'').split(',').map(Number);if(v.length===4&&v.every(Number.isFinite)&&v[1]>v[0]&&v[3]>v[2]&&v[1]-v[0]<=360&&v[2]>=-90&&v[3]<=90)view={west:v[0],east:v[1],south:v[2],north:v[3]};
    $('#wdForecastModel').value=model;$('#wdForecastWeather').value=weather;$('#wdForecastMembers').checked=members;
  }
  function show(value){api=value;bind();if(!manifest)loadManifest();else render();}
  return {show};
})();
