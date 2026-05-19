import kleur from "kleur";

const styles = {
  title: kleur.bold().cyan,
  label: kleur.bold().white,
  muted: kleur.gray,
};

export function isHelpFlag(value?: string): boolean {
  return value === "-h" || value === "--help";
}

export function printMainHelp(): void {
  console.log(`${styles.title("dinggy")} ${styles.muted("run iOS apps on real devices")}`);
  console.log("");
  console.log(styles.label("Usage"));
  console.log("  dinggy run [options]");
  console.log("  dinggy devices");
  console.log("  dinggy config [edit]");
  console.log("  dinggy config [options]");
  console.log("  dinggy clean [--force]");
  console.log("");
  console.log(styles.label("Run options"));
  console.log(`  ${styles.label("--device <id>")}          ${styles.muted("Device identifier to build and launch on.")}`);
  console.log(`  ${styles.label("--scheme <name>")}        ${styles.muted("Xcode scheme.")}`);
  console.log(`  ${styles.label("--workspace <path>")}     ${styles.muted("Xcode workspace.")}`);
  console.log(`  ${styles.label("--project <path>")}       ${styles.muted("Xcode project.")}`);
  console.log(`  ${styles.label("--derived-data <path>")}  ${styles.muted("DerivedData path. Default: .dinggy/DerivedData.")}`);
  console.log(`  ${styles.label("--no-launch")}            ${styles.muted("Build and install without launching.")}`);
  console.log("");
  console.log(styles.label("Config options"));
  console.log(`  ${styles.label("--device <id>")}          ${styles.muted("Save preferred device identifier.")}`);
  console.log(`  ${styles.label("--scheme <name>")}        ${styles.muted("Save preferred Xcode scheme.")}`);
  console.log(`  ${styles.label("--workspace <path>")}     ${styles.muted("Save preferred Xcode workspace.")}`);
  console.log(`  ${styles.label("--project <path>")}       ${styles.muted("Save preferred Xcode project.")}`);
  console.log(`  ${styles.label("--derived-data <path>")}  ${styles.muted("Save DerivedData path.")}`);
  console.log("");
  console.log(styles.label("Clean options"));
  console.log(`  ${styles.label("-f, --force")}           ${styles.muted("Clean build cache without prompting.")}`);
  console.log("");
  console.log(styles.label("Examples"));
  console.log("  dinggy run");
  console.log("  dinggy devices");
  console.log("  dinggy config edit");
  console.log("  dinggy config --device 00008110-... --scheme MyApp");
  console.log("  dinggy clean");
  console.log("  dinggy clean --force");
  console.log("  dinggy run --device 00008110-... --scheme MyApp --workspace MyApp.xcworkspace");
}
