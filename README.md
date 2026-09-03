# dsh-live2d-avatar

![npm](https://img.shields.io/npm/v/dsh-live2d-avatar.svg)
![Node.js](https://img.shields.io/node/v/dsh-live2d-avatar.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

`dsh-live2d-avatar` adds a switchable Live2D conversation stage to DeepSeek
Harness. It does not create a second chatbot: the native DSH Session, Agent,
memory, tools and message history remain authoritative.

Current first milestone:

- `conversation.view` tab named **形象**
- dialogue and voice-oriented stage layouts
- theme-aware Galgame dialogue stage with the native DSH composer
- adaptive desktop-pet mode: a draggable Web overlay in ordinary DSH and a
  transparent, always-on-top native window in TokensCowork Desktop
- Cubism 2/6 loading through `l2d`
- opt-in, conversation-scoped LLM-authored Live2D expression directives
- native DSH draft and submit actions
- optional experimental push-to-talk/browser-VAD ASR and TTS through ModelDeck
- ModelDeck-discovered voice selection plus explicit TTS language and speed controls
- session-scoped reply cancellation, sentence-timed performances and audio-driven lip sync
- optional local-only Megumi profile

<p align="center">
  <img src="docs/images/stage-haru.png" alt="Haru in the DSH Avatar stage" width="920" />
</p>

## Quick start

Ask a DSH agent to install and verify the plugin:

```text
请帮我安装 dsh-live2d-avatar 插件：
1. 执行 dsh plugin --profile web add dsh-live2d-avatar
2. 执行 dsh plugin --profile web list，确认插件已经安装
3. 重启 dsh web，并告诉我安装结果
```

Or install it manually:

```sh
dsh plugin --profile web add dsh-live2d-avatar
dsh web
```

Open any non-empty conversation and select **形象**. The bundled Haru model
renders without a separate model download. To uninstall:

```sh
dsh plugin --profile web remove dsh-live2d-avatar
```

## Desktop companion

Under ordinary `dsh web`, desktop-pet mode stays inside the browser page as a
draggable overlay. When the same plugin runs in TokensCowork Desktop, it can
open the current avatar in a separate transparent, always-on-top window. The
avatar can therefore remain on the Windows desktop while the main client is
minimized or covered by other applications.

<p align="center">
  <img src="docs/images/desktop-pet.png" alt="A Live2D avatar displayed independently on the Windows desktop" width="920" />
</p>

The detached window still relies on the running TokensCowork Desktop host and
closes when the application exits. This screenshot is a local setup reference:
the wallpaper and Megumi model shown in it are not distributed in the public
npm package. The public package includes Haru as its licensed first-run sample.

## Models

The public package includes Live2D's official Haru sample so a clean install
has a visible first-run experience. Haru is licensed separately under Live2D's
Free Material License and is not covered by this project's MIT license. See
[`assets/models/haru/NOTICE.md`](assets/models/haru/NOTICE.md) before using or
redistributing it.

To use your own model, either copy its complete runtime directory under
`assets/models/<name>/` or set `modelRoot` to an absolute directory visible to
the DSH host. Set `modelEntry` to the `.model.json` or `.model3.json` file
relative to that root. Keep all referenced textures, expressions, physics and
motions in their original relative layout. The settings page provides scale
and X/Y offsets; the stage toolbar also provides quick temporary scaling.
Because files below `modelRoot` are served to the local DSH web client, use a
dedicated model directory rather than a broad or sensitive filesystem root.

<p align="center">
  <img src="docs/images/custom-model-settings.png" alt="Avatar model path and sizing settings" width="920" />
</p>

Unknown user models load with a generic profile: rendering, lip sync and model
authored tap behavior can work without Megumi/Haru-specific mappings. Custom
emotion-to-expression and motion mapping is planned for a later version.

Megumi assets remain local-only. For local development, copy the contents of
the model's `runtime` directory to:

```text
assets/models/megumi/
```

The default entry is:

```text
megumi/katou_01.model.json
```

Then select `megumi/katou_01.model.json`. This keeps proprietary character
assets outside the public plugin package.

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm watch       # 修改 src 后持续重建 lib
```

Install into a DSH Web profile:

```sh
dsh plugin --profile web add link:C:\path\to\dsh-live2d-avatar
dsh --profile web
```

For Desktop development, install this directory as a `link:` dependency in the
`desktop` profile. Keep `pnpm watch` running, then reload the Desktop window
after a client rebuild; host-side changes still require restarting Desktop.

The Desktop pet is an optional runtime enhancement. The host delays loading
`electron` until the local pet RPC is called, and the package does not declare
Electron as a dependency. When Electron is available, Avatar opens the pet in
a transparent frameless window that can move across the Windows desktop and
remembers its size and position. When Electron is absent (for example under
ordinary `dsh web`), the same switch renders the existing draggable in-page
overlay instead. Pet mode and stage mode are explicit alternatives: switching
to the pet immediately replaces the Avatar view with a small status surface,
and both that surface and the pet expose a return-to-stage action. On Desktop,
returning also restores and focuses the TokensCowork window. The optional pet
nameplate is disabled by default and can be enabled in Avatar settings.

The ModelDeck integration contract is documented in
[`docs/modeldeck-voice-api-requirements.md`](docs/modeldeck-voice-api-requirements.md).

The host exposes same-origin endpoints for the browser client:

- `GET /avatar/api/health`
- `GET /avatar/api/capabilities`
- `GET /avatar/api/voices`
- `POST /avatar/api/asr` → ModelDeck `/v1/audio/transcriptions`
- `POST /avatar/api/tts` → ModelDeck `/v1/audio/speech`

ASR and TTS are experimental and disabled by default in the public package.
They currently target the ModelDeck contract used by the maintainers; other
OpenAI-compatible or vendor-specific voice services are not yet promised.
When opting in, set the token in a DSH host environment variable and enter only
that environment-variable name in settings, so the secret is not sent to
browser code. Recorded audio is sent to the configured ASR URL and reply text
is sent to the configured TTS URL.

## Architecture boundary

- DSH owns conversation, Agent, memory and tools.
- The active DSH LLM may own the character performance. The plugin adds its
  control protocol only after conversation-level consent (or an explicit
  global default), then parses it while keeping control data out of the stage.
- This plugin owns visual projection, Live2D rendering and browser audio UX.
- ModelDeck owns stateless ASR/TTS inference.
- Character model assets are separate from the open-source plugin code.

The stage is a session-scoped conversation-view instance, not a background
service. DSH mounts it only for the currently selected session and selected
Avatar tab; unmounting disposes that instance's Live2D engine, microphone,
VAD, TTS queue and audio playback. Other sessions may continue running on the
Host, but they do not each keep a hidden Avatar/TTS player alive in one client
window. The pet surface is currently a single global visual companion and does
not perform ASR, TTS or subscribe to a session by itself.

The retired relationship to Open-LLM-VTuber is recorded in
[`docs/olv-migration-status.md`](docs/olv-migration-status.md).
The completed removal and disk audit are recorded separately in
[`docs/olv-retirement-checklist.md`](docs/olv-retirement-checklist.md).
Planned session-controller, pet interaction and post-OLV improvements are tracked in
[`docs/TODO.md`](docs/TODO.md).

## LLM performance protocol

Prompt extension is disabled on first install. The stage exposes **表情控制**
for the current conversation and explains the effect before enabling it. An
advanced setting can establish a global default, while each conversation can
still override that default. When enabled, the host asks the model to put a
directive immediately before the line it performs:

<p align="center">
  <img src="docs/images/prompt-consent.png" alt="Conversation-scoped expression prompt consent" width="920" />
</p>

```html
<!--live2d:surprise:fast-->居然还有这种情况？
<!--live2d:fun:normal-->不过已经解决了。
```

Expressions are `neutral`, `down`, `angry`, `fun`, `sad`, and `surprise`.
Motion is `none`, `fast`, `normal`, `slow`, `idle-1`, `idle-2`, or `idle-3`.
The 12 emotion motions and three useful idle motions are all addressable. Each
motion remains an authored bundle: its left/right arm parts and arm animation
come from the `.mtn` file and cannot be mixed independently. In voice mode,
Avatar applies a directive when its sentence actually starts playing; in
text-only mode it reacts as the streamed directive arrives. It never infers an
emotion from keywords. A completed historical response opens in its final
directed pose instead of replaying its whole performance.

## Voice interaction

This section describes the optional experimental ModelDeck integration; it is
not required for the 0.1.x visual-stage experience. The settings page offers
manual push-to-talk and continuous browser VAD. The
voice HUD can select a concrete browser audio-input device and shows a live
input meter beside the locally persisted onset threshold. VAD
runs entirely in the browser with configurable onset and silence thresholds;
it adds no Python, PyTorch, CUDA, or local model dependency. Starting to speak
manually cancels the current session-scoped DSH turn as well as pending TTS.
In continuous mode, silence submits the recording and listening resumes after
the reply finishes. While audio is playing, a second echo-cancelled microphone
monitor learns the initial speaker echo floor and automatically interrupts once
real input remains above the adaptive threshold. **打断并说话** remains as a
manual fallback.

TTS starts on complete sentence boundaries, with an optional sufficiently-long
first comma phrase to reduce initial latency. Every queued phrase keeps its own
Live2D directive. A Web Audio analyser drives `PARAM_MOUTH_OPEN_Y`; the
temporary mouth override is removed after playback so authored expressions
remain intact.

The settings page loads available voices from `GET /avatar/api/voices`. TTS
language is always explicit (`zh`, `ja`, `en`, `yue`, or `ko`) rather than
`auto`, and playback speed is configurable from 0.5× to 2.0×.

If recording preflight reports that ModelDeck is unavailable, verify the WSL
gateway before recording again:

```bash
modeldeck status
modeldeck on
```

Avatar checks `/avatar/api/health` before requesting microphone audio, so a
stopped gateway now fails early with an actionable message instead of losing a
completed recording to a generic HTTP 500.

During development, privacy-safe timing events are written through
`POST /avatar/api/client-log` to the DSH host log. They include request IDs,
phase durations, MIME types, byte/character counts and HTTP statuses, but not
recorded audio, recognized text, replies or API keys. Search the current
TokensCowork log for `[voice]` to separate capture/VAD, ASR, LLM-first-text and
TTS latency.

## Haru attribution

This content uses sample data owned and copyrighted by Live2D Inc. The sample
data are utilized in accordance with terms and conditions set by Live2D Inc.
This content itself is created at the author's sole discretion.

The upstream Haru audio files are not included. See the bundled
[`NOTICE.md`](assets/models/haru/NOTICE.md), the
[Free Material License Agreement](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html),
and the [sample-data terms](https://www.live2d.com/en/learn/sample/model-terms/).

Public-release gates and the planned project screenshots are tracked in
[`docs/release-checklist.md`](docs/release-checklist.md).
