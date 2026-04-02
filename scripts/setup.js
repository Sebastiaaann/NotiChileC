const { spawnSync } = require("node:child_process");
const { platform } = require("node:os");
const { join } = require("node:path");

const isWindows = platform() === "win32";
const command = isWindows ? "cmd.exe" : "bash";
const args = isWindows
  ? ["/c", join("scripts", "setup.bat")]
  : [join("scripts", "setup.sh")];

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error("[setup] No se pudo ejecutar el setup:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
