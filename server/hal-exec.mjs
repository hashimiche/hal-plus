import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function isExecutable(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return false;
  }
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getMcpConfigPath() {
  return process.env.HAL_MCP_CONFIG || path.join(os.homedir(), ".hal", "mcp", "hal-mcp.json");
}

function getManagedBinaryPath() {
  return process.env.HAL_MCP_BINARY || path.join(os.homedir(), ".hal", "bin", "hal-mcp");
}

async function resolveFromPath(commandName) {
  try {
    const { stdout } = await execFileAsync("which", [commandName]);
    const resolved = (stdout || "").trim();
    return resolved || null;
  } catch {
    return null;
  }
}

export function createHalExecutableResolver() {
  let halExecutableCache = null;

  return async function resolveHalExecutable() {
    if (halExecutableCache) {
      return halExecutableCache;
    }

    const envOverride = (process.env.HAL_BINARY || "").trim();
    if (envOverride) {
      halExecutableCache = envOverride;
      return halExecutableCache;
    }

    const pathResolved = await resolveFromPath("hal");
    if (pathResolved) {
      halExecutableCache = pathResolved;
      return halExecutableCache;
    }

    try {
      const configRaw = await readFile(getMcpConfigPath(), "utf8");
      const config = JSON.parse(configRaw);
      const configured = config?.mcpServers?.hal?.command;
      if (typeof configured === "string" && configured.trim() !== "") {
        const cmd = configured.trim();
        const baseName = path.basename(cmd).toLowerCase();
        if (baseName.includes("hal-mcp")) {
          // MCP server binaries are not safe to use for direct HAL CLI execution.
        } else if (path.isAbsolute(cmd)) {
          if (await isExecutable(cmd)) {
            halExecutableCache = cmd;
            return halExecutableCache;
          }
        } else {
          halExecutableCache = cmd;
          return halExecutableCache;
        }
      }
    } catch {
      // Continue with managed binary/path fallback.
    }

    halExecutableCache = "hal";
    return halExecutableCache;
  };
}

export function createHalRunner() {
  const resolveHalExecutable = createHalExecutableResolver();

  return async function runHal(args) {
    const halExecutable = await resolveHalExecutable();
    const { stdout, stderr } = await execFileAsync(halExecutable, args, {
      timeout: 15000,
      maxBuffer: 1024 * 1024
    });
    return `${stdout || ""}${stderr || ""}`;
  };
}
