type Position={id:string;label:string};
export function groupTrainingPositions(positions:Position[]){
 const groups=new Map<string,{id:string;label:string;ids:string[]}>();
 for(const position of positions){
  const label=position.label.replace(/\s*\(operational role\)\s*$/i,'').replace(/_/g,' ').trim().replace(/\s+/g,' ');
  const key=label.toLowerCase()==='office'&&position.id.startsWith('operation:')?'office staff':label.toLowerCase();
  const existing=groups.get(key);
  if(existing){if(!existing.ids.includes(position.id))existing.ids.push(position.id);}
  else groups.set(key,{id:position.id,label:key==='office staff'?'Office Staff':label.replace(/\b\w/g,c=>c.toUpperCase()),ids:[position.id]});
 }
 return [...groups.values()].sort((a,b)=>a.label.localeCompare(b.label));
}
export function toggleTrainingPosition(selected:string[],ids:string[]){
 return selected.some(id=>ids.includes(id))?selected.filter(id=>!ids.includes(id)):[...selected,...ids.filter(id=>!selected.includes(id))];
}
