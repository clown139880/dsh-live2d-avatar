import { MicVAD, NonRealTimeVAD } from '@ricky0123/vad-web'
import type { NonRealTimeVAD as NonRealTimeVADType } from '@ricky0123/vad-web'

export const VAD_ASSET_PREFIX = '/avatar/vad/'
let detectorPromise: Promise<NonRealTimeVADType> | null = null

async function detector(): Promise<NonRealTimeVADType> {
  detectorPromise ??= NonRealTimeVAD.new({
    modelURL: `${VAD_ASSET_PREFIX}silero_vad_legacy.onnx`,
    positiveSpeechThreshold: 0.68,
    negativeSpeechThreshold: 0.48,
    redemptionMs: 320,
    preSpeechPadMs: 120,
    minSpeechMs: 280,
    ortConfig: (ort) => {
      ort.env.wasm.wasmPaths = VAD_ASSET_PREFIX
      ort.env.wasm.numThreads = 1
    },
  })
  return detectorPromise
}

export { MicVAD }

export interface SpeechCheck {
  speech: boolean
  speechMs: number
}

/** Runs locally in ONNX/WASM; recorded audio never leaves the browser for this check. */
export async function containsHumanSpeech(blob: Blob): Promise<SpeechCheck> {
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const vad = await detector()
    ;(vad.frameProcessor as typeof vad.frameProcessor & { reset(): void }).reset()
    vad.frameProcessor.resume()
    let speechMs = 0
    for await (const segment of vad.run(decoded.getChannelData(0), decoded.sampleRate)) {
      speechMs += Math.max(0, segment.end - segment.start)
    }
    return { speech: speechMs >= 280, speechMs }
  } finally {
    await context.close().catch(() => {})
  }
}
