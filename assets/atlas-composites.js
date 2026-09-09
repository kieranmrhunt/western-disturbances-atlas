window.WDComposites = (() => {
  let api, inventory, inventoryPromise, serial=0, subsetSerial=0, reference=null;
  const tracks=new Map(),years=new Map(),pending=new Map(),plotted=new Map(), $=s=>document.querySelector(s);
  const variableOptions='<option value="relative_vorticity">Relative vorticity</option><option value="theta_e">Equivalent potential temperature</option><option value="relative_humidity">Relative humidity</option><option value="precipitation">Precipitation</option>';
  $('#wdPanelExplore .wd-impact-card').insertAdjacentHTML('afterend',`<section class="mla-card mla-chart-card wd-composite-card"><div class="mla-chart-head"><h3>Storm-centred structure</h3><label class="mla-field"><span class="mla-label">Field</span><select class="mla-select" id="wdCompositeVariable">${variableOptions}</select></label></div><canvas class="mla-chart" id="wdCompositeSelected" role="img" aria-label="Selected WD storm-centred composite"></canvas><p class="mla-chart-readout" id="wdCompositeSelectedStatus"></p></section>`);
  $('#wdPanelClimatology .mla-chart-grid').insertAdjacentHTML('beforeend',`<section class="mla-card mla-chart-card mla-chart-wide"><div class="mla-chart-head"><h3>Storm-centred subset comparison</h3><label class="mla-field"><span class="mla-label">Field</span><select class="mla-select" id="wdCompositeSubsetVariable">${variableOptions}</select></label></div><p>Equal WD weights; both panels use the same scale. Reference follows the subset pinned in Explore.</p><div class="wd-composite-pair"><section><h4>Current subset</h4><canvas class="mla-chart" id="wdCompositeSubset" role="img" aria-label="Filtered WD composite"></canvas></section><section><h4 id="wdCompositeReferenceHeading">All WDs</h4><canvas class="mla-chart" id="wdCompositeReference" role="img" aria-label="Reference WD composite"></canvas></section></div><p class="mla-chart-readout" id="wdCompositeSubsetStatus"></p></section>`);
  const definitions={relative_vorticity:{label:'Relative vorticity (10⁻⁵ s⁻¹)'},theta_e:{label:'Equivalent potential temperature (K)'},relative_humidity:{label:'Relative humidity (%)'},precipitation:{label:'Mean daily precipitation (mm day⁻¹)'}};
  $('#wdCompositeSelectedStatus').insertAdjacentHTML('afterend','<button class="mla-btn mla-btn-small" id="wdCompositeExport" type="button">Download plotted field</button>');
  $('#wdCompositeSubsetStatus').insertAdjacentHTML('afterend','<button class="mla-btn mla-btn-small" id="wdCompositeSubsetExport" type="button">Download comparison fields</button><details class="mla-a11y-data"><summary>Coverage and averaging</summary><p>Each available WD contributes one mean per grid cell. Downloads include cell-level system counts. Older systems may have only the locally archived pressure levels; their lower-level pressure data are not surface-pressure masked. Missing fields are excluded, never treated as zero.</p></details>');
  function base(){return api.config.compositeBase||'.composite-runs';}
  async function get(url){if(!pending.has(url))pending.set(url,api.fetchInflated(url).then(b=>JSON.parse(new TextDecoder().decode(b))).catch(e=>{pending.delete(url);throw e;}));return pending.get(url);}
  async function manifest(){if(inventory)return inventory;if(!inventoryPromise)inventoryPromise=get(`${base()}/manifest.json.gz`).then(v=>{if(v.schema!=='wd-composite-manifest-v1'||v.expected_tracks!==api.meta.ntracks||v.catalogue!==api.config.catalogueVersion)throw new Error('Composite catalogue mismatch');inventory=v;return v;}).catch(e=>{inventoryPromise=null;throw e;});return inventoryPromise;}
  function decode(field){return field?field.data.map(v=>v==null?null:v*field.scale):[];}
  async function selected(){
    plotted.delete('wdCompositeSelected');
    const request=++serial,id=api.selected>=0?api.cat.id[api.selected]:null,c=api.prepareCanvas($('#wdCompositeSelected'));if(!c)return;
    if(id==null){api.drawEmptyChart(c.context,c.width,c.height,'Select a WD.');$('#wdCompositeSelectedStatus').textContent='';return;}
    try {
      $('#wdCompositeSelectedStatus').textContent='Loading storm-centred fields…';
      const inv=await manifest();if(!inv.available_tracks.includes(id))throw new Error('not in the published inventory');
      let asset=tracks.get(id);if(!asset){asset=await get(`${base()}/tracks/track-${id}.json.gz`);if(asset.schema!=='wd-storm-composite-v1'||asset.track_id!==id||asset.catalogue!==api.config.catalogueVersion)throw new Error('Composite track mismatch');tracks.set(id,asset);}
      if(request!==serial)return;
      const key=$('#wdCompositeVariable').value,field=key==='precipitation'?asset.precipitation:asset.section[key];
      paint('wdCompositeSelected',field,asset.grid.pressure_hpa,asset.grid.relative_degrees,key);
      $('#wdCompositeSelectedStatus').textContent=field?`${field.samples}/${field.requested_samples} snapshots; ${(field.spatial_coverage_fraction*100).toFixed(0)}% grid coverage. ${key==='precipitation'?asset.method.precipitation:asset.method.vertical} Source: ${field.source}`:'This field is unavailable for this WD; missing values are not zero.';
    }catch(e){if(request!==serial)return;api.drawEmptyChart(c.context,c.width,c.height,'Composite not yet available.');$('#wdCompositeSelectedStatus').textContent=`No published composite for this WD (${e.message}).`;}
  }
  async function subset(){
    plotted.delete('wdCompositeSubset');plotted.delete('wdCompositeReference');
    const request=++subsetSerial,key=$('#wdCompositeSubsetVariable').value;
    const chosen=api.filtered.map(i=>api.cat.id[i]),ref=(reference||Array.from({length:api.meta.ntracks},(_,i)=>i)).map(i=>api.cat.id[i]);
    $('#wdCompositeReferenceHeading').textContent=reference?'Pinned reference':'All WDs';
    try {
      $('#wdCompositeSubsetStatus').textContent='Loading available subset composites…';
      const inv=await manifest();
      const need=new Set([...chosen,...ref]);
      const requestedYears=new Set(api.cat.id.map((id,i)=>need.has(id)?api.cat.year[i]:null));
      const queue=(inv.years||[]).filter(y=>requestedYears.has(y.year));
      // Bound HTTP pressure, not the science sample: every relevant year is read.
      let cursor=0;await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(cursor<queue.length){const item=queue[cursor++];if(!years.has(item.year))years.set(item.year,await get(`${base()}/${item.url}`));}}));
      if(request!==subsetSerial)return;
      const lookup=new Map();for(const year of years.values()){if(year.schema!=='wd-subset-composite-v1')throw new Error('Subset composite schema mismatch');year.tracks.forEach(t=>lookup.set(t.track_id,t));}
      const first=[...years.values()][0];if(!first)throw new Error('No year shards published yet');
      function mean(ids){let total=null,count=null,shape=null,n=0;for(const id of ids){const field=lookup.get(id)?.fields[key];if(!field)continue;const values=decode(field);if(!total){total=new Float64Array(values.length);count=new Uint16Array(values.length);shape=field.shape;}if(values.length!==total.length)throw new Error('Composite grid mismatch');let valid=false;values.forEach((v,i)=>{if(v!=null&&Number.isFinite(v)){total[i]+=v;count[i]++;valid=true;}});if(valid)n++;}return {n,field:total?{shape,scale:1,data:Array.from(total,(v,i)=>count[i]?v/count[i]:null),cell_systems:Array.from(count)}:null};}
      const a=mean(chosen),b=mean(ref),values=[...decode(a.field),...decode(b.field)].filter(v=>v!=null&&Number.isFinite(v));
      const range=values.length?{min:Math.min(...values),max:Math.max(...values)}:{min:0,max:1};
      paint('wdCompositeSubset',a.field,first.pressure_hpa,first.relative_degrees,key,range);paint('wdCompositeReference',b.field,first.pressure_hpa,first.relative_degrees,key,range);
      $('#wdCompositeSubsetStatus').textContent=`Available fields: ${a.n}/${chosen.length} subset WDs; ${b.n}/${ref.length} reference WDs. ${a.n<chosen.length||b.n<ref.length?'Partial archive: available systems may not represent the requested subset. ':''}Grey cells: no data. North-up coordinates; precipitation uses complete UTC days centred near noon, not causal attribution.`;
    }catch(e){if(request!==subsetSerial)return;$('#wdCompositeSubsetStatus').textContent=`Subset composites unavailable: ${e.message}`;for(const id of ['wdCompositeSubset','wdCompositeReference']){const c=api.prepareCanvas($('#'+id));if(c)api.drawEmptyChart(c.context,c.width,c.height,'No published subset composite.');}}
  }
  function paint(id,field,levels,relative,key,range){
    plotted.delete(id);
    const c=api.prepareCanvas($('#'+id));if(!c)return;
    if(!field){api.drawEmptyChart(c.context,c.width,c.height,'No data for this field.');return;}
    const values=decode(field),finite=values.filter(v=>v!=null&&Number.isFinite(v));if(!finite.length){api.drawEmptyChart(c.context,c.width,c.height,'No finite grid cells.');return;}
    plotted.set(id,{field,levels,relative,key,values});
    let low=range?range.min:Math.min(...finite),high=Math.max(low+1e-6,range?range.max:Math.max(...finite));
    if(key==='relative_vorticity'){high=Math.max(Math.abs(low),Math.abs(high));low=-high;}else if(key==='precipitation')low=0;
    const p={left:55,top:27,width:c.width-85,height:c.height-78},nx=field.shape[1],ny=field.shape[0];
    const colour=v=>{if(v==null)return '#e5e5e5';const fraction=key==='relative_vorticity'?Math.abs(v)/high:(v-low)/(high-low),root=key==='relative_vorticity'&&v<0?[170,91,35]:[35,63,120];return `rgb(${root.map(n=>Math.round(248+(n-248)*fraction)).join(',')})`;};
    const x=i=>p.left+(i+.5)/nx*p.width;
    const y=v=>p.top+(v-levels.at(-1))/(levels[0]-levels.at(-1))*p.height;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const v=values[(key==='precipitation'?ny-1-j:j)*nx+i];
      c.context.fillStyle=colour(v);
      let top=p.top+j/ny*p.height,h=p.height/ny;
      if(key!=='precipitation'){const bottom=j===0?levels[0]:(levels[j-1]+levels[j])/2,upper=j===ny-1?levels.at(-1):(levels[j]+levels[j+1])/2;top=y(upper);h=y(bottom)-top;}
      c.context.fillRect(p.left+i/nx*p.width,top,p.width/nx+.3,h+.3);
    }
    c.context.fillStyle='#333';c.context.font='11px effra, Arial, sans-serif';c.context.textAlign='center';
    c.context.fillText(`${definitions[key].label} · ${low.toFixed(1)}–${high.toFixed(1)}`,c.width/2,14);
    [0,Math.floor(nx/2),nx-1].forEach(i=>c.context.fillText(`${relative[i]}°`,x(i),p.top+p.height+17));c.context.fillText('Longitude relative to WD centre',c.width/2,c.height-7);
    c.context.textAlign='right';
    if(key==='precipitation') [0,Math.floor(ny/2),ny-1].forEach(j=>c.context.fillText(`${relative[ny-1-j]}°`,p.left-6,p.top+(j+.5)/ny*p.height));
    else levels.forEach(v=>{if([1000,850,700,500,350,200,100].includes(v))c.context.fillText(`${v}`,p.left-6,y(v)+4);});
    c.context.save();c.context.translate(13,p.top+p.height/2);c.context.rotate(-Math.PI/2);c.context.textAlign='center';c.context.fillText(key==='precipitation'?'Relative latitude':'Pressure (hPa)',0,0);c.context.restore();
    // Discrete colour key shares the exact limits of the paired fields.
    for(let i=0;i<20;i++){c.context.fillStyle=colour(low+(high-low)*i/19);c.context.fillRect(c.width-22,p.top+(19-i)*p.height/20,9,p.height/20+.2);}
    // Pressure increases downward. Latitude rows are stored south-to-north.
  }
  $('#wdCompositeVariable').addEventListener('change',()=>{if(api)selected();});$('#wdCompositeSubsetVariable').addEventListener('change',()=>{if(api)subset();});
  function exportFields(ids){
    const rows=[];for(const id of ids){const p=plotted.get(id);if(!p)continue;const nx=p.field.shape[1];p.values.forEach((v,i)=>rows.push([id,p.key,definitions[p.key].label,p.relative[i%nx],p.key==='precipitation'?p.relative[Math.floor(i/nx)]:'',p.key==='precipitation'?'':p.levels[Math.floor(i/nx)],v??'',p.field.cell_systems?.[i]??p.field.cell_samples?.[i]??'',p.field.cell_systems?'WDs':'snapshots']));}
    if(rows.length)api.downloadBlob(api.csvText(['panel','field','variable_and_units','relative_longitude_deg','relative_latitude_deg','pressure_hpa','value','valid_samples','sample_unit'],rows),'text/csv','wd-storm-centred-fields.csv');
  }
  $('#wdCompositeExport').addEventListener('click',()=>exportFields(['wdCompositeSelected']));$('#wdCompositeSubsetExport').addEventListener('click',()=>exportFields(['wdCompositeSubset','wdCompositeReference']));
  return {render(value,tab,ref){api=value;reference=ref;if(tab==='explore')selected();else if(tab==='climatology')subset();},selectionChanged(value){api=value;selected();}};
})();
