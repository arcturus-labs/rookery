import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { AGENT_CLIENT_ROOT, REPO_ROOT } from "../paths.js";
import { BaseAgent, type BaseAgentOptions } from "./BaseAgent.js";
import type { AgentRestartMetadata } from "./sessionLog.js";
import type { AcpConfigOption } from "../../shared/acp.js";

export interface PiAgentOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  startupTimeoutMs?: number;
  skillPaths?: string[];
  extensionPaths?: string[];
  agentName?: string;
}

type PiModelEntry = {
  modelId: string;
  name: string;
  description?: string;
};
type PiModelState = {
  availableModels: PiModelEntry[];
  currentModelId: string;
};

type PiUsageSnapshot = {
  totalTokens: number;
  totalCost: number | null;
  modelId?: string;
};

type PiModelMetadata = {
  contextTokens?: number;
  description?: string;
};

const DEFAULT_ARGS: string[] = [];
const PI_ACP_ENTRYPOINT = path.join(AGENT_CLIENT_ROOT, "node_modules", "pi-acp", "dist", "index.js");
const GENERATED_LAUNCHER_DIR = path.join(REPO_ROOT, ".var", "agent-station", "generated", "pi-launchers");
const DEFAULT_PI_SESSION_DIR = path.join(process.env.HOME ?? "", ".pi", "agent", "sessions");
const piModelMetadataCache = new Map<string, Map<string, PiModelMetadata>>();

function uniqueNonEmpty(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).filter((value) => value.length > 0))];
}

function ensurePiLauncher(options: { command: string; args: string[]; skillPaths: string[]; extensionPaths: string[] }): string {
  mkdirSync(GENERATED_LAUNCHER_DIR, { recursive: true });

  const launcherSpec = JSON.stringify(options);
  const digest = createHash("sha256").update(launcherSpec).digest("hex").slice(0, 12);
  const launcherPath = path.join(GENERATED_LAUNCHER_DIR, `pi-launch-${digest}.mjs`);
  const launcherSource = `#!/usr/bin/env node
import { spawn } from "node:child_process";

const piBinary = ${JSON.stringify(options.command)};
const baseArgs = ${JSON.stringify(options.args)};
const skillPaths = ${JSON.stringify(options.skillPaths)};
const extensionPaths = ${JSON.stringify(options.extensionPaths)};
const forwardedArgs = process.argv.slice(2);
const extensionArgs = extensionPaths.flatMap((extensionPath) => ["-e", extensionPath]);
const skillArgs = skillPaths.flatMap((skillPath) => ["--skill", skillPath]);

const child = spawn(piBinary, [...baseArgs, ...forwardedArgs, ...extensionArgs, ...skillArgs], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

child.on("error", (error) => {
  process.stderr.write(String(error instanceof Error ? error.message : error) + "\\n");
  process.exit(1);
});
`;

  writeFileSync(launcherPath, launcherSource, "utf8");
  chmodSync(launcherPath, 0o755);
  return launcherPath;
}

function toBaseAgentOptions(options: PiAgentOptions, restartMetadata?: AgentRestartMetadata): BaseAgentOptions {
  const skillPaths = uniqueNonEmpty(options.skillPaths);
  const extensionPaths = uniqueNonEmpty(options.extensionPaths);
  const cwd = options.cwd ?? REPO_ROOT;
  const piCommand = options.command?.trim() || "pi";
  const launcherPath = ensurePiLauncher({
    command: piCommand,
    args: options.args ?? DEFAULT_ARGS,
    skillPaths,
    extensionPaths,
  });

  return {
    command: "node",
    args: [PI_ACP_ENTRYPOINT],
    env: {
      PI_ACP_PI_COMMAND: launcherPath,
    },
    cwd,
    sessionCwd: typeof restartMetadata?.cwd === "string" ? restartMetadata.cwd : cwd,
    startupTimeoutMs: options.startupTimeoutMs,
    agentName: options.agentName,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCompactTokenCount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return undefined;
  const amount = Number.parseFloat(match[1] ?? "");
  if (!Number.isFinite(amount)) return undefined;
  const unit = (match[2] ?? "").toUpperCase();
  const multiplier = unit === "M" ? 1_000_000 : unit === "B" ? 1_000_000_000 : unit === "K" ? 1_000 : 1;
  return Math.round(amount * multiplier);
}

export function parsePiModelCatalog(raw: string): Map<string, PiModelMetadata> {
  const lines = raw.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  if (lines.length < 2) return new Map();

  const metadata = new Map<string, PiModelMetadata>();
  for (const line of lines.slice(1)) {
    const parts = line.trim().split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const [provider, model, context, maxOut, thinking, images] = parts;
    const modelId = `${provider}/${model}`;
    const descriptionParts = [
      context ? `${context} context` : null,
      maxOut ? `${maxOut} max out` : null,
      thinking === "yes" ? "thinking" : null,
      images === "yes" ? "images" : null,
    ].filter((part): part is string => Boolean(part));
    metadata.set(modelId, {
      ...(context ? { contextTokens: parseCompactTokenCount(context) } : {}),
      ...(descriptionParts.length > 0 ? { description: descriptionParts.join(" · ") } : {}),
    });
  }

  return metadata;
}

function readPiUsageSnapshot(sessionFilePath: string): PiUsageSnapshot | null {
  const raw = readFileSync(sessionFilePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(record) || record.type !== "message" || !isObject(record.message)) continue;
    if (record.message.role !== "assistant" || !isObject(record.message.usage)) continue;
    const totalTokens = record.message.usage.totalTokens;
    if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens) || totalTokens <= 0) continue;
    const cost = isObject(record.message.usage.cost) && typeof record.message.usage.cost.total === "number"
      ? record.message.usage.cost.total
      : null;
    const provider = typeof record.message.provider === "string" ? record.message.provider : undefined;
    const model = typeof record.message.model === "string" ? record.message.model : undefined;
    return {
      totalTokens,
      totalCost: cost,
      ...(provider && model ? { modelId: `${provider}/${model}` } : {}),
    };
  }
  return null;
}

