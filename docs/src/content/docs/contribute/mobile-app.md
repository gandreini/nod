---
title: Mobile app
description: Build the Android and iOS app in clients/mobile, run its unit and end-to-end tests, and know what each test covers.
sidebar:
  order: 9
---

The Android and iOS app in `clients/mobile` is an Expo client for a Nod server. It connects with the server address and `NOD_AUTH_TOKEN`, and talks to the same API as the web app.

The phone keeps the address and token in the system keychain and voice messages that haven't reached the server yet. A file Nod sent is downloaded again each time it's opened in another app, and those downloads are deleted when the app starts, when the owner disconnects and when the server refuses the token. Disconnecting also deletes the waiting voice messages; a refused token keeps them, so they still go out after reconnecting to the same server.

In Apps, **Connect** and **Sign in again** call the same connect route as the web app and open the page that route returns in a browser sheet: the service's sign-in, or Nod's own setup page for an app that needs an address or a key. That page uses the browser's own sign-in to Nod. The list reloads when the sheet closes or the app comes back to the front.

Every request has a deadline: 30 seconds, 3 minutes for a voice message and 10 minutes for a file upload. A voice message that misses it is sent again under the same ID, with its reason under the bubble and a **Delete** next to it. A message that could not be sent stays where it was written, with **Try again** and **Delete**, instead of moving below newer messages. While a message waits to be sent again the chat does not show Nod as working. The live connection reopens when the server's keepalive hasn't arrived for 45 seconds, and waiting voice messages are sent again when it does.

When Nod hands the owner its browser, the app opens the live page in a bottom panel and leaves an **Open browser** card under Nod's message. A tap on the page clicks it, a drag scrolls it, and the text bar types into it. Closing the panel keeps the handoff open; **Return to Nod** ends it.

The short version: `pnpm test` runs the fast tests against a fake Nod server, and `pnpm e2e` and `pnpm e2e:ios` run the app itself on an Android emulator or an iPhone simulator against the same fake server. Neither ever touches a real server, a real phone or a live model.

## Build the app

Run these from `clients/mobile`. Each variant has its own package, so they can sit side by side on one device.

