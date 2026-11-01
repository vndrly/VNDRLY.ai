import {expect,it} from 'vitest';
import {groupTrainingPositions,toggleTrainingPosition} from './training-position-options';

it('combines catalog, title and operational aliases without losing their IDs',()=>{
 const groups=groupTrainingPositions([
  {id:'staff:owner',label:'Owner'}, {id:'title:owner',label:'OWNER'},
  {id:'title:gate supervisor',label:'Gate Supervisor'},
  {id:'operation:gate_supervisor',label:'gate_supervisor (operational role)'},
  {id:'operation:gate supervisor',label:'Gate Supervisor (operational role)'},
  {id:'staff:office',label:'Office Staff'}, {id:'operation:office',label:'office (operational role)'},
  {id:'staff:manager',label:'Office Manager'},
 ]);
 expect(groups.map(g=>g.label)).toEqual(['Gate Supervisor','Office Manager','Office Staff','Owner']);
 expect(groups.find(g=>g.label==='Owner')?.ids).toEqual(['staff:owner','title:owner']);
 expect(groups.find(g=>g.label==='Gate Supervisor')?.ids).toHaveLength(3);
});
it('keeps legacy selections checked and removes only the selected group when toggled off',()=>{
 const ids=['staff:owner','title:owner'];
 expect(toggleTrainingPosition(['title:owner','staff:other'],ids)).toEqual(['staff:other']);
 expect(toggleTrainingPosition(['staff:other'],ids)).toEqual(['staff:other',...ids]);
});
