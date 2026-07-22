export class FrameRingBuffer<T extends { timestamp?: number }> {
  private readonly frames: Array<{ timestamp: number; value: T }> = []

  constructor(private readonly retentionMs: number) {
    if (!Number.isFinite(retentionMs) || retentionMs <= 0) {
      throw new Error('FrameRingBuffer retentionMs must be positive.')
    }
  }

  push(value: T, timestamp = value.timestamp ?? Date.now()): void {
    this.frames.push({ timestamp, value })
    this.prune(timestamp)
  }

  values(now = Date.now()): T[] {
    this.prune(now)
    return this.frames.map(frame => frame.value)
  }

  latest(): T | undefined {
    return this.frames.at(-1)?.value
  }

  get size(): number {
    return this.frames.length
  }

  clear(): void {
    this.frames.length = 0
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs
    let removeCount = 0
    while (
      removeCount < this.frames.length &&
      this.frames[removeCount]!.timestamp < cutoff
    ) {
      removeCount += 1
    }
    if (removeCount > 0) this.frames.splice(0, removeCount)
  }
}