| Command                | App     | Package                 | Use it for                                                                               |
| ---------------------- | ------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm android:release` | Nod     | `com.gandreini.nod`     | Everyday use. The code is bundled, and only HTTPS servers are allowed.                   |
| `pnpm android:dev`     | Nod Dev | `com.gandreini.nod.dev` | Development with Metro and fast reload.                                                  |
| `pnpm android:e2e`     | Nod E2E | `com.gandreini.nod.e2e` | End-to-end tests only. Allows plain HTTP so it can reach the fake server on `127.0.0.1`. |

Each command regenerates the `android` folder for its variant, then builds an arm64 APK in `android/app/build/outputs/apk`.

On iOS the app uses the same identifiers as bundle IDs. `pnpm ios:e2e` regenerates the `ios` folder for Nod E2E, installs its pods and builds it for the iPhone simulator in `ios/build`. It needs Xcode and CocoaPods. The app is iPhone only; on an iPad it runs in a scaled iPhone window.

For TestFlight, `APPLE_TEAM_ID=<team> pnpm ios:release` regenerates the `ios` folder for Nod and archives a signed build in `ios/build/Nod.xcarchive`, and `pnpm ios:upload` signs it for distribution and uploads it to App Store Connect. Both need an Apple account signed in to Xcode. Raise `ios.buildNumber` in `app.json` before each new upload.

## Run the tests

```sh title="Terminal"
pnpm test
```

Unit and delivery tests. They take about a second and need nothing but Node.

```sh title="Terminal"
pnpm e2e
```

End-to-end tests with [Maestro](https://maestro.mobile.dev). The script creates an Android emulator called `nod-e2e` if it is missing, starts the fake server with fresh random tokens, installs Nod E2E and runs every flow in `e2e/flows`. It stops the server and the emulator at the end. It targets the emulator by name, so a phone connected over `adb` is left alone.

```sh title="Terminal"
pnpm e2e:ios
```

The same flows on an iPhone simulator called `nod-e2e`, created from an iPhone 17 Pro if it is missing. `E2E_BUILD`, `E2E_KEEP_EMULATOR` and `E2E_PORT` work the same way. The iOS Keychain keeps the saved connection when the app is reinstalled, so the script resets the simulator's Keychain before each run.

The first Android run needs the Android command-line tools, the `system-images;android-36;google_apis` image for your Mac (`arm64-v8a` on Apple silicon, `x86_64` otherwise), a JDK 17 (from `JAVA_HOME`, else `/usr/libexec/java_home -v 17`) and the Maestro CLI. Set `E2E_BUILD=1` to rebuild Nod E2E first, and `E2E_KEEP_EMULATOR=1` to leave the emulator running between runs. When a run fails, the script keeps the emulator and fake server logs and prints their folder.

## The fake server

`tool/fake-server.mts` is a small Nod stand-in with synthetic data. It uses the server's real access check, so a wrong token gets the same 401 as a real Nod. Tests drive it through `/fixture/*` routes that need a separate control token.

It can also fail on purpose. `/fixture/audio-faults` makes the next voice messages lose their answer on the way back, stop after the server claimed them, be cancelled like a Stop, meet a busy server, or get no answer at all. That is how the tests check that a voice message is never sent twice and never lost.

`/fixture/handoff` opens or closes a browser handoff. While it is open, the fake server streams two small synthetic page images and counts the clicks, scrolls and keys it receives.

### Demo mode

`pnpm demo:server` runs the fake server as a public demo, for App Store review. Everything in it is synthetic: on first start it seeds an English sample conversation (Markdown, questions, files, an image and a voice note) and sample apps, schedules, usage and vault entries. Every message gets a scripted reply after about 1.5 seconds that walks through a question card, a file and Nod's browser, and Stop cancels it. It never calls a model or any other service.

| Variable                       | Meaning                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `NOD_VALIDATION_PORT`          | Port to listen on.                                                                                                                               |
| `NOD_VALIDATION_TOKEN`         | The token the reviewer types on the connect screen, so treat it as their password. At least 43 letters, digits, `-` or `_`, as the app requires. |
| `NOD_VALIDATION_DATA`          | JSON file that keeps the conversation across restarts, capped at the last 200 messages. Delete it and restart to reset the demo.                 |
| `NOD_VALIDATION_HOST`          | Address to bind, `127.0.0.1` by default. Keep it behind an HTTPS reverse proxy.                                                                  |
| `NOD_VALIDATION_ORIGIN`        | The public address the app connects to, such as `https://demo.example.com`. Requests for any other host are refused.                             |
| `NOD_VALIDATION_CONTROL_TOKEN` | Optional. Without it every `/fixture/*` route answers 401.                                                                                       |

```sh
NOD_VALIDATION_PORT=4400 NOD_VALIDATION_TOKEN="$(openssl rand -hex 32)" \
  NOD_VALIDATION_DATA=/srv/nod-demo/store.json NOD_VALIDATION_ORIGIN=https://demo.example.com \
  pnpm demo:server
```

The proxy must pass the original `Host` and not buffer `/api/events` or `/api/browser-handoff/stream`. Uploaded files stay on the demo server and are served only with the token.

## What the tests cover

| Area             | Test                                                  | What it would catch                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connecting       | `tests/connection.test.ts`, flow 1                    | A token sent to a plain-HTTP or credentialed address, a refused token treated as accepted.                                                                                                         |
| Messages         | `tests/chat.test.ts`, flow 2                          | A message shown twice or lost when history and live updates overlap, or an unsent message that jumps below newer ones.                                                                             |
| Voice delivery   | `tests/delivery.test.ts`                              | A voice message sent twice after a lost answer, a Stop ignored, a delivered message resent after a restart, a send the server never answers left waiting forever, a discarded message sent anyway. |
| Attachments      | `tests/attachments.test.ts`, `tests/delivery.test.ts` | A file over 90 MB uploaded, a message sent before its files finished uploading.                                                                                                                    |
| Links and images | `tests/links.test.ts`                                 | A reply loading an image from another site, or opening a `tel:` or other app link.                                                                                                                 |
| Files            | `tests/files.test.ts`, flow 6                         | An HTML or SVG file rendered as a page instead of shown as text, a file missing from the panel or listed twice, or a panel that dragging its handle down doesn't close.                            |
| Working line     | `tests/chat.test.ts`, flow 4                          | Nod working with the Stop button showing but no working line, as when it continues a task after you answer a question.                                                                             |
| Browser handoff  | `tests/browser.test.ts`, flow 7                       | A page image lost when the stream splits it, a tap on the empty space around the page sent as a click, a handoff that closing the panel ends, or a Return to Nod the server never hears.           |
| Live updates     | flow 3                                                | The app not reconnecting after the live connection drops.                                                                                                                                          |
| Questions        | flow 4                                                | A choice answered twice.                                                                                                                                                                           |
| Screens          | flow 5                                                | A screen in the menu that no longer opens.                                                                                                                                                         |
