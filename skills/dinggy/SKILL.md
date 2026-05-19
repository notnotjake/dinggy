---
name: dinggy
description: Build, install, and launch iOS apps on a connected physical device with the dinggy CLI. Use when working on iOS apps where simulator testing is not sufficient and the app should run on a real iPhone or iPad from the command line.
---

`dinggy` is a command line helper for running iOS apps on physical devices without opening Xcode.

It stores project-local preferences in `.dinggy/config.json`, including the preferred device, Xcode workspace or project, scheme, and DerivedData path. The default build artifact location is `.dinggy/DerivedData`.

## Commands

`dinggy devices` lists available physical devices and their identifiers.

`dinggy devices --json` prints machine-readable device data.

`dinggy run` builds, installs, and launches the app on the remembered device. If config is missing, it prompts for the device, target, and scheme.

`dinggy run --device <id> --scheme <scheme> --workspace <path>` is the preferred agent-safe form for workspace projects.

`dinggy run --device <id> --scheme <scheme> --project <path>` is the preferred agent-safe form for project-only apps.

`dinggy run --no-launch` builds and installs without launching.

`dinggy config` prints the current project config.

`dinggy config edit` runs interactive config again and saves a new preferred device, workspace or project, scheme, and DerivedData path.

`dinggy config --device <id> --scheme <scheme> --workspace <path>` updates config values non-interactively. Pass only the fields that should change. Use `--project <path>` instead of `--workspace <path>` for project-only apps.

`dinggy clean` removes `.dinggy`, including config and DerivedData build artifacts.

## Agent Workflow

1. Run `dinggy devices --json`.
2. Choose an available physical device identifier.
3. Run `dinggy run --device <id> --scheme <scheme> --workspace <workspace>` or `dinggy run --device <id> --scheme <scheme> --project <project>`.
4. On later runs, `dinggy run` can reuse `.dinggy/config.json`.

## Notes

- `dinggy` currently uses `xcrun xcdevice list` for device discovery.
- Builds use `xcodebuild` with `-destination id=<device-id>` and `-derivedDataPath`.
- Install and launch use `xcrun devicectl`.
- In sandboxed agent environments, Apple device services may need elevated host access. If device commands fail with CoreDevice or CoreSimulator permission errors, retry outside the sandbox or ask the user to run the command locally.
