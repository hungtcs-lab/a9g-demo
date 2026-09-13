#!/usr/bin/env bash
# One-step build for the A9G project.
#
#   ./build.sh <app> [debug|release]         build our own code in apps/<app>
#   ./build.sh demo <name> [debug|release]   build an SDK demo in GPRS_C_SDK/demo/<name>
#   ./build.sh clean <app|demo>              remove build outputs
#
# The SDK only builds projects inside its own tree, so apps/<app> is symlinked
# into it as GPRS_C_SDK/demo/<app>. The entry function is <app>_Main().
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
sdk="$root/GPRS_C_SDK"
export CSDTK_ROOT="$root/GPRS_CSDTK/CSDTK"

usage() {
  sed -n '3,6p' "$0" | sed 's/^# \{0,1\}//'
  echo
  echo "apps: $(ls "$root/apps" 2>/dev/null | tr '\n' ' ')"
}

[[ $# -ge 1 ]] || { usage; exit 2; }

[[ -f "$sdk/Makefile" && -d "$CSDTK_ROOT" ]] || {
  echo "GPRS_C_SDK / GPRS_CSDTK missing, run: git submodule update --init" >&2
  exit 1
}

# The SDK repo stores these without the executable bit, and a fresh clone
# would lose a local chmod, so restore it on every build.
chmod +x "$sdk"/platform/compilation/{elfCombine.pl,lodCombine.pl} \
  "$sdk"/platform/compilation/fota/linux/{fotacreate,fotapack}

case "$1" in
  -h|--help|help)
    usage
    exit 0
    ;;
  clean)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    rm -rf "$sdk/build/$2" "$sdk/hex/$2" "$sdk/build/$2"_*_build.log
    echo "cleaned $2"
    exit 0
    ;;
  demo)
    [[ $# -ge 2 ]] || { usage; exit 2; }
    name="$2"
    profile="${3:-debug}"
    ;;
  *)
    name="$1"
    profile="${2:-debug}"
    [[ -d "$root/apps/$name" ]] || { echo "no such app: apps/$name" >&2; usage; exit 2; }
    link="$sdk/demo/$name"
    if [[ ! -e "$link" && ! -L "$link" ]]; then
      ln -s "../../apps/$name" "$link"
      # Keep the SDK checkout clean (works whether .git is a dir or a submodule gitfile)
      exclude="$(git -C "$sdk" rev-parse --path-format=absolute --git-path info/exclude)"
      mkdir -p "$(dirname "$exclude")"
      grep -qxF "/demo/$name" "$exclude" 2>/dev/null || echo "/demo/$name" >> "$exclude"
    elif [[ ! -L "$link" ]]; then
      echo "GPRS_C_SDK/demo/$name exists and is not a link to apps/$name" >&2
      exit 1
    fi
    ;;
esac

# Toolchain environment (see GPRS_C_SDK/README.md)
TOOLCHAIN_ROOT="$(bash "$CSDTK_ROOT/prepare-runtime-links.sh" --tool-root)"
RUNTIME_LIB_ROOT="$(bash "$CSDTK_ROOT/prepare-runtime-links.sh" --runtime-lib)"
export PATH="$TOOLCHAIN_ROOT/bin:$PATH"
export LD_LIBRARY_PATH="$RUNTIME_LIB_ROOT:$TOOLCHAIN_ROOT/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

bash "$sdk/scripts/build-sdk.sh" demo "$name" "$profile"

shopt -s nullglob
small="$sdk/hex/$name/${name}_flash_${profile}.lod"
full=("$sdk/hex/$name/${name}_B"*"_${profile}.lod")
echo
echo "Flash with coolwatcher (tools/coolwatcher/usr/bin/coolwatcher, profile 8955):"
[[ -f "$small" ]] && echo "  daily : $small  ($(du -h "$small" | cut -f1))"
[[ ${#full[@]} -gt 0 ]] && echo "  full  : ${full[0]}  ($(du -h "${full[0]}" | cut -f1), first time / after SDK update)"
exit 0
