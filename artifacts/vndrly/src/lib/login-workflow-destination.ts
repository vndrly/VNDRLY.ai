/** Continue only known local workflow screens; never consume an arbitrary return URL. */
export function loginWorkflowDestination(path: string, search: string): string {
  const workflow = /^\/tickets\/[1-9]\d*$/.test(path) || /^\/work-hub(?:\/[a-zA-Z0-9_-]+)*\/?$/.test(path);
  if (!workflow || search.length > 2048 || (search && !search.startsWith("?")) || /[\r\n\\]/.test(search)) return "/";
  return path + search;
}
