/* Geographic entry tests on observed trajectories and their short segments. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WDGeography = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
  function segmentBox(x1, y1, x2, y2, west, east, south, north) {
    let low = 0, high = 1;
    for (const [a, delta, minimum, maximum] of [[x1, x2-x1, west, east], [y1, y2-y1, south, north]]) {
      if (Math.abs(delta) < 1e-12) { if (a < minimum || a > maximum) return false; continue; }
      const t1 = (minimum-a)/delta, t2 = (maximum-a)/delta;
      low = Math.max(low, Math.min(t1,t2)); high = Math.min(high, Math.max(t1,t2));
      if (low > high) return false;
    }
    return true;
  }
  function enters(lon, lat, time, start, count, rule, scale=100) {
    if (rule.mode === 'none') return true;
    if (!count || rule.south > rule.north) return false;
    const west = rule.west, east = rule.mode === 'east' ? 180 : rule.east;
    const unwrappedEast = east < west ? east+360 : east;
    for (let k=0; k<count; k++) {
      const i=start+k, y2=lat[i]/scale, x2=wrap(lon[i]/scale);
      if (rule.mode !== 'cross') {
        const x=west+((x2-west)%360+360)%360;
        if (x <= unwrappedEast && y2 >= rule.south && y2 <= rule.north) return true;
      }
      if (!k || time[i]-time[i-1] > 9) continue;
      const x1=wrap(lon[i-1]/scale), y1=lat[i-1]/scale, end=x1+wrap(x2-x1);
      for (const shift of [-360,0,360]) {
        if (rule.mode === 'cross') {
          const target=west+shift;
          if (end > x1 && x1 <= target && end >= target) {
            const y=y1+(y2-y1)*(target-x1)/(end-x1);
            if (y >= rule.south && y <= rule.north) return true;
          }
        } else if (segmentBox(x1,y1,end,y2,west+shift,unwrappedEast+shift,rule.south,rule.north)) return true;
      }
    }
    return false;
  }
  return {enters, segmentBox};
});