function findPiSessionFile(sessionId: string, rootDir = process.env.PI_CODING_AGENT_SESSION_DIR ?? DEFAULT_PI_SESSION_DIR): string | null {
  if (!rootDir || !existsSync(rootDir)) return null;
  const needle = `_${sessionId}.jsonl`;
  const stack = [rootDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) continue;
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(needle)) return entryPath;
    }
  }
  return null;
}

export function toPiModelConfigOption(modelState: PiModelState, metadata: Map<string, PiModelMetadata> = new Map()): AcpConfigOption {
  return {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: modelState.currentModelId,
    options: modelState.availableModels.map((model) => ({
      value: model.modelId,
      name: model.name,
      ...(metadata.get(model.modelId)?.description ?? model.description ?? null ? { description: metadata.get(model.modelId)?.description ?? model.description ?? undefined } : {}),
    })),
  };
}

export class PiAgent extends BaseAgent {
  private piModels: PiModelState | null = null;
  private piModelMetadata = new Map<string, PiModelMetadata>();
  private sessionFilePath: string | null = null;

  constructor(options: PiAgentOptions = {}, restartMetadata?: AgentRestartMetadata) {
    super(toBaseAgentOptions(options, restartMetadata), restartMetadata);
  }

  protected override async afterSessionStarted(result: unknown): Promise<void> {
    this.piModels = this.extractPiModelState(result);
    this.piModelMetadata = this.loadPiModelMetadata();
    if (this.piModels) this.emitConfigOptions([toPiModelConfigOption(this.piModels, this.piModelMetadata)]);
    this.sessionFilePath = this.sessionIdValue ? findPiSessionFile(this.sessionIdValue) : null;
    this.emitUsageFromSessionFile();
  }

  override async run(userMessage: string): Promise<void> {
    await super.run(userMessage);
    this.emitUsageFromSessionFile();
  }

  override async setConfigOption(configId: string, value: string): Promise<unknown> {
    if (configId !== "model") return await super.setConfigOption(configId, value);
    if (!this.sessionIdValue) throw new Error("ACP agent session is not initialized.");

    await this.sendRequest("session/set_model", { sessionId: this.sessionIdValue, modelId: value });
    if (this.piModels) {
      this.piModels = { ...this.piModels, currentModelId: value };
      const configOptions = [toPiModelConfigOption(this.piModels, this.piModelMetadata)];
      this.emitConfigOptions(configOptions);
      this.emitUsageFromSessionFile();
      return { configOptions };
    }

    return { configOptions: [] };
  }

  private extractPiModelState(result: unknown): PiModelState | null {
    if (!isObject(result) || !isObject(result.models)) return null;
    const currentModelId = typeof result.models.currentModelId === "string" ? result.models.currentModelId : null;
    const availableModels = Array.isArray(result.models.availableModels)
      ? result.models.availableModels.map((model) => {
        if (!isObject(model) || typeof model.modelId !== "string" || typeof model.name !== "string") return null;
        return {
          modelId: model.modelId,
          name: model.name,
          ...(typeof model.description === "string" ? { description: model.description } : {}),
        } satisfies PiModelEntry;
      }).filter((model): model is PiModelEntry => model !== null)
      : [];
    if (!currentModelId || availableModels.length === 0) return null;
    return { currentModelId, availableModels };
  }

  private loadPiModelMetadata(): Map<string, PiModelMetadata> {
    const launcherPath = this.options.env?.PI_ACP_PI_COMMAND;
    if (!launcherPath) return new Map();
    const cached = piModelMetadataCache.get(launcherPath);
    if (cached) return cached;

    try {
      const result = spawnSync(launcherPath, ["--list-models"], {
        cwd: this.getSessionCwd(),
        env: process.env,
        encoding: "utf8",
        timeout: this.options.startupTimeoutMs ?? 15_000,
      });
      const parsed = parsePiModelCatalog(`${result.stdout ?? ""}`);
      piModelMetadataCache.set(launcherPath, parsed);
      return parsed;
    } catch {
      return new Map();
    }
  }

  private emitUsageFromSessionFile(): void {
    if (!this.sessionIdValue) return;
    this.sessionFilePath ??= findPiSessionFile(this.sessionIdValue);
    if (!this.sessionFilePath) return;

    let usage: PiUsageSnapshot | null = null;
    try {
      usage = readPiUsageSnapshot(this.sessionFilePath);
    } catch {
      return;
    }
    if (!usage) return;

    const contextTokens = this.piModelMetadata.get(usage.modelId ?? this.piModels?.currentModelId ?? "")?.contextTokens;
    this.emitAcpUpdate({
      sessionUpdate: "usage_update",
      used: usage.totalTokens,
      size: contextTokens ?? usage.totalTokens,
      ...(usage.totalCost !== null ? { cost: { amount: usage.totalCost, currency: "USD" } } : {}),
    });
  }
}
