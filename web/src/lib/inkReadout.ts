// Vector stroke destinations, never a text overlay or visibility mask.
type Stroke = [number, number, number, number];
const SEGMENTS: Stroke[] = [
  [0,1,1,1], [1,1,1,.5], [1,.5,1,0], [0,0,1,0],
  [0,.5,0,0], [0,1,0,.5], [0,.5,1,.5],
];
const DIGITS = ['012345','12','01643','01623','5612','05623','056432','012','0123456','012356'];

export function readoutDestinations(text: string, count: number): Float32Array | null {
  const match = text.match(/^(-?\d{1,3}(?:\.\d)?)°([CF])$/);
  if (!match) return null;
  const strokes: Stroke[] = [];
  const number = match[1];
  const widths = [...number].map(c => c === '.' ? .28 : c === '-' ? .65 : 1);
  const total = widths.reduce((a,b) => a+b,0) + (number.length - 1) * .35;
  const scale = Math.min(.33, 1.06 / total);
  let left = -total * scale / 2;
  for (let i = 0; i < number.length; i++) {
    const c = number[i];
    const parts: Stroke[] = c === '.' ? [[.1,0,.13,0]] : c === '-' ? [[0,.5,.65,.5]] :
      [...DIGITS[Number(c)]].map(index => SEGMENTS[Number(index)]);
    for (const [x,y,x2,y2] of parts) strokes.push([left+x*scale, -.12+y*.5, left+x2*scale, -.12+y2*.5]);
    left += (widths[i] + .35) * scale;
  }
  // Keep the unit on a quiet second line so decimal readings remain legible.
  for (let i = 0; i < 16; i++) {
    const a=i*Math.PI/8, b=(i+1)*Math.PI/8;
    strokes.push([-.15+Math.cos(a)*.035,-.28+Math.sin(a)*.035,-.15+Math.cos(b)*.035,-.28+Math.sin(b)*.035]);
  }
  for (const index of match[2] === 'C' ? [0,5,4,3] : [0,5,4,6]) {
    const [x,y,x2,y2] = SEGMENTS[index];
    strokes.push([-.04+x*.14,-.43+y*.21,-.04+x2*.14,-.43+y2*.21]);
  }
  const lengths = strokes.map(([x,y,x2,y2]) => Math.hypot(x2-x,y2-y));
  const length = lengths.reduce((a,b)=>a+b,0);
  const points: [number,number][] = [];
  let segment=0, passed=0;
  for(let i=0;i<count;i++) {
    const d=(i+.5)/count*length;
    while(segment<strokes.length-1 && d>passed+lengths[segment]) passed+=lengths[segment++];
    const t=(d-passed)/lengths[segment];
    const [x,y,x2,y2]=strokes[segment];
    const jitter=Math.sin(i*2.399963)*.012;
    points.push([x+(x2-x)*t-(y2-y)/lengths[segment]*jitter,
      y+(y2-y)*t+(x2-x)/lengths[segment]*jitter]);
  }
  points.sort((a,b)=>Math.atan2(a[1],a[0])-Math.atan2(b[1],b[0]));
  return new Float32Array(points.flatMap(([x,y])=>[x,y,0]));
}
