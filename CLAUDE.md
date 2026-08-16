@AGENTS.md

## Shell / environment

- **Always run commands through WSL (Debian), never PowerShell.** Use `wsl -d Debian -- bash -lc '<cmd>'`
  (or the Bash tool inside WSL). This avoids problems with binary dependencies (node_modules, native
  addons) and CRLF/LF line-break issues on files in the WSL filesystem.
- The repo lives at `~/repos/lgtv2mqtt/lgtv2mqtt` inside WSL; lgtv2 and lgsb2mqtt are siblings under `~/repos/`.

## Project docs

- See ROADMAP.md for analysis, decisions (T-n) and next steps; the fleet-wide plan lives in ../lgsb2mqtt/ROADMAP.md.
