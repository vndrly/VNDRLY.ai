import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environment = resolve(root, ".local/fastalpr-env");
const python = process.env.FASTALPR_PYTHON || resolve(environment, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} exited ${result.status}`);
}
if (!existsSync(python)) run(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-m", "venv", environment]);
run(python, ["-m", "pip", "install", "-r", "artifacts/api-server/fastalpr/requirements.txt"]);
// Resolve/download both models before restarting the API, never on the first photo.
run(python, ["-c", 'from fast_alpr import ALPR; ALPR(detector_model="yolo-v9-t-640-license-plate-end2end",ocr_model="cct-xs-v2-global-model"); print("FastALPR models ready")']);
