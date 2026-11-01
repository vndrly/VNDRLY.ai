import { GuidedTrainingProgressSchema, type TrainingDefinition } from '@workspace/api-zod';
import { z } from 'zod/v4';
export const guidedActionSchema = z.discriminatedUnion('action', [
  z.object({ action:z.literal('answer'), questionId:z.string(), optionIds:z.array(z.string()).min(1).max(20) }),
  z.object({ action:z.literal('remediate'), questionId:z.string(), acknowledged:z.literal(true) }),
  z.object({ action:z.literal('advance'), acknowledged:z.literal(true) }),
]);
export function guidedResult(training:TrainingDefinition, raw:unknown, input:unknown, now:string) {
  const definition=training.guided;
  if(!definition) throw Error('This course does not use guided remediation');
  const progress=GuidedTrainingProgressSchema.parse(raw??{}), action=guidedActionSchema.parse(input);
  const step=definition.steps[progress.step];
  if(!step) throw Error('Course already complete');
  let feedback: {questionId:string;correct:boolean;correctOptionIds:string[];explanation:string}|null=null;
  if(action.action==='advance') {
    if(step.questionIds.some(id=>{const r=progress.responses[id];return !r||(!r.correct&&!r.remediatedAt)})) throw Error('Answer and remediate every question before continuing');
    progress.step++;
  } else {
    const next=step.questionIds.find(id=>{const r=progress.responses[id];return !r||(!r.correct&&!r.remediatedAt)});
    if(next!==action.questionId) throw Error('Complete the current question first');
    const question=training.questions.find(q=>q.id===action.questionId);
    if(!question) throw Error('Unknown question');
    const existing=progress.responses[question.id];
    if(action.action==='answer') {
      if(existing) throw Error('Original answer is already recorded; acknowledge the correction');
      if(new Set(action.optionIds).size!==action.optionIds.length||(!question.multiple&&action.optionIds.length!==1)||action.optionIds.some(id=>!question.options.some(o=>o.id===id))) throw Error('Choose permitted answers');
      const correct=action.optionIds.length===question.correctOptionIds.length&&action.optionIds.every(id=>question.correctOptionIds.includes(id));
      progress.responses[question.id]={originalOptionIds:action.optionIds,correctedOptionIds:action.optionIds,correct,answeredAt:now,remediatedAt:null};
    } else {
      if(!existing||existing.correct||existing.remediatedAt) throw Error('No correction is awaiting acknowledgment');
      existing.correctedOptionIds=[...question.correctOptionIds];existing.remediatedAt=now;
    }
    const r=progress.responses[question.id];
    feedback={questionId:question.id,correct:r.correct,correctOptionIds:question.correctOptionIds,explanation:definition.explanations[question.id]};
    if(step.questionIds.every(id=>{const answer=progress.responses[id];return answer&&(answer.correct||answer.remediatedAt)})) progress.step++;
  }
  const rows=Object.values(progress.responses), total=training.questions.length;
  const originalCorrect=rows.filter(r=>r.correct).length, remediatedCorrect=rows.filter(r=>r.correct||r.remediatedAt).length;
  progress.scores={total,originalCorrect,remediatedCorrect,originalPercent:100*originalCorrect/total,remediatedPercent:100*remediatedCorrect/total,remediationCount:rows.filter(r=>r.remediatedAt).length};
  const complete=progress.step===definition.steps.length;
  if(complete&&(rows.length!==total||remediatedCorrect!==total))throw Error('Course questions are incomplete');
  return {progress,feedback,complete};
}
