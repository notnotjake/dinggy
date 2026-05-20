import kleur from "kleur";

const accent = (text: string): string => (kleur.enabled ? `\x1b[1m\x1b[38;2;244;63;94m${text}\x1b[22m\x1b[39m` : text);

const styles = {
  command: accent,
  label: kleur.bold,
  option: kleur.gray,
  muted: kleur.dim().white,
};

function commandSyntax(commands: string[], rest = ""): string {
  return `${commands.map(styles.command).join(" ")}${rest ? ` ${styles.muted(rest)}` : ""}`;
}

function optionSyntax(option: string, rest = ""): string {
  return `${styles.option(option)}${rest ? ` ${styles.muted(rest)}` : ""}`;
}

function printRow(rawLeft: string, styledLeft: string, description: string): void {
  console.log(`  ${styledLeft}${" ".repeat(Math.max(1, 30 - rawLeft.length))}${description}`);
}

export function isHelpFlag(value?: string): boolean {
  return value === "-h" || value === "--help";
}

export function printMainHelp(): void {
  console.log(`${styles.command("dinggy")} ${styles.muted("run your apps without opening Xcode")}`);
  console.log("");
  console.log(`${styles.label("Usage")}:`);
  printRow("dinggy run [options]", commandSyntax(["dinggy", "run"], "[options]"), "Build and launch with explicit values");
  printRow("dinggy clean [--force]", commandSyntax(["dinggy", "clean"], "[--force]"), "Clean build cache and build logs");
  console.log("");
  console.log(`${styles.label("Commands")}:`);
  printRow("run [options]", commandSyntax(["run"], "[options]"), "Build, install, and launch on configured device");
  printRow("config [options]", commandSyntax(["config"], "[options]"), "Update project config");
  printRow("clean [--force]", commandSyntax(["clean"], "[--force]"), "Clean build cache and logs");
  printRow("info [--json]", commandSyntax(["info"], "[--json]"), "Print project config and performance");
  printRow("devices [--json]", commandSyntax(["devices"], "[--json]"), "List available devices");
  console.log("");
  console.log(`${styles.label("Options")}:`);
  printRow("--no-launch", optionSyntax("--no-launch"), "Build and install without launching");
  printRow("--device <id>", optionSyntax("--device", "<id>"), "Device identifier for run/config");
  printRow("--scheme <name>", optionSyntax("--scheme", "<name>"), "Xcode scheme for run/config");
  printRow("--workspace <path>", optionSyntax("--workspace", "<path>"), "Xcode workspace for run/config");
  printRow("--project <path>", optionSyntax("--project", "<path>"), "Xcode project for run/config");
  printRow("--derived-data <path>", optionSyntax("--derived-data", "<path>"), "DerivedData path for run/config");
}
