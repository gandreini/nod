---
title: Mobile app
description: Build the Android app in clients/mobile, run its unit and end-to-end tests, and know what each test covers.
sidebar:
  order: 9
---

The Android app in `clients/mobile` is an Expo client for a Nod server. It connects with the server address and `NOD_AUTH_TOKEN`, and talks to the same API as the web app.

The short version: `pnpm test` runs the fast tests against a fake Nod server, and `pnpm e2e` runs the app itself on an Android emulator against the same fake server. Neither ever touches a real server, a real phone or a live model.

## Build the app

Run these from `clients/mobile`. Each variant has its own package, so they can sit side by side on one device.

| Command                | App     | Package                 | Use it for                                                                               |
| ---------------------- | ------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm android:release` | Nod     | `com.gandreini.nod`     | Everyday use. The code is bundled, and only HTTPS servers are allowed.                   |
| `pnpm android:dev`     | Nod Dev | `com.gandreini.nod.dev` | Development with Metro and fast reload.                                                  |
| `pnpm android:e2e`     | Nod E2E | `com.gandreini.nod.e2e` | End-to-end tests only. Allows plain HTTP so it can reach the fake server on `127.0.0.1`. |

Each command regenerates the `android` folder for its variant, then builds an arm64 APK in `android/app/build/outputs/apk`.

## Run the tests

```sh title="Terminal"
pnpm test
```

Unit and delivery tests. They take about a second and need nothing but Node.

```sh title="Terminal"
pnpm e2e
```

End-to-end tests with [Maestro](https://maestro.mobile.dev). The script creates an Android emulator called `nod-e2e` if it is missing, starts the fake server with fresh random tokens, installs Nod E2E and runs every flow in `e2e/flows`. It stops the server and the emulator at the end. It targets the emulator by name, so a phone connected over `adb` is left alone.

The first run needs the Android command-line tools, the `system-images;android-36;google_apis;arm64-v8a` image and the Maestro CLI. Set `E2E_BUILD=1` to rebuild Nod E2E first, and `E2E_KEEP_EMULATOR=1` to leave the emulator running between runs.

## The fake server

`tool/fake-server.mts` is a small Nod stand-in with synthetic data. It uses the server's real access check, so a wrong token gets the same 401 as a real Nod. Tests drive it through `/fixture/*` routes that need a separate control token.

It can also fail on purpose. `/fixture/audio-faults` makes the next voice messages lose their answer on the way back, stop after the server claimed them, be cancelled like a Stop, or meet a busy server. That is how the tests check that a voice message is never sent twice and never lost.

## What the tests cover

| Area             | Test                                                  | What it would catch                                                                                         |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Connecting       | `tests/connection.test.ts`, flow 1                    | A token sent to a plain-HTTP or credentialed address, a refused token treated as accepted.                  |
| Messages         | `tests/chat.test.ts`, flow 2                          | A message shown twice or lost when history and live updates overlap.                                        |
| Voice delivery   | `tests/delivery.test.ts`                              | A voice message sent twice after a lost answer, a Stop ignored, a delivered message resent after a restart. |
| Attachments      | `tests/attachments.test.ts`, `tests/delivery.test.ts` | A file over 90 MB uploaded, a message sent before its files finished uploading.                             |
| Links and images | `tests/links.test.ts`                                 | A reply loading an image from another site, or opening a `tel:` or other app link.                          |
| Live updates     | flow 3                                                | The app not reconnecting after the live connection drops.                                                   |
| Questions        | flow 4                                                | A choice answered twice.                                                                                    |
| Screens          | flow 5                                                | A screen in the menu that no longer opens.                                                                  |
