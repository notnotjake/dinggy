#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "path";
import * as p from "@clack/prompts";
import kleur from "kleur";
import { isHelpFlag, printMainHelp } from "./help";

type CliOptions = {
  device?: string;
  scheme?: string;
  workspace?: string;
  project?: string;
  derivedData?: string;
  force: boolean;
  launch: boolean;
  json: boolean;
};

type ParsedArgs = {
  command: string;
  options: CliOptions;
  help: boolean;
};

type DinggyConfig = {
  device?: {
    id: string;
    name?: string;
    platform?: string;
  };
  workspace?: string;
  project?: string;
  scheme?: string;
  derivedDataPath: string;
};

type Device = {
  id: string;
  name: string;
  platform?: string;
  modelName?: string;
  osVersion?: string;
  available: boolean;
  simulator: boolean;
};

type XcodeTarget = {
  kind: "workspace" | "project";
  path: string;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RollingLog = {
  addLine: (line: string) => void;
  clear: () => void;
};

type BuildOutputControl = {
  active: boolean;
};

type DeviceDiagnostic = {
  devices: Device[];
  matchingDevice?: Device;
  issue?: string;
  scanError?: string;
};

type RunPhase = "build" | "resolve-app" | "install" | "bundle-id" | "launch";

type PerfEntry = {
  version: 1;
  startedAt: string;
  finishedAt: string;
  scheme: string;
  launchRequested: boolean;
  didError: boolean;
  failedPhase?: RunPhase;
  timingsMs: {
    build?: number;
    install?: number;
    launch?: number;
    total: number;
  };
};

type PerfPhaseTimings = Omit<PerfEntry["timingsMs"], "total">;

type PerfSummary = {
  path: string;
  count: number;
  errorCount: number;
  errorRate: number;
  avgTotalMs: number | null;
};

type PathStats = {
  bytes: number;
  files: number;
};

class SilentExit extends Error {
  constructor(readonly code: number) {
    super("Silent exit");
  }
}

const CONFIG_DIR = ".dinggy";
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_DERIVED_DATA = join(CONFIG_DIR, "DerivedData");
const BUILD_LOG_DIR = join(CONFIG_DIR, "build-logs");
const PERF_PATH = join(CONFIG_DIR, "perf.jsonl");

const styles = {
  title: (text: string) => kleur.bold().cyan(text),
  label: (text: string) => kleur.bold().white(text),
  muted: (text: string) => kleur.gray(text),
  warn: (text: string) => kleur.yellow(text),
  error: (text: string) => kleur.red(text),
  success: (text: string) => kleur.green(text),
};

const runStyles = {
  muted: (text: string) => kleur.dim(text),
};

function parseArgs(argv: string[]): ParsedArgs {
  const options: CliOptions = {
    force: false,
    launch: true,
    json: false,
  };
  const positional: string[] = [];
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (isHelpFlag(arg)) {
      help = true;
      continue;
    }
    if (arg === "--device") {
      options.device = argv[++i];
      continue;
    }
    if (arg === "--scheme") {
      options.scheme = argv[++i];
      continue;
    }
    if (arg === "--workspace") {
      options.workspace = argv[++i];
      continue;
    }
    if (arg === "--project") {
      options.project = argv[++i];
      continue;
    }
    if (arg === "--derived-data") {
      options.derivedData = argv[++i];
      continue;
    }
    if (arg === "--no-launch") {
      options.launch = false;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "-f" || arg === "--force") {
      options.force = true;
      continue;
    }
    positional.push(arg);
  }

  return {
    command: positional[0] ?? "run",
    options,
    help,
  };
}

function logInfo(message: string): void {
  console.log(`${styles.title("dinggy")} ${message}`);
}

