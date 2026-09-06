/** Failed saves stay at the head, so history cannot advance past a missing turn. */
export class AskVTranscriptQueue {
  private pending: Array<() => Promise<void>> = [];
  private running: Promise<void> | undefined;
  add(save: () => Promise<void>) { this.pending.push(save); }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      while (this.pending.length) {
        await this.pending[0]();
        this.pending.shift();
      }
    })().finally(() => { this.running = undefined; });
    return this.running;
  }
}
