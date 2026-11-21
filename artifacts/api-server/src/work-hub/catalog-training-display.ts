import {vndrlyUCatalog} from '../data/vndrly-u-catalog';
import { trainingDisplaySummary } from './repository-certifications';
import type { catalogTrainingState } from './catalog-training';

export function catalogTrainingDisplay(state: Awaited<ReturnType<typeof catalogTrainingState>>, userId: number) {
  const courseStep = (course: typeof state.courses[number]) => ({
    id:course.id,title:course.title,type:'course',complete:course.percent===100,
    href:`/work-hub/course/${course.id}`,percent:course.percent,
  });
  const programs = [...state.programs].sort((a,b)=>Number(!!b.parentProgramId)-Number(!!a.parentProgramId));
  const items = programs.map(p=>({id:p.id,title:p.title,userId,augmented:false,standalone:false,
    complete:p.complete,steps:(vndrlyUCatalog.programs.find(program=>program.id===p.id)?.courseIds ?? p.courses.map(c=>c.id)).map(id=>{const course=p.courses.find(c=>c.id===id);return course?courseStep(course):{id,title:vndrlyUCatalog.courses.find(c=>c.id===id)?.title??id,type:'course',complete:false,href:`/work-hub/course/${id}`,percent:0};})}));
  const grouped = new Set(programs.flatMap(p=>p.courses.map(c=>c.id)));
  for (const course of state.courses.filter(c=>!grouped.has(c.id))) items.push({
    id:course.id,title:course.title,userId,augmented:false,standalone:true,complete:course.percent===100,steps:[courseStep(course)],
  });
  return items;
}

export function combinedTrainingDisplay(legacy: Parameters<typeof trainingDisplaySummary>[0], state: Awaited<ReturnType<typeof catalogTrainingState>>, userId:number) {
  return trainingDisplaySummary([...catalogTrainingDisplay(state,userId),...legacy]);
}
