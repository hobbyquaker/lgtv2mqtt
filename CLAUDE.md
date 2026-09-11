@AGENTS.md

## Shell / environment

- **Always run commands through WSL (Debian), never PowerShell.** Use `wsl -d Debian -- bash -lc '<cmd>'`
  (or the Bash tool inside WSL). This avoids problems with binary dependencies (node_modules, native
  addons) and CRLF/LF line-break issues on files in the WSL filesystem.
- The repo lives at `~/repos/lgtv2mqtt/lgtv2mqtt` inside WSL; lgtv2 and lgsb2mqtt are siblings under `~/repos/`.

## Project docs

- The roadmap (analysis, decisions T-n, open questions, next steps) is kept in the maintainer's agents repository,
  checked out as `~/repos/she-agent/roadmap-items/lgtv2mqtt/`; the fleet-wide plan is `~/repos/she-agent/roadmap-readmes/mqtt-interfaces.md`.