function logError(message: string): void {
  console.error(`${styles.error("error")} ${message}`);
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)}${units[unitIndex]}`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pathStats(path: string): PathStats {
  if (!existsSync(path)) return { bytes: 0, files: 0 };

  const stats = statSync(path);
  if (!stats.isDirectory()) {
    return { bytes: stats.size, files: stats.isFile() ? 1 : 0 };
  }

  const total: PathStats = { bytes: 0, files: 0 };
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const entryPath = join(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const childStats = pathStats(entryPath);
      total.bytes += childStats.bytes;
      total.files += childStats.files;
      continue;
    }
    total.bytes += statSync(entryPath).size;
    total.files += 1;
  }

  return total;
}

function directorySize(path: string): number {
  return pathStats(path).bytes;
}

function readPerfEntries(): PerfEntry[] {
  if (!existsSync(PERF_PATH)) return [];

  return readFileSync(PERF_PATH, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): PerfEntry[] => {
      try {
        const parsed = JSON.parse(line) as Partial<PerfEntry>;
        if (parsed.version !== 1 || typeof parsed.timingsMs?.total !== "number") return [];
        return [parsed as PerfEntry];
      } catch {
        return [];
      }
    });
}

function writePerfEntry(entry: PerfEntry): void {
  ensureDir(dirname(PERF_PATH));
  appendFileSync(PERF_PATH, `${JSON.stringify(entry)}\n`);
}

function perfSummary(): PerfSummary {
  const entries = readPerfEntries();
  const errorCount = entries.filter((entry) => entry.didError).length;
  const totalMs = entries.reduce((sum, entry) => sum + entry.timingsMs.total, 0);

  return {
    path: PERF_PATH,
    count: entries.length,
    errorCount,
    errorRate: entries.length > 0 ? errorCount / entries.length : 0,
    avgTotalMs: entries.length > 0 ? totalMs / entries.length : null,
  };
}

function printRunLine(message: string): void {
  console.log(`  ${message}`);
}

function printRunDetail(label: string, value: string): void {
  console.log(`     ${runStyles.muted(`${label}: ${value}`)}`);
}

function launchEmoji(): string {
  const roll = Math.random();
  if (roll < 0.001) return "❤️";
  if (roll < 0.801) return "🚀";
  if (roll < 0.901) return "🤘";
  if (roll < 0.951) return "🔥";
  return "🎉";
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function readConfig(): DinggyConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { derivedDataPath: DEFAULT_DERIVED_DATA };
  }

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<DinggyConfig>;
    return {
      ...parsed,
      derivedDataPath: parsed.derivedDataPath || DEFAULT_DERIVED_DATA,
    };
  } catch {
    return { derivedDataPath: DEFAULT_DERIVED_DATA };
  }
}

function writeConfig(config: DinggyConfig): void {
  ensureDir(CONFIG_DIR);
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
}

function hasConfigUpdates(options: CliOptions): boolean {
  return Boolean(options.device || options.scheme || options.workspace || options.project || options.derivedData);
}

function hasRunConfig(config: DinggyConfig, options: CliOptions): boolean {
  return Boolean(
    (options.workspace || options.project || config.workspace || config.project) &&
      (options.scheme || config.scheme) &&
      (options.device || config.device?.id),
  );
}

function updateConfig(options: CliOptions): void {
  const config = readConfig();
  const nextConfig: DinggyConfig = {
    ...config,
    derivedDataPath: options.derivedData ?? config.derivedDataPath ?? DEFAULT_DERIVED_DATA,
  };

  if (options.device) {
    nextConfig.device = { id: options.device };
  }

  if (options.scheme) {
    nextConfig.scheme = options.scheme;
  }

  if (options.workspace && options.project) {
    throw new Error("Pass either --workspace or --project, not both.");
  }

  if (options.workspace) {
    nextConfig.workspace = options.workspace;
    delete nextConfig.project;
  }

  if (options.project) {
    nextConfig.project = options.project;
    delete nextConfig.workspace;
  }

  writeConfig(nextConfig);
  logInfo(`Saved ${styles.label(CONFIG_PATH)}.`);
}

async function runCommand(cmd: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<CommandResult> {
  const proc = Bun.spawn(cmd, {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = options?.timeoutMs ?? 0;
  let timeoutId: Timer | null = null;
  const timeout =
    timeoutMs > 0
      ? new Promise<"timeout">((resolveTimeout) => {
          timeoutId = setTimeout(() => resolveTimeout("timeout"), timeoutMs);
        })
      : null;

  const exited = timeout ? await Promise.race([proc.exited, timeout]) : await proc.exited;
  if (timeoutId) clearTimeout(timeoutId);

  if (exited === "timeout") {
    proc.kill();
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return {
    exitCode: exited === "timeout" ? 124 : exited,
    stdout,
    stderr,
  };
}

function extractJsonArray(value: string): unknown[] | null {
  const lines = value.split(/\r?\n/);
  const startLine = lines.findIndex((line) => line.trim() === "[");
  const endLine = lines.findLastIndex((line) => line.trim() === "]");
  if (startLine === -1 || endLine === -1 || endLine <= startLine) return null;

  try {
    const parsed = JSON.parse(lines.slice(startLine, endLine + 1).join("\n")) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function scanDevices(): Promise<Device[]> {
  const result = await runCommand(["xcrun", "xcdevice", "list"], { timeoutMs: 15000 });
  const devicesJson = extractJsonArray(`${result.stdout}\n${result.stderr}`);
  if (!devicesJson) {
    const details = (result.stderr || result.stdout).trim();
    throw new Error(details || "Could not parse xcrun xcdevice list output.");
  }

  return devicesJson
    .map((raw): Device | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const id = typeof item.identifier === "string" ? item.identifier : "";
      const name = typeof item.name === "string" ? item.name : id;
      if (!id || !name) return null;
      return {
        id,
        name,
        platform: typeof item.platform === "string" ? item.platform : undefined,
        modelName: typeof item.modelName === "string" ? item.modelName : undefined,
        osVersion: typeof item.operatingSystemVersion === "string" ? item.operatingSystemVersion : undefined,
        available: item.available === true,
        simulator: item.simulator === true,
      };
    })
    .filter((device): device is Device => Boolean(device));
}

async function listDevices(): Promise<Device[]> {
  const devices = await scanDevices();
  return devices.filter((device) => {
    const platform = device.platform ?? "";
    return device.available && !device.simulator && platform.includes("iphoneos");
  });
}

function formatDevice(device: Device): string {
  const details = [device.modelName, device.osVersion].filter(Boolean).join(", ");
  return details ? `${device.name} ${styles.muted(`(${details})`)}` : device.name;
}

function formatDeviceIdentity(device: Device): string {
  return `${device.name} ${styles.muted(`(${device.id})`)}`;
}

function deviceUnavailableReason(device: Device): string | null {
  if (!device.available) return "it is not currently available";
  if (device.simulator) return "it is a simulator, not a physical device";
  const platform = device.platform ?? "";
  if (!platform.includes("iphoneos")) return `its platform is ${platform || "unknown"}, not iphoneos`;
  return null;
}

function diagnoseDevice(device: Device, devices: Device[]): DeviceDiagnostic {
  const matchingDevice = devices.find((candidate) => candidate.id === device.id);
  if (!matchingDevice) {
    return {
      devices,
      issue: `${device.name} is not available`,
    };
  }

  if (deviceUnavailableReason(matchingDevice)) {
    return {
      devices,
      matchingDevice,
      issue: `${matchingDevice.name} is not available`,
    };
  }

  return { devices, matchingDevice };
}

async function scanSelectedDevice(device: Device): Promise<DeviceDiagnostic> {
  try {
    return diagnoseDevice(device, await scanDevices());
  } catch (error) {
    return {
      devices: [],
      scanError: error instanceof Error ? error.message : String(error),
    };
  }
}

function findXcodeTargets(cwd = process.cwd()): XcodeTarget[] {
  const entries = readdirSync(cwd, { withFileTypes: true });
  const targets: XcodeTarget[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith(".xcworkspace")) {
      targets.push({ kind: "workspace", path: entry.name });
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith(".xcodeproj")) {
      targets.push({ kind: "project", path: entry.name });
    }
  }

  return targets.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "workspace" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

async function listSchemes(target: XcodeTarget): Promise<string[]> {
  const args =
    target.kind === "workspace"
      ? ["xcodebuild", "-list", "-json", "-workspace", target.path]
      : ["xcodebuild", "-list", "-json", "-project", target.path];
  const result = await runCommand(args, { timeoutMs: 30000 });
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || "xcodebuild -list failed.");
  }

  const parsed = JSON.parse(result.stdout) as {
    workspace?: { schemes?: string[] };
    project?: { schemes?: string[] };
  };
  return parsed.workspace?.schemes ?? parsed.project?.schemes ?? [];
}

function resolvePath(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function targetFromConfig(config: DinggyConfig, options: CliOptions): XcodeTarget | null {
  const workspace = options.workspace ?? config.workspace;
  const project = options.project ?? config.project;

  if (workspace) return { kind: "workspace", path: workspace };
  if (project) return { kind: "project", path: project };
  return null;
}

function selectXcodeTarget(targets: XcodeTarget[], message = "Select Target"): Promise<XcodeTarget> {
  return p
    .select({
      message,
      options: targets.map((target) => ({
        label: `${target.path} ${styles.muted(target.kind)}`,
        value: `${target.kind}:${target.path}`,
      })),
    })
    .then((selected) => {
      if (p.isCancel(selected)) {
        p.cancel("Cancelled.");
        process.exit(1);
      }

      const [kind, ...pathParts] = String(selected).split(":");
      return { kind: kind as XcodeTarget["kind"], path: pathParts.join(":") };
    });
}

function detectXcodeTarget(
  config: DinggyConfig,
  options: CliOptions = {
    force: false,
    launch: true,
    json: false,
  },
): XcodeTarget | null {
  const configured = targetFromConfig(config, options);
  if (configured) return configured;

  const targets = findXcodeTargets();
  if (targets.length === 0) {
    return null;
  }
  return targets[0] ?? null;
}

function resolveTarget(config: DinggyConfig, options: CliOptions): XcodeTarget {
  const configured = targetFromConfig(config, options);
  if (!configured) {
    throw new Error("No Xcode workspace or project configured. Run dinggy config.");
  }
  return configured;
}

function resolveScheme(config: DinggyConfig, options: CliOptions): string {
  const configured = options.scheme ?? config.scheme;
  if (!configured) {
    throw new Error("No scheme configured. Run dinggy config.");
  }
  return configured;
}

async function selectScheme(target: XcodeTarget): Promise<string> {
  const schemes = await listSchemes(target);
  if (schemes.length === 0) {
    throw new Error(`No shared schemes found in ${target.path}.`);
  }
  if (schemes.length === 1) return schemes[0] ?? "";

  const selected = await p.select({
    message: "Select Scheme",
    options: schemes.map((scheme) => ({ label: scheme, value: scheme })),
  });
  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }
  return String(selected);
}

function resolveDevice(config: DinggyConfig, options: CliOptions): Device {
  const configuredId = options.device ?? config.device?.id;
  if (!configuredId) {
    throw new Error("No device configured. Run dinggy config.");
  }

  return {
    id: configuredId,
    name: config.device?.name ?? configuredId,
    platform: config.device?.platform,
    available: true,
    simulator: false,
  };
}

async function selectDevice(devices: Device[]): Promise<Device> {
  if (devices.length === 1) return devices[0];

  const selected = await p.select({
    message: "Select Device",
    options: devices.map((device) => ({
      label: formatDevice(device),
      value: device.id,
      hint: device.platform,
    })),
  });
  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }

  const device = devices.find((candidate) => candidate.id === selected);
  if (!device) throw new Error("Selected device disappeared.");
  return device;
}

async function promptForDerivedDataPath(config: DinggyConfig): Promise<string> {
  const selected = await p.text({
    message: "DerivedData path",
    initialValue: config.derivedDataPath || DEFAULT_DERIVED_DATA,
    placeholder: DEFAULT_DERIVED_DATA,
  });
  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }

  const value = String(selected).trim();
  return value || DEFAULT_DERIVED_DATA;
}

function describeTarget(target: XcodeTarget): string {
  return `${target.path} (${target.kind})`;
}

async function reviewProjectSettings(target: XcodeTarget, config: DinggyConfig): Promise<{
  target: XcodeTarget;
  derivedDataPath: string;
}> {
  const derivedDataPath = config.derivedDataPath || DEFAULT_DERIVED_DATA;

  const selected = await p.select({
    message: `Target: ${describeTarget(target)}\nBuilds: ${derivedDataPath}`,
    options: [
      { label: "Accept Project Settings", value: "accept" },
      { label: "Modify Project Settings", value: "modify" },
    ],
  });
  if (p.isCancel(selected)) {
    p.cancel("Cancelled.");
    process.exit(1);
  }

  if (selected === "accept") {
    return { target, derivedDataPath };
  }

  const targets = findXcodeTargets();
  if (targets.length === 0) {
    throw new Error("No .xcworkspace or .xcodeproj found in the current directory.");
  }
  const nextTarget = await selectXcodeTarget(targets, "Select Target");
  const nextDerivedDataPath = await promptForDerivedDataPath({ ...config, derivedDataPath });
  return { target: nextTarget, derivedDataPath: nextDerivedDataPath };
}

async function configureProject(): Promise<DinggyConfig> {
  const config = readConfig();
  const deviceScan = listDevices().then(
    (devices) => ({ devices, error: null }),
    (error: unknown) => ({ devices: null, error }),
  );
  const detectedTarget = detectXcodeTarget(config);
  if (!detectedTarget) {
    throw new Error("No .xcworkspace or .xcodeproj found in the current directory.");
  }

  let target = detectedTarget;
  let scheme = await selectScheme(target);
  const projectSettings = await reviewProjectSettings(target, config);

  if (projectSettings.target.kind !== target.kind || projectSettings.target.path !== target.path) {
    target = projectSettings.target;
    scheme = await selectScheme(target);
  }

  const deviceResult = await deviceScan;
  if (deviceResult.error) throw deviceResult.error;
  const device = await selectDevice(deviceResult.devices ?? []);
  const derivedDataPath = projectSettings.derivedDataPath;

  const nextConfig: DinggyConfig = {
    device: {
      id: device.id,
      name: device.name,
      platform: device.platform,
    },
    scheme,
    derivedDataPath,
    [target.kind]: target.path,
  };
  writeConfig(nextConfig);
  logInfo(`is ready! ${styles.muted(`saved ${CONFIG_PATH}`)}`);
  return nextConfig;
}

function appBundleNameFromScheme(scheme: string): string {
  const cleaned = basename(scheme, extname(scheme)).replace(/[^A-Za-z0-9_.-]/g, "");
  return `${cleaned}.app`;
}

function appPath(config: DinggyConfig, scheme: string): string {
  return join(resolvePath(config.derivedDataPath), "Build", "Products", "Debug-iphoneos", appBundleNameFromScheme(scheme));
}

function parseBuildSetting(output: string, key: string): string | null {
  const lines = output.split(/\r?\n/);
  let value: string | null = null;

  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`));
    if (match?.[1]) value = match[1].trim();
  }

  return value;
}

