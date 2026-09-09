/* Paired, source-coverage-audited legacy CMIP5 comparisons. */
window.WDClimateChange = (() => {
  'use strict';
  let api, asset, loading;
  const $ = s => document.querySelector(s), blue='#233f78', orange='#aa5b23';
  const seasons={annual:[1,2,3,4,5,6,7,8,9,10,11,12],djf:[12,1,2],djfm:[12,1,2,3],mam:[3,4,5],ndjfma:[11,12,1,2,3,4],jjas:[6,7,8,9]};
  $('#wdTabClimatology').insertAdjacentHTML('afterend','<button class="mla-tab" role="tab" id="wdTabClimateChange" aria-selected="false" aria-controls="wdPanelClimateChange" data-tab="climate-change" type="button">Climate change</button>');
  $('#wdPanelClimatology').insertAdjacentHTML('afterend',`<section class="mla-panel" id="wdPanelClimateChange" data-panel="climate-change" role="tabpanel" aria-labelledby="wdTabClimateChange" hidden><div class="mla-panel-heading"><h2>Climate change</h2></div><section class="mla-card mla-section-card"><div class="mla-toolbar"><label class="mla-field"><span class="mla-label">CMIP5 scenario</span><select class="mla-select" id="wdProjectionScenario"><option value="rcp85">RCP8.5</option><option value="rcp45">RCP4.5</option><option value="rcp26">RCP2.6</option><option value="rcp60">RCP6.0</option></select></label><label class="mla-field"><span class="mla-label">Months</span><select class="mla-select" id="wdProjectionSeason"><option value="djf">DJF</option><option value="djfm">DJFM</option><option value="ndjfma">NDJFMA</option><option value="mam">MAM</option><option value="jjas">JJAS</option><option value="annual">All months</option></select></label></div><p class="mla-chart-readout" id="wdProjectionStatus" role="status">Loading the CMIP5 coverage audit…</p><p class="mla-caution">Legacy CMIP5 WD tracks, not ERA5 v6 or CMIP6. Comparisons use the same models in 1980–1999 and 2080–2099, with equal model weights. Model spread is not a probability interval.</p></section><div class="mla-chart-grid"><section class="mla-card mla-chart-card"><h3>Projected frequency change by model</h3><canvas class="mla-chart" id="wdProjectionChanges" role="img" aria-label="Percentage frequency change for each paired CMIP5 model"></canvas><p class="mla-chart-readout" id="wdProjectionChangeStatus"></p></section><section class="mla-card mla-chart-card"><h3>Monthly WD frequency</h3><canvas class="mla-chart" id="wdProjectionCycle" role="img" aria-label="Monthly mean frequency in historical and future model simulations"></canvas><p class="mla-chart-readout">Historical: blue solid · future: orange dashed. Systems per model-year in each month; the same paired models contribute throughout.</p></section></div><section class="mla-card mla-section-card"><details class="mla-a11y-data"><summary>Model values, source coverage and method</summary><div id="wdProjectionData"></div></details></section></section>`);
  function pairs(){
    const scenario=$('#wdProjectionScenario').value,months=seasons[$('#wdProjectionSeason').value];
    const historicalByModel=new Map(asset.models.filter(r=>r.experiment==='historical').map(r=>[r.model,r]));
    return asset.models.filter(r=>r.experiment===scenario).flatMap(future=>{
      const past=historicalByModel.get(future.model);
      if(!past||past.months.length!==240||future.months.length!==240||!past.months.every(r=>r.complete)||!future.months.every(r=>r.complete))return [];
      const value=r=>r.months.filter(m=>months.includes(m.month)).reduce((s,m)=>s+m.count,0)/20;
      const historical=value(past),projected=value(future);
      return [{model:future.model,past,future,historical,projected,change:historical>0?100*(projected/historical-1):null}];
    });
  }
  function render(){
    if(!asset||$('#wdPanelClimateChange').hidden)return;
    const rows=pairs(),finite=rows.filter(r=>r.change!=null),median=window.WDAnalysis.quantile(finite.map(r=>r.change).sort((a,b)=>a-b),.5);
    $('#wdProjectionStatus').textContent=rows.length?`${rows.length} paired models · ${$('#wdProjectionSeason').selectedOptions[0].textContent} · median model change ${median==null?'unavailable':(median>=0?'+':'')+median.toFixed(1)+'%'} · first entry into 60–80°E, 20–36.5°N.`:'No paired models with 20 fully covered years in both periods for this scenario.';
    drawChanges(finite);drawCycle(rows);
    const excluded=asset.models.filter(r=>r.experiment===$('#wdProjectionScenario').value&&!rows.some(v=>v.model===r.model));
    $('#wdProjectionData').innerHTML=api.accessibleTable(['Model','Calendar','Historical systems/year','Future systems/year','Change (%)'],rows.map(r=>[r.model,r.future.calendar,r.historical.toFixed(2),r.projected.toFixed(2),r.change==null?'—':r.change.toFixed(2)]))+Object.values(asset.method).map(v=>`<p>${api.escapeHtml(v)}</p>`).join('')+`<p>Excluded for incomplete paired coverage: ${api.escapeHtml(excluded.map(r=>r.model).join(', ')||'none')}. Source-audit exclusions: ${asset.excluded.length} model/experiment records. Source paths, input hashes and every month’s completeness are retained in the <a href="assets/wd-climate-change-v1.json.gz">downloadable audit</a>.</p>`;
    const url=new URL(location.href);url.searchParams.set('cc_scenario',$('#wdProjectionScenario').value);url.searchParams.set('cc_season',$('#wdProjectionSeason').value);history.replaceState(null,'',url);api.scheduleUrlUpdate();
  }
  function drawChanges(rows){
    const canvas=$('#wdProjectionChanges');canvas.style.height=`${Math.max(260,rows.length*24+65)}px`;
    const c=api.prepareCanvas(canvas);if(!c)return;if(!rows.length){api.drawEmptyChart(c.context,c.width,c.height,'No complete paired models.');return;}
    rows=rows.slice().sort((a,b)=>a.change-b.change);
    const ctx=c.context,left=Math.min(132,c.width*.4),right=c.width-35,top=20,bottom=c.height-40;
    const low=Math.min(0,...rows.map(r=>r.change)),high=Math.max(0,...rows.map(r=>r.change)),pad=Math.max(3,(high-low)*.08),lo=low-pad,hi=high+pad;
    const x=v=>left+(v-lo)/(hi-lo)*(right-left),row=(bottom-top)/rows.length;
    ctx.strokeStyle='#777';ctx.beginPath();ctx.moveTo(x(0),top);ctx.lineTo(x(0),bottom);ctx.stroke();
    ctx.font='11px effra,Arial,sans-serif';
    rows.forEach((r,i)=>{const y=top+(i+.5)*row;ctx.fillStyle='#333';ctx.textAlign='right';ctx.fillText(r.model,left-8,y+4);ctx.strokeStyle=blue;ctx.beginPath();ctx.moveTo(x(0),y);ctx.lineTo(x(r.change),y);ctx.stroke();ctx.fillStyle=blue;ctx.beginPath();ctx.arc(x(r.change),y,3.5,0,2*Math.PI);ctx.fill();});
    ctx.fillStyle='#555';ctx.textAlign='center';[lo,0,hi].filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>(hi-lo)*.12).forEach(v=>ctx.fillText(v.toFixed(0),x(v),bottom+18));ctx.fillText('Change from 1980–1999 (%)',c.width/2,c.height-5);
    const values=rows.map(r=>r.change).sort((a,b)=>a-b);$('#wdProjectionChangeStatus').textContent=`${rows.length} models · model IQR ${window.WDAnalysis.quantile(values,.25).toFixed(1)} to ${window.WDAnalysis.quantile(values,.75).toFixed(1)}%. Each dot is one model’s relative change, not a pooled event estimate.`;
  }
  function drawCycle(rows){
    const c=api.prepareCanvas($('#wdProjectionCycle'));if(!c)return;if(!rows.length){api.drawEmptyChart(c.context,c.width,c.height,'No complete paired models.');return;}
    const values=key=>Array.from({length:12},(_,m)=>rows.reduce((s,r)=>s+r[key].months.filter(v=>v.month===m+1).reduce((t,v)=>t+v.count,0)/20,0)/rows.length);
    const a=values('past'),b=values('future'),max=Math.max(1,...a,...b)*1.12;
    const p=api.chartFrame(c.context,c.width,c.height,{left:55,right:20,top:25,bottom:45,yMax:max,yLabel:'Systems per model-year',xLabel:'Entry month'}),x=i=>p.left+(i+.5)/12*p.width,y=v=>p.bottom-v/max*p.height;
    api.drawLineSeries(c.context,a,x,y,blue,false,p);c.context.save();c.context.setLineDash([6,4]);api.drawLineSeries(c.context,b,x,y,orange,false,p);c.context.restore();
    c.context.fillStyle='#555';c.context.textAlign='center';c.context.font='11px effra,Arial,sans-serif';['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].forEach((m,i)=>c.context.fillText(m,x(i),p.bottom+17));
  }
  for(const id of ['wdProjectionScenario','wdProjectionSeason'])$('#'+id).addEventListener('change',render);
  const params=new URLSearchParams(location.search);for(const [key,id] of [['cc_scenario','wdProjectionScenario'],['cc_season','wdProjectionSeason']])if([...$('#'+id).options].some(o=>o.value===params.get(key)))$('#'+id).value=params.get(key);
  return {show(value){api=value;if(asset){render();return;}if(!loading)loading=api.fetchInflated('assets/wd-climate-change-v1.json.gz').then(b=>{asset=JSON.parse(new TextDecoder().decode(b));if(asset.schema!=='wd-climate-change-v1')throw new Error('Unexpected climate-change data format');render();}).catch(e=>{$('#wdProjectionStatus').textContent=`Climate-change data unavailable: ${e.message}`;asset=null;}).finally(()=>{loading=null;});}};
})();
