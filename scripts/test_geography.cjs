const assert=require('node:assert/strict');
const G=require('../assets/geography.js');
const test=(points,rule,times=points.map((_,i)=>i*3))=>G.enters(points.map(p=>p[0]),points.map(p=>p[1]),times,0,points.length,rule,1);
const box={mode:'box',west:60,east:80,south:20,north:40};
assert(test([[50,30],[90,30]],box)); // passes through without an interior observation
assert(!test([[50,45],[90,45]],box));
assert(test([[70,30]],box));
assert(!test([[50,30],[90,30]],box,[0,12])); // no interpolation across an unsupported gap
assert(test([[179,30],[-179,30]],{...box,west:170,east:-170}));
assert(!test([[179,30],[-179,30]],box));
const crossing={...box,mode:'cross',west:70};
assert(test([[69,30],[71,32]],crossing));
assert(test([[70,30],[71,32]],crossing));
assert(!test([[71,32],[69,30]],crossing));
assert(!test([[179,30],[-179,30]],crossing));
assert(test([[75,45],[75,35]],{...box,mode:'east',west:70}));
assert(!test([[65,45],[65,35]],{...box,mode:'east',west:70}));
assert(test([[0,0]],{...box,mode:'none'}));
console.log('13 geographic entry tests passed');