function visibleText(value: string, width: number): string {
  const clean = value.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  const maxWidth = Math.max(1, Math.min(width, 100) - 4);
  if (clean.length <= maxWidth) return clean;
  return `${clean.slice(0, Math.max(0, maxWidth - 1))}…`;
}

function sanitizeBuildLine(value: string): string {
  return value
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .trim();
}

function createBuildLog(startedAt: number, rowCount = 3): RollingLog {
  if (!process.stdout.isTTY) {
    return {
      addLine: (line: string) => process.stdout.write(`${line}\n`),
      clear: () => {},
    };
  }

  const lines: string[] = [];
  let rendered = false;
  let lastElapsed = "";
  let timer: Timer | null = null;

  function render(): void {
    const width = process.stdout.columns || 100;
    const totalRows = rowCount + 1;
    if (rendered) process.stdout.write(`\x1b[${totalRows}A`);

    const visibleLines = lines.slice(-rowCount);
    const paddedLines = [
      ...Array.from({ length: Math.max(0, rowCount - visibleLines.length) }, () => ""),
      ...visibleLines,
    ];

    process.stdout.write(
      `\x1b[2K\r${kleur.bold().gray(formatDuration(Date.now() - startedAt))}\n`,
    );
    for (const line of paddedLines) {
      process.stdout.write(`\x1b[2K\r${runStyles.muted(visibleText(line, width))}\n`);
    }
    rendered = true;
  }

  function renderIfElapsedChanged(): void {
    const elapsed = formatDuration(Date.now() - startedAt);
    if (elapsed === lastElapsed) return;
    lastElapsed = elapsed;
    render();
  }

  lastElapsed = formatDuration(Date.now() - startedAt);
  render();
  timer = setInterval(renderIfElapsedChanged, 100);

  return {
    addLine(line: string) {
      const trimmed = sanitizeBuildLine(line);
      if (!trimmed) return;
      lines.push(trimmed);
      render();
    },
    clear() {
      if (timer) clearInterval(timer);
      timer = null;
      if (!rendered) return;
      renderIfElapsedChanged();
      const totalRows = rowCount + 1;
      process.stdout.write(`\x1b[${totalRows}A`);
      for (let i = 0; i < totalRows; i += 1) {
        process.stdout.write("\x1b[2K\r");
        if (i < totalRows - 1) process.stdout.write("\x1b[1B");
      }
      process.stdout.write(`\x1b[${totalRows - 1}A`);
      rendered = false;
    },
  };
}

