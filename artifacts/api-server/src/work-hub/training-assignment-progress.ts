import type { AssignmentMetadata } from "@workspace/api-zod";

type CourseSummary = { lessonCount: number; questionCount: number; guidedStepCount: number; completionMode: string | null };

export function trainingAssignmentPercent(assignment: AssignmentMetadata, course: CourseSummary, examPending: boolean): number {
  if (assignment.status === "completed" && !examPending) return 100;
  const progress = assignment.progress;
  const lessons = course.completionMode === "quiz" ? 0 : Number(course.lessonCount);
  const questions = course.completionMode === "checkoff" ? 0 : Number(course.questionCount);
  const steps = Number(course.guidedStepCount);
  const total = (steps || lessons + questions) + (examPending ? 1 : 0);
  const done = steps ? Math.min(progress.guided?.step ?? 0, steps)
    : Math.min(new Set(progress.lessonIds).size, lessons)
      + Math.min(Object.values(progress.answers).filter(answers => answers.length).length, questions);
  return total ? Math.min(99, Math.max(0, Math.floor(done / total * 100))) : 0;
}
