# Changelog

## 0.2.1

- Restore the GitHub link on the npm package page by adding `repository`,
  `homepage` and `bugs` metadata.
- Switch README images and doc references to absolute GitHub URLs so they
  render on the npm registry page instead of 404ing on relative paths.

## 0.2.0

- The desktop pet now remembers both its window width and screen position, and
  reopens at the same size and spot after an app restart.
- Fixed a host config-source stale-closure bug that kept the ModelDeck proxy on
  the schema-default (empty) base URLs, so `/avatar/api/*` stayed 503
  "ModelDeck base URL is not configured" despite valid settings.yaml values.
- The ModelDeck proxy now falls back between the configured ASR and TTS base
  URLs so a single service serving both roles always answers health probes.
- Desktop pet windows now attach the renderer access header so the
  dsh-plugin-desktop WebServer fence classifies their page/runtime/Live2D
  requests as renderer traffic instead of returning 403.
- The `AdaptiveHeroinePet` retries the desktop `show` RPC while the host is still
  starting and probes for an already-open pet window, avoiding the duplicate
  "web-mode, can't be moved out" fallback on launch.
- Model presentation is now read from the resolved host settings rather than the
  renderer payload, so the pet always shows the configured heroine.
- Added a `preview:models` script that generates and serves a local model
  browser for the extracted Live2D library.

## 0.1.0

- Added the DSH conversation **形象** tab with a bundled Haru Live2D sample.
- Added custom Cubism 2 and Cubism 3+ model loading, scale and position controls.
- Added opt-in, conversation-scoped Live2D performance prompt control.
- Added optional web and TokensCowork desktop companion modes.
- Added experimental, disabled-by-default ModelDeck ASR and TTS integration.
- Added a top-level Avatar settings page with conditional ASR/TTS sections.
