---
name: dinggy
description: Build and launch Apple apps with the dinggy CLI. Use for iOS apps that should run on a connected physical iPhone or iPad, or macOS apps that should build and run on the local Mac.
---

`dinggy` is a command line helper for running Apple apps without opening Xcode.

It stores project-local preferences in `.dinggy/config.json`, including the app platform, preferred iOS device when needed, Xcode workspace or project, scheme, and DerivedData path. The default build artifact location is `.dinggy/DerivedData`.

## Commands

`dinggy devices` lists available physical devices and their identifiers.

`dinggy devices --json` prints machine-readable device data.

`dinggy run` builds and launches the app on the remembered target. If config is missing, it prompts for the platform, target, scheme, and iOS device when needed.

`dinggy run --device <id> --scheme <scheme> --workspace <path>` is the preferred agent-safe form for workspace projects.

`dinggy run --device <id> --scheme <scheme> --project <path>` is the preferred agent-safe form for project-only apps.

`dinggy run --platform macos --scheme <scheme> --workspace <path>` builds with `-destination platform=macOS` and launches the built app on this Mac.

`dinggy run --platform macos --scheme <scheme> --project <path>` is the preferred agent-safe form for macOS project-only apps.

`dinggy run --no-launch` builds without launching. For iOS, it still installs the app on the configured device.

`dinggy config` runs interactive config and saves a new platform, preferred iOS device when needed, workspace or project, scheme, and DerivedData path.

`dinggy info` prints the current project config.

`dinggy config --platform <ios|macos> --device <id> --scheme <scheme> --workspace <path>` updates config values non-interactively. Pass only the fields that should change. Use `--project <path>` instead of `--workspace <path>` for project-only apps. Omit `--device` for macOS configs.

`dinggy clean` interactively asks what to clean with a multi-select menu. Build cache is selected by default; config is not selected by default.

`dinggy clean --force` removes the configured DerivedData/build cache without prompting and preserves config.

## Agent Workflow

1. For iOS, run `dinggy devices --json` and choose an available physical device identifier.
2. For iOS, run `dinggy run --platform ios --device <id> --scheme <scheme> --workspace <workspace>` or `dinggy run --platform ios --device <id> --scheme <scheme> --project <project>`.
3. For macOS, run `dinggy run --platform macos --scheme <scheme> --workspace <workspace>` or `dinggy run --platform macos --scheme <scheme> --project <project>`.
4. On later runs, `dinggy run` can reuse `.dinggy/config.json`.

## Notes

- `dinggy` currently uses `xcrun xcdevice list` for device discovery.
- iOS builds use `xcodebuild` with `-destination id=<device-id>` and `-derivedDataPath`.
- macOS builds use `xcodebuild` with `-destination platform=macOS` and `-derivedDataPath`.
- iOS install and launch use `xcrun devicectl`.
- macOS launch first stops any process running from the exact built `.app` path, then uses `/usr/bin/open -n <app>`.
- In sandboxed agent environments, Apple device services may need elevated host access. If device commands fail with CoreDevice or CoreSimulator permission errors, retry outside the sandbox or ask the user to run the command locally.
