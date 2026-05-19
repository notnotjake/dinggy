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
  console.log(`${styles.command("dinggy")} ${styles.muted("run iOS apps on real devices")}`);
  console.log("");
  console.log(`${styles.label("Usage")}:`);
  printRow("dinggy", commandSyntax(["dinggy"]), "Build, install, and launch interactively");
  printRow("dinggy run [options]", commandSyntax(["dinggy", "run"], "[options]"), "Build and launch with explicit values");
  printRow("dinggy clean [--force]", commandSyntax(["dinggy", "clean"], "[--force]"), "Clean build cache");
  console.log("");
  console.log(`${styles.label("Commands")}:`);
  printRow("run", commandSyntax(["run"]), "Build, install, and launch on a device");
  printRow("devices", commandSyntax(["devices"]), "List available physical devices");
  printRow("config [edit]", commandSyntax(["config"], "[edit]"), "Print or update saved project config");
  printRow("clean", commandSyntax(["clean"]), "Clean build cache");
  printRow("help", commandSyntax(["help"]), "Print help text");
  console.log("");
  console.log(`${styles.label("Options")}:`);
  printRow("--device <id>", optionSyntax("--device", "<id>"), "Device identifier for run/config");
  printRow("--scheme <name>", optionSyntax("--scheme", "<name>"), "Xcode scheme for run/config");
  printRow("--workspace <path>", optionSyntax("--workspace", "<path>"), "Xcode workspace for run/config");
  printRow("--project <path>", optionSyntax("--project", "<path>"), "Xcode project for run/config");
  printRow("--derived-data <path>", optionSyntax("--derived-data", "<path>"), "DerivedData path for run/config");
  printRow("--no-launch", optionSyntax("--no-launch"), "Build and install without launching");
  printRow("--json", optionSyntax("--json"), "Print devices as JSON");
  printRow("-f, --force", `${styles.option("-f")}, ${styles.option("--force")}`, "Clean build cache without prompting");
}
