import { stableArguments } from "./askv-idempotency";
import { canonicalOperationToolName } from "./chatgpt-operation-tools";

export type VProvider = "anthropic" | "openai";
export class VProviderError extends Error {
  constructor(message: string, readonly retryable: boolean) { super(message); this.name = "VProviderError"; }
}

/** Approval is server-resolved company policy. A model/client cannot add a provider. */
export function selectVProvider(message: string, approved: readonly VProvider[], openaiAvailable: boolean): VProvider {
  const available = approved.filter(provider => provider !== "openai" || openaiAvailable);
  if (!available.length) throw new VProviderError("No approved V provider is available", false);
  const analytical = /\b(analy[sz]e|compare|summari[sz]e|draft|proofread|translate)\b/i.test(message);
  return analytical && available.includes("openai") ? "openai" : available.includes("anthropic") ? "anthropic" : available[0];
}
export function shouldVConsult(message: string): boolean { return /\b(double[- ]check|cross[- ]check|second opinion|independent review)\b/i.test(message); }
export function savedVTaskMutationBlock(task: { taskStatus?: string; completed: Array<{ toolNames: string[] }> }, name: string): string | null {
  if (task.taskStatus === "completed" || task.taskStatus === "cancelled") return "Saved plan is terminal; no mutation may restart it.";
  if (task.completed.some(step => step.toolNames.some(tool => canonicalOperationToolName(tool) === canonicalOperationToolName(name))))
    return "A completed saved-plan step uses this operation. Read its canonical result and use the existing plan controls before another action; V must not repeat completed work.";
  return null;
}

/** One turn shares its transcript and canonical executor. Provider adapters never execute tools.
 * This cache only joins attempts within a turn; runBoundTypedAskVTool remains the durable
 * confirmation/idempotency/canonical authority across HTTP retries and process restarts.
 */
export class CooperativeVTurn {
  private provider: VProvider;
  private fallbackUsed = false;
  private permissionDenied = false;
  private domainFailure = false;
  private calls = 0;
  private totalTokens = 0;
  private alerted = false;
  private readonly mutations = new Map<string, Promise<string>>();
  private readonly completed = new Map<string, string>();
  private readonly remaining = new Map<string, string>();
  constructor(private readonly options: { first: VProvider; approved: readonly VProvider[]; openaiAvailable: boolean; maxCalls?: number; alertTokens?: number }) {
    if (!options.approved.includes(options.first) || options.first === "openai" && !options.openaiAvailable) throw new VProviderError("Provider is not approved or available", false);
    this.provider = options.first;
  }
  get currentProvider(): VProvider { return this.provider; }
  get consultationCount(): number { return this.fallbackUsed ? 1 : 0; }
  async consult<T, R>(context: T, providers: Record<VProvider, (context: T) => Promise<R>>): Promise<R | null> {
    const alternate = this.provider === "anthropic" ? "openai" : "anthropic";
    if (this.fallbackUsed || this.permissionDenied || this.domainFailure || !this.options.approved.includes(alternate) || alternate === "openai" && !this.options.openaiAvailable) return null;
    if (++this.calls > (this.options.maxCalls ?? 7)) throw new VProviderError("V task consultation limit reached; resume remaining work", false);
    this.fallbackUsed = true;
    this.provider = alternate;
    return providers[alternate](context);
  }
  async round<T, R>(context: T, providers: Record<VProvider, (context: T) => Promise<R>>): Promise<R> {
    const request = async (provider: VProvider) => {
      if (++this.calls > (this.options.maxCalls ?? 7)) throw new VProviderError("V task consultation limit reached; resume remaining work", false);
      return providers[provider](context);
    };
    try { return await request(this.provider); }
    catch (error) {
      const alternate = this.provider === "anthropic" ? "openai" : "anthropic";
      if (!(error instanceof VProviderError) || !error.retryable || this.permissionDenied || this.domainFailure || this.fallbackUsed ||
          !this.options.approved.includes(alternate) || alternate === "openai" && !this.options.openaiAvailable) throw error;
      this.fallbackUsed = true;
      this.provider = alternate;
      return request(alternate);
    }
  }
  observeToolResult(output: string): void {
    try {
      const result = JSON.parse(output) as { error?: unknown; code?: string; errorCode?: string; status?: number; ok?: boolean; requiresConfirmation?: boolean };
      if (result.requiresConfirmation !== true && (result.error || result.ok === false)) this.domainFailure = true;
      if (result.status === 401 || result.status === 403 || /(?:auth\.|permission|forbidden|unauthorized|access_denied|scope)/i.test(String(result.code ?? result.errorCode ?? "")) ||
          /(?:forbidden|unauthorized|permission denied|not authorized)/i.test(String(result.error ?? ""))) this.permissionDenied = true;
    } catch { /* Unstructured results cannot grant new authority. */ }
  }
  async execute(name: string, input: unknown, mutating: boolean, executor: () => Promise<string>): Promise<string> {
    const fingerprint = stableArguments([name, input]);
    const prior = mutating ? this.mutations.get(fingerprint) : undefined;
    if (prior) return prior;
    const operation = (async () => {
      this.remaining.set(fingerprint, name);
      const output = await executor();
      this.observeToolResult(output);
      try {
        const value = JSON.parse(output) as { error?: unknown; ok?: boolean; requiresConfirmation?: boolean };
        if (!value.error && value.ok !== false && value.requiresConfirmation !== true) { this.completed.set(fingerprint, name); this.remaining.delete(fingerprint); }
      } catch { if (!mutating) { this.completed.set(fingerprint, name); this.remaining.delete(fingerprint); } }
      return output;
    })();
    // Keep even a rejected promise: transport ambiguity must go through canonical
    // reconciliation on explicit resume, never another model's second write.
    if (mutating) this.mutations.set(fingerprint, operation);
    return operation;
  }
  recordUsage(usage: { inputTokens: number; outputTokens: number }) {
    this.totalTokens += Math.max(0, usage.inputTokens) + Math.max(0, usage.outputTokens);
    const alert = !this.alerted && this.totalTokens >= (this.options.alertTokens ?? 12_000);
    if (alert) this.alerted = true;
    return { provider: this.provider, ...usage, totalTokens: this.totalTokens, alert, consultationCount: this.consultationCount };
  }
  recovery() {
    return { completed: [...this.completed.values()], remaining: [...this.remaining.values()], needed: this.permissionDenied ? "Current permission is required; changing engines cannot grant access." : "Read the saved action result before resuming uncertain work. Completed changes must not be repeated." };
  }
}
