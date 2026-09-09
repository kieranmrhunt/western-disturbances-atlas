const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const geography = require('../assets/geography.js');
const root = path.join(__dirname, '..', 'assets');
const raw = name => Uint8Array.from(zlib.gunzipSync(fs.readFileSync(path.join(root, name)))).buffer;
const {cat, off, meta} = JSON.parse(Buffer.from(raw('wd-atlas-catalogue-v7.json.gz')).toString());
const points = new Int16Array(raw('wd-atlas-points-v7.i16.gz'));
const times = new Int32Array(raw('wd-atlas-times-v7.i32.gz'));
const coordinates = new Float32Array(raw('wd-atlas-coordinates-v7.f32.gz'));
const lon = coordinates.subarray(0,meta.npts), lat = coordinates.subarray(meta.npts);
const rule = {mode:'cross',west:70,east:80,south:20,north:50};
let review=0,core=0; const differences=[];
for(let i=0;i<meta.ntracks;i++) {
  const enters=geography.enters(lon,lat,times,...off[i],rule,1);
  const match=enters && cat.dur[i]>=48;
  review+=Number(match); core+=Number(match && cat.quality[i]);
  if(Number(match && cat.quality[i])!==cat.core[i]) differences.push(cat.id[i]);
}
console.log(JSON.stringify({tracks:meta.ntracks,points:meta.npts,review,core,differences},null,2));
