import { execFileAsync } from "./exec.js";

export async function findCommandInPath(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("sh", ["-c", `command -v ${command}`], {
      cwd: process.cwd(),
    });
    const commandPath = stdout.trim().split("\n")[0];
    return commandPath && commandPath.length > 0 ? commandPath : null;
  } catch {
    return null;
  }
}
