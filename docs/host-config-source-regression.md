# Host config-source stale-closure regression

> A post-mortem of the "ModelDeck base URL is not configured" bug that survived
> every settings.yaml edit and app restart.

## Symptom

The voice panel and every proxy endpoint (`/avatar/api/health`, `/avatar/api/voices`,
`/avatar/api/asr`, `/avatar/api/tts`) returned:

```
503 { "error": { "code": "not_configured", "message": "ModelDeck base URL is not configured." } }
```

Closing the window, fully restarting TokensCowork, correcting `ttsBaseUrl`
(removing a stray `/v1`), adding `asrBaseUrl`, and setting `ttsVoice` had **no
effect**. Probing the running host showed even `/avatar/api/voices` reported an
**empty** base URL — i.e. the proxy was using the **plugin default config**, not
the user's settings.

## Root cause

`src/index.ts` wired the host-side config via a `let` variable that was **later
reassigned**, while `registerModelDeckProxy` captured that variable **by value**
at registration time:

```ts
// apply()
let configSource = (): Config => config                  // ① default (empty base URLs)
installSettingsSection(ctx, ns, Config, config, {
  setSource: (source) => { configSource = source },      // ③ swap to settings reader (runs LATER)
})
registerModelDeckProxy(ctx, configSource)                // ② captured the CURRENT function value
```

The `@deepseek-ai/dsh-settings` service is injected **asynchronously**
(`ctx.inject(["settings"], ...)`). So the ordering at runtime was:

1. `configSource` starts as `(): Config => config` (schema default, empty base URLs).
2. `installSettingsSection` queues its `ctx.inject(["settings"], ...)` callback — it
   has **not** run yet, so `setSource` has **not** fired.
3. `registerModelDeckProxy(ctx, configSource)` runs and **by value** captures the
   *default* function inside its route handler:
   `handler: (req, res) => handleModelDeckProxy(req, res, configSource(), logger)`.
4. Later, the settings service becomes ready, `setSource` runs and reassigns the
   **outer** `configSource` to `() => scope.get()`. But the proxy handler still
   holds a reference to the **original** default function.

Result: every proxy request called the stale default function and returned an
empty base URL → permanent `503 not_configured`, regardless of what was in
`settings.yaml` and how many times the app was restarted.

### Why "restart didn't help"

The running host kept loading the *same buggy code*. A restart reloaded the bug,
not a fix, so the symptom was identical each time. This is why editing config
files and toggling settings never changed the outcome.

## Fix

Make the config source a **stable closure** over a **mutable ref**, so any
function that captures it by value keeps observing the latest settings:

```ts
// apply()
const configRef: { current: () => Config } = { current: () => config }
const configSource = (): Config => configRef.current()   // stable, always reads the ref
installSettingsSection(ctx, ns, Config, config, {
  setSource: (source) => { configRef.current = source }, // only mutate the ref
})
registerModelDeckProxy(ctx, configSource)                // captures the STABLE accessor
```

Now `setSource` mutates `configRef.current`, and `configSource()` (the same
function object every call) reads the current ref, so the proxy always uses the
resolved settings.

## Secondary configuration notes (also fixed, but not the root cause)

All of these were real but did not explain the persistent 503:

- `ttsBaseUrl: http://localhost:9090/v1` → the proxy appends `/v1/audio/speech`,
  producing a double `/v1/v1/...` → 404. Fixed to `http://localhost:9090`.
- Empty `ttsVoice` → ModelDeck rejects speech requests with HTTP 400 (voice is a
  required field). Set to `megumi_stable`.
- `asrEnabled: true` with no `asrBaseUrl` → the health probe (`/avatar/api/health`)
  reads the ASR URL first, so it reported "not configured". Added `asrBaseUrl`.
- The default `.dsh/home` under `$DSH_HOME` is the real settings location:
  `<home>/settings.yaml` (see `@deepseek-ai/dsh-settings-file`), which **watches**
  and hot-publishes external edits.

## Prevention

- **Stable accessor rule:** any config that is injected asynchronously and passed
  to consumers by value must be a stable closure over a mutable ref, never a
  reassignable `let` captured before the async source is ready.
- **Regression test:** `test/modeldeck-proxy.test.ts` → *"observes config updates
  made after registration (stale-configSource closure regression)"*. It registers
  the proxy with the stable accessor, swaps the ref after registration, and
  asserts the `/health` handler now reaches the configured upstream (HTTP 200),
  proving the handler reflects the latest config.
