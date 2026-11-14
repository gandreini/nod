#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ ! -x "${JAVA_HOME:-}/bin/java" ]; then
  export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-17.0.19/Contents/Home"
fi
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
avdmanager="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
maestro="${MAESTRO:-$HOME/.maestro/maestro/bin/maestro}"
avd=nod-e2e
image="system-images;android-36;google_apis;arm64-v8a"
port="${E2E_PORT:-4321}"
apk=e2e/build/nod-e2e.apk

if [ ! -f "$apk" ] || [ "${E2E_BUILD:-}" = 1 ]; then
  pnpm run android:e2e
  mkdir -p e2e/build
  cp android/app/build/outputs/apk/release/app-release.apk "$apk"
fi

if ! "$emulator" -list-avds | grep -qx "$avd"; then
  echo no | "$avdmanager" create avd --name "$avd" --package "$image" --device pixel_7
fi

serial="$("$adb" devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')"
started=""
if [ -z "$serial" ]; then
  "$emulator" -avd "$avd" -no-window -no-audio -no-boot-anim -no-snapshot-save >/tmp/nod-e2e-emulator.log 2>&1 &
  started=$!
  for _ in $(seq 1 120); do
    serial="$("$adb" devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')"
    [ -n "$serial" ] && [ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
    sleep 2
  done
  [ -n "$serial" ] || { echo "The emulator did not start. See /tmp/nod-e2e-emulator.log." >&2; exit 1; }
fi

data="$(mktemp -d)"
token="$(openssl rand -hex 32)"
control="$(openssl rand -hex 32)"
NOD_VALIDATION_PORT="$port" NOD_VALIDATION_TOKEN="$token" NOD_VALIDATION_CONTROL_TOKEN="$control" \
  NOD_VALIDATION_DATA="$data/store.json" ../../node_modules/.bin/tsx tool/fake-server.mts >"$data/server.log" 2>&1 &
server=$!
cleanup() {
  kill "$server" 2>/dev/null || true
  rm -rf "$data"
  if [ -n "$started" ] && [ "${E2E_KEEP_EMULATOR:-}" != 1 ]; then "$adb" -s "$serial" emu kill >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
for _ in $(seq 1 50); do grep -q '"ready":true' "$data/server.log" 2>/dev/null && break; sleep 0.2; done

"$adb" -s "$serial" reverse "tcp:$port" "tcp:$port" >/dev/null
"$adb" -s "$serial" install -r "$apk" >/dev/null
"$maestro" --device "$serial" test e2e \
  -e "ORIGIN=http://127.0.0.1:$port" -e "TOKEN=$token" -e "CONTROL=$control" "$@"
