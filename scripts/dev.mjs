import { spawn } from "node:child_process";

const commands = [
  ["server", "npm", ["run", "dev:server"]],
  ["client", "npm", ["run", "dev:client"]]
];

const children = commands.map(([name, command, args]) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code) => {
    if (code && code !== 0) {
      process.exitCode = code;
      for (const other of children) {
        if (other !== child && !other.killed) other.kill();
      }
    }
  });

  return child;
});

function stop() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