function createLiveStatus(): { set: (message: string) => void; clear: () => void } {
  if (!process.stdout.isTTY) {
    return {
      set: (message: string) => printRunLine(runStyles.muted(message)),
      clear: () => {},
    };
  }

  let rendered = false;
  return {
    set(message: string) {
      if (rendered) process.stdout.write("\x1b[1A");
      process.stdout.write(`\x1b[2K\r  ${runStyles.muted(message)}\n`);
      rendered = true;
    },
    clear() {
      if (!rendered) return;
      process.stdout.write("\x1b[1A\x1b[2K\r");
      rendered = false;
    },
  };
}

async function streamBuildOutput(
  stream: ReadableStream<Uint8Array> | null,
  rollingLog: RollingLog,
  logs: string[],
  control: BuildOutputControl,
): Promise<void> {
  if (!stream) return;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffered += decoder.decode(value, { stream: true });
    const parts = buffered.split(/\r\n|\n|\r/);
    buffered = parts.pop() ?? "";

    for (const line of parts) {
      logs.push(line);
      if (control.active) rollingLog.addLine(line);
    }
  }

  buffered += decoder.decode();
  if (buffered.trim()) {
    logs.push(buffered);
    if (control.active) rollingLog.addLine(buffered);
  }
}

function buildLogPath(startedAt: number): string {
  const timestamp = new Date(startedAt)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return join(BUILD_LOG_DIR, `build-${timestamp}.log`);
}

