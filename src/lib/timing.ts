/** High-resolution step timer for inbox watch path logs. */
export class StepTimer {
  private readonly t0 = Date.now();
  private last = this.t0;
  private readonly marks: Record<string, number> = {};
  private readonly deltas: Record<string, number> = {};

  mark(name: string) {
    const now = Date.now();
    this.marks[name] = now - this.t0;
    this.deltas[`delta_${name}`] = now - this.last;
    this.last = now;
  }

  snapshot(): Record<string, number> {
    return {
      ...this.marks,
      ...this.deltas,
      total_ms: Date.now() - this.t0,
    };
  }
}
