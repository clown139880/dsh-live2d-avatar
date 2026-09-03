# ModelDeck Voice API requirements for dsh-live2d-avatar

Status: implementation contract for ModelDeck  
Consumer: `dsh-live2d-avatar` DSH plugin  
Scope: speech recognition and speech synthesis only

## 1. Responsibility boundary

ModelDeck owns model loading, GPU/CPU allocation, inference, concurrency,
health reporting and audio format conversion. The DSH plugin owns microphone
capture, DSH Session submission, sentence segmentation, playback queues,
barge-in policy and Live2D lip sync.

ModelDeck must not own conversation history, Agent state, LLM calls or DSH
memory. Every request is stateless from the API consumer's perspective.

## 2. Common requirements

- HTTP API, reachable from Windows, WSL, LAN or a remote host.
- UTF-8 JSON unless the endpoint explicitly returns audio bytes.
- `GET /health` must never trigger a model download or cold load.
- All inference requests accept an optional `X-Request-ID`; ModelDeck returns
  the same value in the response.
- Optional authentication uses `Authorization: Bearer <token>`.
- Errors use one stable JSON envelope and an appropriate HTTP status.
- ModelDeck must support cancellation when the client disconnects or aborts.
- CORS is optional because the DSH plugin can proxy requests through its host
  half. Direct-browser deployments may enable configurable CORS origins.

Error envelope:

```json
{
  "error": {
    "code": "model_not_loaded",
    "message": "SenseVoice is not ready",
    "retryable": true,
    "details": {}
  }
}
```

## 3. Health and capability discovery

### `GET /health`

Minimum response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "services": {
    "asr": { "status": "ready", "models": ["sensevoice"] },
    "tts": { "status": "ready", "models": ["gpt-sovits"] }
  }
}
```

Allowed service states: `disabled`, `loading`, `ready`, `degraded`, `error`.
The top-level status is `ok`, `degraded` or `error`.

### `GET /v1/audio/capabilities`

Returns selectable providers, models, voices, languages and formats. This is
the source for the plugin settings UI; hard-coded choices are only a fallback.

```json
{
  "asr": {
    "models": [
      {
        "id": "sensevoice",
        "languages": ["auto", "zh", "en", "ja", "ko", "yue"],
        "formats": ["wav", "webm", "ogg", "mp3"],
        "timestamps": ["none", "segment"]
      }
    ]
  },
  "tts": {
    "models": [
      {
        "id": "gpt-sovits",
        "voices": [{ "id": "megumi", "name": "Megumi" }],
        "languages": ["auto", "zh", "en", "ja"],
        "formats": ["wav", "mp3", "opus"],
        "streaming": true
      }
    ]
  }
}
```

## 4. ASR contract

### `POST /v1/audio/transcriptions`

OpenAI-compatible multipart request:

- `file`: required audio file
- `model`: required, initially `sensevoice`
- `language`: optional, default `auto`
- `response_format`: optional, `json` or `verbose_json`
- `temperature`: optional; may be ignored by SenseVoice
- `timestamp_granularities[]`: optional, initially `segment`

Minimum response:

```json
{
  "text": "你好，今天过得怎么样？",
  "language": "zh",
  "duration": 2.84,
  "model": "sensevoice"
}
```

Verbose response may additionally contain:

```json
{
  "segments": [
    { "start": 0.0, "end": 2.84, "text": "你好，今天过得怎么样？" }
  ],
  "emotion": "neutral",
  "events": []
}
```

SenseVoice-specific emotion/event results are optional extensions. The `text`
field is always authoritative and always present on a successful response.

Initial limits:

- Accept mono or stereo input and resample internally.
- Accept at least WAV PCM and browser-recordable WebM/Opus.
- Recommended maximum request duration: 120 seconds.
- Return `413` for oversized input and `415` for unsupported media.
- Warm inference target: first transcription byte within 1.5 seconds for a
  five-second utterance on the deployment's declared reference hardware.

Streaming ASR is explicitly out of MVP scope. A later version may add a WebSocket
or WebRTC contract without changing this endpoint.

## 5. TTS contract

### `POST /v1/audio/speech`

OpenAI-compatible JSON request with ModelDeck extensions:

```json
{
  "model": "gpt-sovits",
  "voice": "megumi",
  "input": "欢迎回来。",
  "language": "auto",
  "response_format": "wav",
  "speed": 1.0,
  "stream": false
}
```

Required fields: `model`, `voice`, `input`. The response body is audio bytes
with the correct `Content-Type`, for example `audio/wav` or `audio/ogg`.

Response headers:

- `X-Request-ID`
- `X-Audio-Duration-Ms` when known
- `X-Sample-Rate` when known
- `X-Model-Warm: true|false`

When `stream: true`, use chunked transfer and begin with a browser-decodable
streaming format. If WAV headers cannot represent an unknown final size, use
Ogg/Opus or raw PCM with an explicit content type and sample-rate headers.

Behavior:

- Empty or whitespace-only input returns `400`.
- Maximum input length is discoverable and must be at least 500 UTF-8
  characters per request.
- Identical concurrent requests may be deduplicated, but cancellation of one
  consumer must not cancel the remaining consumers.
- The service must stop generation promptly after every consumer disconnects.
- Warm non-streaming target: first byte within 2 seconds for a short sentence
  on the deployment's declared reference hardware.

## 6. Concurrency and lifecycle

- ASR and TTS have independent queues and concurrency limits.
- A busy service returns `429` with `retryable: true` and an optional
  `Retry-After` header; it must not hang indefinitely.
- Model cold loading is explicit in health state. Requests during loading may
  wait within the configured timeout or return `503 model_loading`.
- ModelDeck should expose queue depth and inference duration in logs/metrics,
  without logging audio content or full recognized text by default.

## 7. Security and privacy

- Never log bearer tokens.
- Do not persist uploaded microphone audio unless an explicit debug option is
  enabled.
- Debug audio retention must be off by default and document its directory and
  retention policy.
- Redact request text from normal TTS access logs; request id, length and timing
  are sufficient.
- Bind to loopback by default. LAN exposure must be an explicit deployment
  choice and should require authentication.

## 8. Acceptance tests

ModelDeck implementation is accepted when all of the following pass:

1. `/health` reports ASR/TTS readiness without loading a disabled model.
2. `/v1/audio/capabilities` lists SenseVoice and GPT-SoVITS configuration.
3. A browser-recorded WebM/Opus sample transcribes successfully.
4. A WAV sample transcribes successfully and returns non-empty `text`.
5. TTS returns playable WAV for Chinese, English and Japanese short text.
6. An unknown ASR model, TTS model and voice return stable `4xx` errors.
7. Aborting ASR/TTS requests releases their inference/queue work.
8. Concurrent requests respect configured limits and excess work receives
   bounded queueing or `429`.
9. No audio, recognized text or API key is persisted/logged by default.
10. The DSH plugin can point only `baseUrl`, `model`, `voice` and optional
    bearer token at ModelDeck; no ModelDeck-specific filesystem knowledge is
    required.

## 9. Out of scope for the first implementation

- Conversation or memory management
- LLM routing
- VAD and microphone capture
- TTS sentence segmentation and playback queue
- Live2D lip sync
- Streaming ASR
- Speaker enrollment through this API

These remain consumer responsibilities or future separately versioned APIs.
