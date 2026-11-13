/** The existing 10-point training component fits within competence's 20 points.
 * Completion can establish training credit, never the other safety evidence.
 * Do not add it twice when a reviewed category already includes that credit. */
export function applySafetyTrainingScore<T extends {score:number;categories:{id:string;points:number}[]}>(assessment:T,coverage:{required:number;completed:number;provisional:boolean}) {
  const trainingPoints=coverage.required>0?10*Math.min(coverage.required,Math.max(0,coverage.completed))/coverage.required:0;
  const categories=assessment.categories.map(category=>category.id==='competence'?{...category,points:Math.max(category.points,trainingPoints)}:category);
  return {...assessment,categories,score:categories.reduce((sum,c)=>sum+c.points,0),trainingPoints,trainingRequired:coverage.required,trainingCompleted:coverage.completed,trainingProvisional:coverage.provisional};
}
