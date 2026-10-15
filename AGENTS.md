# AGENTS.md

This repository publishes the sp-mp plugin for Stronghold-Protocol. The complete game project root is the authoritative development source; this checkout is its distribution repository. Make implementation changes there, run `node sp-mp/tools/assemble.mjs`, then sync the tested plugin here. Do not assemble against a plugin-only checkout or edit generated payload as an independent source.

Publish to **https://github.com/secret-c/stronghold-protocol-plugins**, branch **main**. The upstream **sganggs/Stronghold-Protocol** is only the game baseline. Preserve this repository's history and RELATED-REPOS.md. Keep the standard `sp-mp/` payload and the legacy top-level payload at the same version. Required tracked directories are `files/`, `base/`, `client/`, `tools/` and documentation, in both layouts. Never commit game assets, screenshots, dependencies, release installs, personal configuration or generated public/shared/sim union directories.

The launcher requires an existing game 0.2.6 installation and Node.js >= 22.15. It builds union directories automatically; players do not run assemble. Keep deterministic simulation code and the upstream non-commercial and licensing requirements. Never hand-edit generated game data.

## Safe PowerShell submission

Use the configured Git identity. Inspect the staged source and verify `permissions.push` on the correct repository before a normal fast-forward push. Never overwrite unrelated history or force-push.

```powershell
$env:GH_TOKEN = (gh-token)
if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) { throw 'GitHub credential unavailable' }
$env:GIT_TERMINAL_PROMPT = '0'
$credentialHelper = '!f() { if [ "$1" = get ]; then printf "%s\n" "username=x-access-token" "password=$GH_TOKEN"; fi; }; f'
try {
  git remote -v
  git status --short
  git diff --cached --stat
  # Stage and commit the reviewed plugin payload before this push.
  # Here origin must be secret-c/stronghold-protocol-plugins, and HEAD must descend from its main.
  git -c credential.helper= -c "credential.helper=$credentialHelper" push origin HEAD:refs/heads/main
  if ($LASTEXITCODE -ne 0) { throw 'GitHub push failed' }
} finally {
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
}
```

Git does not consume GH_TOKEN automatically; the temporary helper reads it only for get requests and persists nothing. Never print or save the token or its fragments, embed it in arguments/URLs/Git config, or enable authentication tracing. If gh-token reports `missing protocol field`, send the same GitHub `credential fill` request through explicitly redirected UTF-8 stdin in a child process and capture its output only in memory; do not change global credential scripts or enumerate unrelated credentials. Network operations should have a 20-30 second timeout.
