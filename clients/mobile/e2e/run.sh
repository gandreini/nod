#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ ! -x "${JAVA_HOME:-}/bin/java" ]; then
  JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
  [ -x "$JAVA_HOME/bin/java" ] || {
    echo "No Java 17 found. Set JAVA_HOME to a JDK 17 home." >&2
    exit 1
  }
  export JAVA_HOME
fi
case "$(uname -m)" in
  arm64 | aarch64) export E2E_ABI=arm64-v8a ;;
  *) export E2E_ABI=x86_64 ;;
esac
export LANG="${LANG:-en_US.UTF-8}"
export MAESTRO_CLI_NO_ANALYTICS=1
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
platform="${E2E_PLATFORM:-android}"
adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
avdmanager="$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
maestro="${MAESTRO:-$HOME/.maestro/maestro/bin/maestro}"
avd=nod-e2e
image="system-images;android-36;google_apis;$E2E_ABI"
simulator=nod-e2e
iphone="${E2E_IPHONE:-iPhone 17 Pro}"
port="${E2E_PORT:-4321}"
apk=e2e/build/nod-e2e.apk
app=e2e/build/NodE2E.app
serial=""
started=""
server=""
work="$(mktemp -d)"

cleanup() {
  local status=$?
  [ -z "$server" ] || kill "$server" 2>/dev/null || true
  if [ -n "$started" ] && [ "${E2E_KEEP_EMULATOR:-}" != 1 ]; then
    if [ "$platform" = ios ]; then
      xcrun simctl shutdown "$serial" >/dev/null 2>&1 || true
    else
      "$adb" -s "$serial" emu kill >/dev/null 2>&1 || kill "$started" 2>/dev/null || true
    fi
  fi
  if [ "$status" = 0 ]; then rm -rf "$work"; else echo "Logs are in $work." >&2; fi
}
trap cleanup EXIT

stale() {
  [ ! -e "$1" ] || [ "${E2E_BUILD:-}" = 1 ] ||
    [ -n "$(find src assets modules plugins app.json app.config.js package.json pnpm-lock.yaml metro.config.js ../../src/shared ../../src/web/lib ../../src/web/components/icon-drawings.ts -newer "$1" -print -quit)" ]
}

start_android() {
  if stale "$apk"; then
    pnpm run android:e2e
    mkdir -p e2e/build
    cp android/app/build/outputs/apk/release/app-release.apk "$apk"
  fi
  if ! "$emulator" -list-avds | grep -qx "$avd"; then
    echo no | "$avdmanager" create avd --name "$avd" --package "$image" --device pixel_7
  fi
  serial="${E2E_SERIAL:-$("$adb" devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')}"
  if [ -z "$serial" ]; then
    "$emulator" -avd "$avd" -no-window -no-audio -no-boot-anim -no-snapshot-save >"$work/emulator.log" 2>&1 &
    started=$!
    local booted=""
    for _ in $(seq 1 120); do
      serial="$("$adb" devices | awk '/^emulator-[0-9]+\tdevice/{print $1; exit}')"
      if [ -n "$serial" ] && [ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
        booted=1
        break
      fi
      sleep 2
    done
    [ -n "$booted" ] || {
      echo "The emulator did not finish booting in 4 minutes. See $work/emulator.log." >&2
      exit 1
    }
  fi
}

start_ios() {
  if stale "$app"; then
    pnpm run ios:e2e
    mkdir -p e2e/build
    rm -rf "$app"
    cp -R ios/build/Build/Products/Release-iphonesimulator/NodE2E.app "$app"
    touch "$app"
  fi
  serial="$(xcrun simctl list devices -j | node -e 'const d=JSON.parse(require("fs").readFileSync(0)).devices;for(const l of Object.values(d))for(const s of l)if(s.name===process.argv[1]&&s.isAvailable){console.log(s.udid);process.exit()}' "$simulator")"
  [ -n "$serial" ] || serial="$(xcrun simctl create "$simulator" "$iphone")"
  if ! xcrun simctl list devices booted | grep -q "$serial"; then
    xcrun simctl boot "$serial"
    started=ios
  fi
  xcrun simctl bootstatus "$serial" -b >/dev/null
  xcrun simctl keychain "$serial" reset
}

if [ "$platform" = ios ]; then start_ios; else start_android; fi

token="$(openssl rand -hex 32)"
control="$(openssl rand -hex 32)"
NOD_VALIDATION_PORT="$port" NOD_VALIDATION_TOKEN="$token" NOD_VALIDATION_CONTROL_TOKEN="$control" \
  NOD_VALIDATION_DATA="$work/store.json" ../../node_modules/.bin/tsx tool/fake-server.mts >"$work/server.log" 2>&1 &
server=$!
for _ in $(seq 1 50); do grep -q '"ready":true' "$work/server.log" 2>/dev/null && break; sleep 0.2; done
grep -q '"ready":true' "$work/server.log" 2>/dev/null || {
  echo "The fake server did not start within 10 s. Its output:" >&2
  cat "$work/server.log" >&2
  exit 1
}

if [ "$platform" = ios ]; then
  xcrun simctl install "$serial" "$app"
else
  "$adb" -s "$serial" reverse "tcp:$port" "tcp:$port" >/dev/null
  "$adb" -s "$serial" install -r "$apk" >/dev/null
fi
"$maestro" --device "$serial" test e2e \
  -e "ORIGIN=http://127.0.0.1:$port" -e "TOKEN=$token" -e "CONTROL=$control" "$@"