function writeBuildLog(args: string[], exitCode: number | null, startedAt: number, logs: string[]): string {
  const path = buildLogPath(startedAt);
  ensureDir(dirname(path));
  const contents = [
    `Command: ${args.join(" ")}`,
    `Exit Code: ${exitCode ?? "stopped"}`,
    `Started At: ${new Date(startedAt).toISOString()}`,
    "",
    ...logs.map(sanitizeBuildLine).filter(Boolean),
    "",
  ].join("\n");
  writeFileSync(path, contents);
  return path;
}

function extractBuildErrors(logs: string[]): string[] {
  const cleaned = logs.map(sanitizeBuildLine).filter(Boolean);
  const errors = cleaned.filter((line) =>
    /\b(error|fatal error):|xcodebuild: error:|BUILD FAILED|The following build commands failed|Command .* failed/i.test(
      line,
    ),
  );

  if (errors.length > 0) {
    return errors.slice(-8);
  }

  return cleaned.slice(-8);
}

function printBuildFailureDetails(exitCode: number | null, logs: string[], logPath: string): void {
  if (exitCode !== null) printRunDetail("xcodebuild", `exited with code ${exitCode}`);

  const errors = extractBuildErrors(logs);
  if (errors.length > 0) {
    console.log("");
    printRunLine(styles.label("Build Error:"));
    for (const line of errors) {
      printRunLine(styles.error(line));
    }
  }

  console.log("");
  printRunLine(`Build logs: ${styles.label(logPath)}`);
}

