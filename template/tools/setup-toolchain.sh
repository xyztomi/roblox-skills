#!/usr/bin/env bash
# Checks or installs the pinned macOS Roblox toolchain without touching shell
# profiles or unrelated user configuration.
#
#   bash tools/setup-toolchain.sh --check     # report what is missing or wrong
#   bash tools/setup-toolchain.sh --install   # install Rokit and pesde, then check
#   bash tools/setup-toolchain.sh --project   # rokit install, pesde install, type defs
#   bash tools/setup-toolchain.sh --all       # --install then --project
#
# Run --project from a game project root (the folder with rokit.toml). The script
# never reinstalls an existing tool at a different version; it reports the
# mismatch and asks for --force. Downloads are pinned and checksum-verified.

set -euo pipefail

ROKIT_VERSION="1.2.0"
ROKIT_SHA256="eb8e6b4f8026db2b80ad0887c50f342958ecdbacbdeda2fd6028b3c4f774a3ee"
PESDE_VERSION="0.7.4"
PESDE_SHA256="de52939634467e7839b10aa3f258d04ffccda41aa40c14db68fb5601b9baf779"
PESDE_TAG="v0.7.4%2Bregistry.0.2.3"
NODE_MIN=22

MODE="${1:---check}"
FORCE=0
if [ "${2:-}" = "--force" ]; then FORCE=1; fi

PATH="$HOME/.rokit/bin:$HOME/.pesde/bin:/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"
export PATH

problems=0
note() { printf '%s\n' "$*"; }
ok() { printf 'ok    %s\n' "$*"; }
warn() { printf 'warn  %s\n' "$*"; problems=$((problems + 1)); }
fail() { printf 'error %s\n' "$*"; problems=$((problems + 1)); }

have() { command -v "$1" >/dev/null 2>&1; }
version_of() { "$1" --version 2>/dev/null | head -n1 || true; }

check_platform() {
  if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
    fail "this script targets macOS on Apple Silicon (found $(uname -s) $(uname -m))"
  else
    ok "macOS Apple Silicon"
  fi
}

check_node() {
  if ! have node; then
    fail "node is missing; install Node 22 with: brew install node@22"
    return
  fi
  local major
  major=$(node --version | sed 's/^v//' | cut -d. -f1)
  if [ "${major:-0}" -lt "$NODE_MIN" ]; then
    fail "node $(node --version) is older than $NODE_MIN; install node@22"
  else
    ok "node $(node --version)"
  fi
}

check_rokit() {
  if ! have rokit; then
    fail "rokit is missing; run --install (expected $ROKIT_VERSION)"
    return
  fi
  local found
  found=$(version_of rokit | awk '{print $2}')
  if [ "$found" != "$ROKIT_VERSION" ]; then
    fail "rokit $found is installed, expected $ROKIT_VERSION; run --install --force to replace it"
  else
    ok "rokit $found"
  fi
}

check_pesde() {
  if ! have pesde; then
    fail "pesde is missing; run --install (expected $PESDE_VERSION)"
    return
  fi
  local found
  found=$(version_of pesde | awk '{print $2}' | cut -d+ -f1)
  if [ "$found" != "$PESDE_VERSION" ]; then
    fail "pesde $found is installed, expected $PESDE_VERSION; run --install --force to replace it"
  else
    ok "pesde $found"
  fi
}

install_rokit() {
  if have rokit && [ "$FORCE" -ne 1 ]; then
    local found
    found=$(version_of rokit | awk '{print $2}')
    if [ "$found" = "$ROKIT_VERSION" ]; then
      ok "rokit $found (kept)"
      return
    fi
    fail "rokit $found is installed; refusing to replace it without --force"
    return
  fi
  note "installing Rokit $ROKIT_VERSION"
  local dir
  dir=$(mktemp -d)
  curl -fsSL -o "$dir/rokit.zip" "https://github.com/rojo-rbx/rokit/releases/download/v${ROKIT_VERSION}/rokit-${ROKIT_VERSION}-macos-aarch64.zip"
  printf '%s  %s\n' "$ROKIT_SHA256" "$dir/rokit.zip" | shasum -a 256 -c -
  unzip -q "$dir/rokit.zip" -d "$dir"
  "$dir/rokit" self-install
  rm -rf "$dir"
  ok "rokit $(version_of rokit | awk '{print $2}')"
}

install_pesde() {
  if have pesde && [ "$FORCE" -ne 1 ]; then
    local found
    found=$(version_of pesde | awk '{print $2}' | cut -d+ -f1)
    if [ "$found" = "$PESDE_VERSION" ]; then
      ok "pesde $found (kept)"
      return
    fi
    fail "pesde $found is installed; refusing to replace it without --force"
    return
  fi
  note "installing pesde $PESDE_VERSION"
  local dir
  dir=$(mktemp -d)
  curl -fsSL -o "$dir/pesde.zip" "https://github.com/pesde-pkg/pesde/releases/download/${PESDE_TAG}/pesde-${PESDE_VERSION}-macos-aarch64.zip"
  printf '%s  %s\n' "$PESDE_SHA256" "$dir/pesde.zip" | shasum -a 256 -c -
  unzip -q "$dir/pesde.zip" -d "$dir"
  "$dir/pesde" self-install
  rm -rf "$dir"
  ok "pesde $(version_of pesde | awk '{print $2}' | cut -d+ -f1)"
}

project() {
  if [ ! -f rokit.toml ]; then
    fail "no rokit.toml here; run --project from a game project root"
    return
  fi
  local sources
  sources=$(sed -n 's/^[A-Za-z0-9_-]* *= *"\([^"@]*\)@.*"/\1/p' rokit.toml | sort -u)
  if [ -n "$sources" ]; then
    # Trust is idempotent; an already trusted tool prints nothing.
    rokit trust $sources >/dev/null 2>&1 || true
  fi
  rokit install
  ok "rokit tools installed from rokit.toml"
  if [ -f pesde.toml ]; then
    pesde install
    ok "pesde packages installed"
  fi
  if [ ! -f globalTypes.None.d.luau ]; then
    curl -fsSL -o globalTypes.None.d.luau https://luau-lsp.pages.dev/type-definitions/globalTypes.None.d.luau
    ok "Roblox type definitions downloaded"
  else
    ok "Roblox type definitions present"
  fi
}

check_optional() {
  have gh && ok "gh $(gh --version | head -n1)" || warn "gh is missing; install it with: brew install gh"
  have code && ok "VS Code CLI" || warn "the code command is missing; install VS Code or add its bin folder to PATH"
  have opencode && ok "opencode $(opencode --version 2>/dev/null | head -n1)" || warn "opencode is missing; install it from https://opencode.ai/docs/"
  [ -d "/Applications/RobloxStudio.app" ] && ok "Roblox Studio" || warn "Roblox Studio is missing; install it from https://create.roblox.com/landing"
}

check_all() {
  check_platform
  check_node
  check_rokit
  check_pesde
  check_optional
}

case "$MODE" in
  --check | check)
    check_all
    ;;
  --install | install)
    check_platform
    install_rokit
    install_pesde
    check_all
    ;;
  --project | project)
    check_rokit
    check_pesde
    project
    ;;
  --all | all)
    check_platform
    install_rokit
    install_pesde
    project
    check_all
    ;;
  *)
    note "usage: bash tools/setup-toolchain.sh [--check|--install|--project|--all] [--force]"
    exit 2
    ;;
esac

if [ "$problems" -gt 0 ]; then
  note ""
  note "$problems problem(s) found. Fix them, then run this again."
  exit 1
fi
note ""
note "toolchain is ready"
