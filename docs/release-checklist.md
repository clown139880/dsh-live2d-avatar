# Public release checklist

## Required

- [ ] A clean checkout passes `pnpm install --frozen-lockfile`, `pnpm check`,
  `pnpm build`, and `pnpm pack`.
- [x] Installing the packed tarball into a clean DSH profile opens the Avatar
  tab and renders the bundled Haru sample without local files.
- [x] The default install makes no network request to ModelDeck and does not
  inject the Live2D performance prompt into any conversation.
- [ ] Enabling the prompt for one conversation affects that conversation only;
  disabling it removes the effect on the next model turn.
- [ ] Custom Cubism 2 `.model.json` and Cubism 3+ `.model3.json` models load
  from both the packaged model directory and a configured absolute root.
- [ ] Model scale and X/Y offsets work for the stage, web pet, and desktop pet.
- [x] Haru attribution and separate Live2D license notices are present in the
  npm tarball and README.
- [x] ModelDeck URLs reject malformed, credential-bearing, and non-http(s)
  values before a host request is attempted.
- [x] Public naming is Avatar, with conversation tabs labeled
  `对话 / 轨迹 / 形象`.
- [x] Avatar uses a top-level `settings.section`; ASR/TTS details and shared
  credentials stay hidden until their corresponding opt-in switch is enabled.

## Project images

- [x] Add `docs/images/stage-haru.png` showing the first-run stage.
- [x] Add `docs/images/prompt-consent.png` showing the per-conversation consent.
- [x] Add `docs/images/custom-model-settings.png` showing model path and sizing.
- [x] Add `docs/images/desktop-pet.png` if the desktop pet is advertised above
  the fold.

Voice-loop and third-party ASR/TTS compatibility are explicitly not release
gates for 0.1.0. The ModelDeck integration remains experimental and opt-in.

## Automated verification (2026-09-03)

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm typecheck`
- [x] `pnpm test` (33 tests)
- [x] `pnpm build`
- [x] `pnpm audit --prod` (no known vulnerabilities)
- [x] Packed tarball installs in an empty npm consumer project.
- [x] Installed package contains the host, client and pet bundles, Haru runtime
  assets and Haru `NOTICE.md`.
- [x] Installed package excludes local-only Megumi assets and Haru audio files.
- [x] `dsh plugin --profile web add <tarball>` succeeds in a newly initialized
  DSH home without dependency build approval, and the bundled Haru renders in
  the real Avatar conversation tab.
- [x] Browser verification confirms the default Haru framing shows the full
  model at scale `1.0`, Y offset `0.1`, including while subtitles are visible.
- [x] Browser verification confirms no `/avatar/api/*` resource is requested
  while ASR and TTS remain disabled.

The unchecked items above still require release-candidate testing in a clean,
real DSH/TokensCowork profile; this automated tarball test is not a substitute
for that integration pass.
