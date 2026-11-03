"""Build an update ZIP for the existing public VNDRLY.ai listing; never publish it."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path, help="Destination ZIP outside the source tree")
args = parser.parse_args()
repo = Path(__file__).resolve().parent.parent
root = repo / "integrations/chatgpt-plugin"
manifest = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
assert manifest["name"] == "dev-6ac4f61e0aac8191b7f7b4fbbc5822b0"
# The installed private package and the already-existing public publisher use
# distinct package identifiers. Build for the public listing without rewriting
# the source private identity or creating a new listing.
manifest["name"] = "vndrly-ai"
extension = manifest["extensions"]["com.openai"]
extension.pop("apps", None)
interface = extension["interface"]
interface["defaultPrompt"] = interface["defaultPrompt"][:3]
interface["shortDescription"] = "Connected field operations"
interface.update(supportURL="https://vndrly.ai", privacyPolicyURL="https://vndrly.ai/legal/privacy", termsOfServiceURL="https://vndrly.ai/legal/terms")
mcp = {"mcpServers": {"vndrly-assistant": {"url": "https://vndrly.ai/api/assistant-connection/mcp", "type": "streamable-http"}}, "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"}
commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True, timeout=15).strip()
source = {"commit": commit, "version": manifest["version"], "existingPluginId": "plugin_asdk_app_6ac4fdaf65b881919b596b4b046090e8"}
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as archive:
    for relative in ["plugin.json", ".codex-plugin/plugin.json", ".codex-plugin/.codex-plugin/plugin.json"]:
        archive.writestr(relative, json.dumps(manifest, indent=2) + "\n")
    for relative in ["assets", "skills"]:
        for path in sorted((root / relative).rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root).as_posix())
    archive.write(root / "RELEASE.md", "RELEASE.md")
    archive.writestr("mcp.json", json.dumps(mcp, indent=2) + "\n")
    archive.writestr("release-source.json", json.dumps(source, indent=2) + "\n")
print(json.dumps({"path": str(args.output.resolve()), **source, "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest()}))