function printDeviceDiagnostic(diagnostic: DeviceDiagnostic): void {
  if (diagnostic.scanError) {
    printRunDetail("device scan failed", diagnostic.scanError);
    return;
  }

  if (diagnostic.issue) {
    printRunLine(styles.error(diagnostic.issue));

    const availableDevices = diagnostic.devices.filter((candidate) => deviceUnavailableReason(candidate) === null);
    console.log("");
    printRunLine(styles.label("Devices Available:"));
    if (availableDevices.length > 0) {
      for (const device of availableDevices) {
        printRunLine(`${styles.label(device.id)}  ${formatDevice(device)}`);
      }
    } else {
      printRunLine(styles.muted("none"));
    }
    return;
  }

  if (diagnostic.matchingDevice) {
    printRunDetail("device", `${formatDeviceIdentity(diagnostic.matchingDevice)} is still available`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function measurePhase<T>(timings: PerfPhaseTimings, phase: keyof PerfPhaseTimings, task: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    timings[phase] = Date.now() - startedAt;
  }
}

async function resolveBuiltAppPath(target: XcodeTarget, scheme: string, device: Device, config: DinggyConfig): Promise<string> {
  const guessedPath = appPath(config, scheme);
  if (existsSync(guessedPath)) return guessedPath;

  const args = [
    "xcodebuild",
    target.kind === "workspace" ? "-workspace" : "-project",
    target.path,
    "-scheme",
    scheme,
    "-destination",
    `id=${device.id}`,
    "-derivedDataPath",
    config.derivedDataPath,
    "-showBuildSettings",
  ];
  const result = await runCommand(args, { timeoutMs: 30000 });
  if (result.exitCode === 0) {
    const targetBuildDir = parseBuildSetting(result.stdout, "TARGET_BUILD_DIR");
    const wrapperName = parseBuildSetting(result.stdout, "WRAPPER_NAME");
    if (targetBuildDir && wrapperName) {
      const resolvedPath = join(targetBuildDir, wrapperName);
      if (existsSync(resolvedPath)) return resolvedPath;
    }
  }

  throw new Error(`Built app not found. Checked ${guessedPath} and xcodebuild build settings.`);
}

async function buildApp(target: XcodeTarget, scheme: string, device: Device, derivedDataPath: string): Promise<void> {
  const args = [
    "xcodebuild",
    target.kind === "workspace" ? "-workspace" : "-project",
    target.path,
    "-scheme",
    scheme,
    "-destination",
    `id=${device.id}`,
    "-derivedDataPath",
    derivedDataPath,
    "build",
  ];

  const startedAt = Date.now();
  console.log("");
  logInfo(`Building ${styles.label(scheme)} for ${styles.label(device.name)}...`);

  const rollingLog = createBuildLog(startedAt);
  const logs: string[] = [];
  const outputControl: BuildOutputControl = { active: true };
  let deviceScanDone = false;
  const deviceScan = scanSelectedDevice(device).then((result) => {
    deviceScanDone = true;
    return result;
  });
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const outputComplete = Promise.all([
    streamBuildOutput(proc.stdout, rollingLog, logs, outputControl),
    streamBuildOutput(proc.stderr, rollingLog, logs, outputControl),
  ]);
  const buildExited = proc.exited.then((exitCode) => ({ kind: "build" as const, exitCode }));
  const deviceScanCompleted = deviceScan.then((diagnostic) => ({ kind: "device" as const, diagnostic }));

  let exitCode: number | null = null;
  let diagnostic: DeviceDiagnostic | null = null;
  const firstResult = await Promise.race([buildExited, deviceScanCompleted]);

  if (firstResult.kind === "device") {
    diagnostic = firstResult.diagnostic;
    if (diagnostic.issue) {
      outputControl.active = false;
      proc.kill("SIGTERM");
      const hardKill = setTimeout(() => proc.kill("SIGKILL"), 2000);
      await Promise.race([Promise.all([proc.exited, outputComplete]), delay(5000)]);
      clearTimeout(hardKill);

      rollingLog.clear();
      printRunLine(styles.error(kleur.bold(`✕ Build Stopped in ${formatDuration(Date.now() - startedAt)}`)));
      printDeviceDiagnostic(diagnostic);
      printRunLine(`Build logs: ${styles.label(writeBuildLog(args, null, startedAt, logs))}`);
      throw new SilentExit(1);
    }

    exitCode = await proc.exited;
  } else {
    exitCode = firstResult.exitCode;
    if (exitCode !== 0) {
      await outputComplete;
      rollingLog.clear();
      printRunLine(styles.error(kleur.bold(`✕ Build Failed in ${formatDuration(Date.now() - startedAt)}`)));
      const status = createLiveStatus();
      if (!deviceScanDone) status.set("Checking Device Availability...");
      diagnostic = await deviceScan;
      status.clear();
      if (diagnostic.issue || exitCode === 70) {
        printDeviceDiagnostic(diagnostic);
        printRunLine(`Build logs: ${styles.label(writeBuildLog(args, exitCode, startedAt, logs))}`);
      } else {
        printBuildFailureDetails(exitCode, logs, writeBuildLog(args, exitCode, startedAt, logs));
      }
      throw new SilentExit(1);
    }
  }

  await outputComplete;

  rollingLog.clear();
  if (exitCode !== 0) {
    printRunLine(styles.error(kleur.bold(`✕ Build Failed in ${formatDuration(Date.now() - startedAt)}`)));
    if (diagnostic && (diagnostic.issue || exitCode === 70)) {
      printDeviceDiagnostic(diagnostic);
      printRunLine(`Build logs: ${styles.label(writeBuildLog(args, exitCode, startedAt, logs))}`);
    } else {
      printBuildFailureDetails(exitCode, logs, writeBuildLog(args, exitCode, startedAt, logs));
    }
    throw new SilentExit(1);
  }
  printRunLine(styles.success(kleur.bold(`✓ Build Completed in ${formatDuration(Date.now() - startedAt)}`)));
}

async function installApp(device: Device, app: string, status = createLiveStatus()): Promise<void> {
  status.set(`Installing on ${device.name}`);
  const result = await runCommand(["xcrun", "devicectl", "device", "install", "app", "--device", device.id, app], {
    timeoutMs: 120000,
  });
  status.clear();
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || "devicectl install failed.");
  }
}

