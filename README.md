# dinggy

`dinggy` runs Apple apps from the command line.

It is built for the workflow where you edit with an AI agent, then run an iOS app on a connected iPhone or iPad or a macOS app on the local Mac without opening Xcode.

## Install

Requirements:

- [bun](https://bun.sh)
- Xcode command line tools
- A trusted, connected iOS device for iOS apps

```bash
bun install
bun link
```

## Commands

| Command | Description |
| --- | --- |
| `dinggy run` | Build and launch on the remembered target. Prompts for missing config. |
| `dinggy devices` | List available devices. |
| `dinggy config` | Run interactive config and save new choices. |
| `dinggy config --platform <ios\|macos>` | Update one or more config values non-interactively. |
| `dinggy info` | Print the project `.dinggy/config.json`, storage, and performance summary. |
| `dinggy clean` | Interactively clean build cache, build error logs, and optionally config. |
| `dinggy clean --force` | Remove DerivedData/build cache and build error logs without prompting. |
| `dinggy help` | Show help. |

## Agent usage

For noninteractive use, pass the values that would otherwise be prompted:

```bash
dinggy run --device <device-id> --scheme <scheme> --workspace App.xcworkspace
dinggy run --device <device-id> --scheme <scheme> --project App.xcodeproj
dinggy run --platform macos --scheme <scheme> --project App.xcodeproj
dinggy config --device <device-id> --scheme <scheme> --workspace App.xcworkspace
dinggy config --platform macos --scheme <scheme> --project App.xcodeproj
dinggy clean --force
```

By default build artifacts go to `.dinggy/DerivedData`.

iOS runs build with `xcodebuild`, install with `devicectl`, then launch on the configured physical device. macOS runs build with `xcodebuild -destination platform=macOS`, stops any process running from the exact built `.app` path, and launches that `.app` on this Mac with `/usr/bin/open -n`.

Build performance is recorded in `.dinggy/perf.jsonl`. `dinggy info` summarizes the recorded run count, average total time, and error rate.
