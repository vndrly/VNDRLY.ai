/** Keep catalog headings focused on the subject rather than production labels. */
export function catalogTitle(title: string): string {
  return title
    .replace(/\s+[—–-]\s+(?:learner and delivery guide|(?:complete\s+)?learner(?: and tester)? coursebook)\s*$/i, '')
    .replace(/^Integrated learner exercise:\s*/i, 'Practical exercise: ');
}
