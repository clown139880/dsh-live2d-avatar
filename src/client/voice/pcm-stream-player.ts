const PCM_SAMPLE_RATE = 32_000
const START_BUFFER_SECONDS = 0.06

export interface PcmPlaybackOptions {
  signal: AbortSignal
  onLevel(value: number): void
  onStarted(): void
  onStreamEnd(): void
}

/** Plays ModelDeck raw PCM16/mono output while it is still arriving. */
export class PcmStreamPlayer {
  private context: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sources = new Set<AudioBufferSourceNode>()
  private frame: number | null = null
  private stopped = false
  private scheduledUntil = 0

  async play(body: ReadableStream<Uint8Array>, options: PcmPlaybackOptions): Promise<void> {
    this.context = new AudioContext()
    await this.context.resume()
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.45
    this.analyser.connect(this.context.destination)
    this.scheduledUntil = this.context.currentTime + START_BUFFER_SECONDS
    this.monitorLevel(options.onLevel)

    const abort = () => this.stop()
    options.signal.addEventListener('abort', abort, { once: true })
    let carry: number | null = null
    let started = false
    try {
      const reader = body.getReader()
      while (!this.stopped) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value?.byteLength) continue
        let bytes = value
        if (carry !== null) {
          const joined = new Uint8Array(bytes.byteLength + 1)
          joined[0] = carry
          joined.set(bytes, 1)
          bytes = joined
          carry = null
        }
        if (bytes.byteLength % 2) {
          carry = bytes[bytes.byteLength - 1]
          bytes = bytes.subarray(0, bytes.byteLength - 1)
        }
        if (!bytes.byteLength) continue
        this.schedule(bytes)
        if (!started) {
          started = true
          options.onStarted()
        }
      }
      options.onStreamEnd()
      await this.waitForScheduledAudio()
    } finally {
      options.signal.removeEventListener('abort', abort)
      this.stop()
    }
  }

  async playBuffer(bytes: Uint8Array, options: PcmPlaybackOptions): Promise<void> {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
    await this.play(stream, options)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.frame = null
    for (const source of this.sources) {
      try { source.stop() } catch { /* already stopped */ }
    }
    this.sources.clear()
    void this.context?.close().catch(() => {})
    this.context = null
    this.analyser = null
  }

  private schedule(bytes: Uint8Array): void {
    if (!this.context || !this.analyser || this.stopped) return
    const sampleCount = bytes.byteLength / 2
    const audioBuffer = this.context.createBuffer(1, sampleCount, PCM_SAMPLE_RATE)
    const channel = audioBuffer.getChannelData(0)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let index = 0; index < sampleCount; index += 1) {
      channel[index] = view.getInt16(index * 2, true) / 32768
    }
    const source = this.context.createBufferSource()
    source.buffer = audioBuffer
    source.connect(this.analyser)
    const startAt = Math.max(this.context.currentTime + 0.012, this.scheduledUntil)
    this.scheduledUntil = startAt + audioBuffer.duration
    this.sources.add(source)
    source.addEventListener('ended', () => this.sources.delete(source), { once: true })
    source.start(startAt)
  }

  private monitorLevel(onLevel: (value: number) => void): void {
    const samples = new Uint8Array(this.analyser!.fftSize)
    const tick = () => {
      if (!this.analyser || this.stopped) {
        onLevel(0)
        return
      }
      this.analyser.getByteTimeDomainData(samples)
      let energy = 0
      for (const sample of samples) {
        const normalized = (sample - 128) / 128
        energy += normalized * normalized
      }
      const rms = Math.sqrt(energy / samples.length)
      onLevel(Math.min(1, Math.max(0, (rms - 0.012) * 9)))
      this.frame = requestAnimationFrame(tick)
    }
    this.frame = requestAnimationFrame(tick)
  }

  private async waitForScheduledAudio(): Promise<void> {
    while (!this.stopped && this.context && this.context.currentTime < this.scheduledUntil - 0.01) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
}

