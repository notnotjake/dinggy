# dinggy

`dinggy` runs iOS apps on real devices from the command line.

It is built for the workflow where you edit with an AI agent, then run the app on a connected iPhone or iPad without opening Xcode.

## Install

Requirements:

- [bun](https://bun.sh)
- Xcode command line tools
- A trusted, connected iOS device

```bash
bun install
bun link
```

## Commands

| Command | Description |
| --- | --- |
| `dinggy run` | Build, install, and launch on the remembered device. Prompts for missing config. |
| `dinggy devices` | List available devices. |
| `dinggy config` | Run interactive config and save new choices. |
| `dinggy config --device <id>` | Update one or more config values non-interactively. |
| `dinggy info` | Print the project `.dinggy/config.json`. |
| `dinggy clean` | Interactively clean build cache, build error logs, and optionally config. |
| `dinggy clean --force` | Remove DerivedData/build cache and build error logs without prompting. |
| `dinggy help` | Show help. |

## Agent usage

For noninteractive use, pass the values that would otherwise be prompted:

```bash
dinggy run --device <device-id> --scheme <scheme> --workspace App.xcworkspace
dinggy run --device <device-id> --scheme <scheme> --project App.xcodeproj
dinggy config --device <device-id> --scheme <scheme> --workspace App.xcworkspace
dinggy clean --force
```

By default build artifacts go to `.dinggy/DerivedData`.