async function bundleIdentifier(app: string): Promise<string> {
  const plist = join(app, "Info.plist");
  const result = await runCommand(["/usr/libexec/PlistBuddy", "-c", "Print :CFBundleIdentifier", plist]);
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || "Could not read CFBundleIdentifier.");
  }
  return result.stdout.trim();
}

async function launchApp(device: Device, bundleId: string, status = createLiveStatus()): Promise<void> {
  status.set(`Launching on ${device.name}`);
  const result = await runCommand(["xcrun", "devicectl", "device", "process", "launch", "--device", device.id, bundleId], {
    timeoutMs: 60000,
  });
  status.clear();
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || "devicectl launch failed.");
  }
}

async function run(options: CliOptions): Promise<void> {
  let config = readConfig();
  if (!hasRunConfig(config, options)) {
    config = await configureProject();
  }

  const target = resolveTarget(config, options);
  const scheme = resolveScheme(config, options);
  const device = resolveDevice(config, options);
  const derivedDataPath = options.derivedData ?? config.derivedDataPath ?? DEFAULT_DERIVED_DATA;

  const nextConfig: DinggyConfig = {
    device: {
      id: device.id,
      name: device.name,
      platform: device.platform,
    },
    scheme,
    derivedDataPath,
    [target.kind]: target.path,
  };
  writeConfig(nextConfig);

  ensureDir(dirname(derivedDataPath));
  const runStartedAt = Date.now();
  const timings: PerfPhaseTimings = {};
  let failedPhase: RunPhase | undefined;
  let didError = false;

  try {
    failedPhase = "build";
    await measurePhase(timings, "build", () => buildApp(target, scheme, device, derivedDataPath));

    failedPhase = "resolve-app";
    const builtApp = await resolveBuiltAppPath(target, scheme, device, nextConfig);
    const status = createLiveStatus();

    failedPhase = "install";
    await measurePhase(timings, "install", () => installApp(device, builtApp, status));

    failedPhase = "bundle-id";
    const bundleId = await bundleIdentifier(builtApp);

    if (options.launch) {
      failedPhase = "launch";
      await measurePhase(timings, "launch", () => launchApp(device, bundleId, status));
      printRunLine(kleur.bold(`✓ App Launched in ${formatDuration(Date.now() - runStartedAt)} ${launchEmoji()}`));
    } else {
      printRunLine(styles.success(kleur.bold(`✓ App Installed in ${formatDuration(Date.now() - runStartedAt)}`)));
    }

    failedPhase = undefined;
    printRunDetail("Bundle ID", bundleId);
    printRunDetail("Target", device.name);
  } catch (error) {
    didError = true;
    throw error;
  } finally {
    const finishedAt = Date.now();
    try {
      writePerfEntry({
        version: 1,
        startedAt: new Date(runStartedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        scheme,
        launchRequested: options.launch,
        didError,
        ...(didError && failedPhase ? { failedPhase } : {}),
        timingsMs: {
          ...timings,
          total: finishedAt - runStartedAt,
        },
      });
    } catch (error) {
      if (!didError) {
        logError(`Could not write performance log: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function printDevices(options: CliOptions): Promise<void> {
  const devices = await listDevices();
  if (options.json) {
    console.log(JSON.stringify(devices, null, 2));
    return;
  }

  if (devices.length === 0) {
    console.log(styles.muted("No available physical devices found."));
    return;
  }

  for (const device of devices) {
    console.log(`${styles.label(device.id)}  ${formatDevice(device)}`);
  }
}

function printInfoDetail(label: string, value: string): void {
  console.log(`  ${styles.label(`${label}:`)} ${value}`);
}

function printInfo(options: CliOptions): void {
  const config = readConfig();
  const derivedDataPath = config.derivedDataPath || DEFAULT_DERIVED_DATA;
  const derivedDataStats = pathStats(resolvePath(derivedDataPath));
  const buildLogsStats = pathStats(BUILD_LOG_DIR);
  const performance = perfSummary();

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          configPath: CONFIG_PATH,
          config,
          storage: {
            derivedData: {
              path: derivedDataPath,
              bytes: derivedDataStats.bytes,
              formatted: formatBytes(derivedDataStats.bytes),
            },
            buildLogs: {
              path: BUILD_LOG_DIR,
              bytes: buildLogsStats.bytes,
              formatted: formatBytes(buildLogsStats.bytes),
              count: buildLogsStats.files,
            },
            performance: {
              path: performance.path,
              count: performance.count,
            },
          },
          performance: {
            buildCount: performance.count,
            errorCount: performance.errorCount,
            errorRate: performance.errorRate,
            avgTotalMs: performance.avgTotalMs,
            formattedAvgTotal: performance.avgTotalMs === null ? null : formatDuration(performance.avgTotalMs),
            formattedErrorRate: formatPercent(performance.errorRate),
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const target = config.workspace
    ? `${config.workspace} ${styles.muted("(workspace)")}`
    : config.project
      ? `${config.project} ${styles.muted("(project)")}`
      : styles.muted("not configured");
  const device = config.device
    ? `${config.device.name ?? config.device.id} ${styles.muted(`(${config.device.id})`)}`
    : styles.muted("not configured");

  console.log(`${styles.title("Project Config")} ${styles.muted(CONFIG_PATH)}`);
  printInfoDetail("Device", device);
  printInfoDetail("Target", target);
  printInfoDetail("Scheme", config.scheme ?? styles.muted("not configured"));
  printInfoDetail("DerivedData", `${derivedDataPath} ${styles.muted(formatBytes(derivedDataStats.bytes))}`);
  printInfoDetail(
    "Build logs",
    `${BUILD_LOG_DIR} ${styles.muted(`${buildLogsStats.files} ${buildLogsStats.files === 1 ? "file" : "files"}, ${formatBytes(buildLogsStats.bytes)}`)}`,
  );
  console.log(`${styles.title("Performance")} ${styles.muted(PERF_PATH)}`);
  printInfoDetail("Builds", performance.count === 0 ? styles.muted("none recorded") : String(performance.count));
  printInfoDetail("Average", performance.avgTotalMs === null ? styles.muted("not available") : formatDuration(performance.avgTotalMs));
  printInfoDetail("Error rate", formatPercent(performance.errorRate));
}

type CleanTarget = "build-cache" | "build-logs" | "config";

function cleanBuildCache(config: DinggyConfig): void {
  const derivedDataPath = resolvePath(config.derivedDataPath || DEFAULT_DERIVED_DATA);
  const size = directorySize(derivedDataPath);
  printRunLine(runStyles.muted("Removing Build Cache"));
  rmSync(derivedDataPath, { recursive: true, force: true });
  printRunLine(styles.success(kleur.bold(`✓ Removed ${formatBytes(size)} ${runStyles.muted(derivedDataPath)}`)));
}

function cleanBuildLogs(): void {
  const size = directorySize(BUILD_LOG_DIR);
  printRunLine(runStyles.muted("Removing Build Error Logs"));
  rmSync(BUILD_LOG_DIR, { recursive: true, force: true });
  printRunLine(styles.success(kleur.bold(`✓ Removed ${formatBytes(size)} ${runStyles.muted(BUILD_LOG_DIR)}`)));
}

function cleanConfig(): void {
  printRunLine(runStyles.muted("Removing Config"));
  rmSync(CONFIG_PATH, { force: true });
  printRunLine(styles.success(kleur.bold(`✓ Removed Config ${runStyles.muted(CONFIG_PATH)}`)));
}

async function clean(options: CliOptions): Promise<void> {
  const config = readConfig();
  const derivedDataPath = resolvePath(config.derivedDataPath || DEFAULT_DERIVED_DATA);
  const buildCacheSize = directorySize(derivedDataPath);
  const buildLogsSize = directorySize(BUILD_LOG_DIR);
  let targets: CleanTarget[] = ["build-cache", "build-logs"];

  if (options.force) {
    targets = ["build-cache", "build-logs"];
  } else {
    const selected = await p.multiselect<CleanTarget>({
      message: "Select what to clean",
      options: [
        {
          label: "Build cache",
          value: "build-cache",
          hint: `${formatBytes(buildCacheSize)} ${config.derivedDataPath || DEFAULT_DERIVED_DATA}`,
        },
        {
          label: "Build error logs",
          value: "build-logs",
          hint: `${formatBytes(buildLogsSize)} ${BUILD_LOG_DIR}`,
        },
        {
          label: "Config",
          value: "config",
          hint: CONFIG_PATH,
        },
      ],
      initialValues: ["build-cache", "build-logs"],
      required: false,
    });
    if (p.isCancel(selected)) {
      p.cancel("Cancelled.");
      process.exit(1);
    }
    targets = selected;
  }

  if (targets.length === 0) {
    logInfo("Nothing selected.");
    return;
  }

  if (targets.includes("build-cache")) cleanBuildCache(config);
  if (targets.includes("build-logs")) cleanBuildLogs();
  if (targets.includes("config")) cleanConfig();
}

async function main(): Promise<void> {
  const { command, options, help } = parseArgs(process.argv.slice(2));
  if (help || command === "help") {
    printMainHelp();
    return;
  }

  if (command === "run") {
    await run(options);
    return;
  }

  if (command === "devices") {
    await printDevices(options);
    return;
  }

  if (command === "config") {
    if (hasConfigUpdates(options)) {
      updateConfig(options);
      return;
    }
    await configureProject();
    return;
  }

  if (command === "info") {
    printInfo(options);
    return;
  }

  if (command === "clean") {
    await clean(options);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  if (error instanceof SilentExit) {
    process.exit(error.code);
  }
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
