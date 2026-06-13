import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../paths";
import { PiAgent, parsePiModelCatalog, toPiModelConfigOption } from "./PiAgent";

const MY_AGENT_PACKAGE = path.join(REPO_ROOT, "..", "my-agent");

describe("PiAgent", () => {
  it("translates Pi launch args into a generated pi-acp launcher", () => {
    const agent = new PiAgent({
      args: ["-e", MY_AGENT_PACKAGE],
      skillPaths: ["/tmp/a/skills", "/tmp/b/skills"],
      extensionPaths: ["/tmp/parentMessageTool.ts"],
      agentName: "MyPiOpenAiAgent",
      cwd: REPO_ROOT,
    });

    const options = agent as unknown as { options: { args: string[]; env: Record<string, string> } };
    expect(options.options.args.at(0)).toContain("pi-acp/dist/index.js");
    expect(options.options.env.PI_ACP_PI_COMMAND).toContain(".var/agent-station/generated/pi-launchers/");

    const launcher = readFileSync(options.options.env.PI_ACP_PI_COMMAND, "utf8");
    expect(launcher).toContain(JSON.stringify("pi"));
    expect(launcher).toContain(JSON.stringify(["-e", MY_AGENT_PACKAGE]));
    expect(launcher).toContain(JSON.stringify(["/tmp/a/skills", "/tmp/b/skills"]));
    expect(launcher).toContain(JSON.stringify(["/tmp/parentMessageTool.ts"]));
  });

  it("parses pi model catalog rows into ACP-friendly metadata", () => {
    const parsed = parsePiModelCatalog([
      "provider      model         context  max-out  thinking  images",
      "openai-codex  gpt-5.4       272K     128K     yes       yes",
      "openai-codex  gpt-5.4-mini  272K     128K     yes       yes",
    ].join("\n"));

    expect(parsed.get("openai-codex/gpt-5.4")).toEqual({
      contextTokens: 272000,
      description: "272K context · 128K max out · thinking · images",
    });
  });

  it("converts pi model state into a model config option", () => {
    const config = toPiModelConfigOption({
      currentModelId: "openai-codex/gpt-5.4",
      availableModels: [
        { modelId: "openai-codex/gpt-5.4", name: "openai-codex/GPT-5.4" },
        { modelId: "openai-codex/gpt-5.4-mini", name: "openai-codex/GPT-5.4 Mini" },
      ],
    }, new Map([
      ["openai-codex/gpt-5.4", { description: "272K context · 128K max out · thinking · images" }],
    ]));

    expect(config).toEqual({
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "openai-codex/gpt-5.4",
      options: [
        {
          value: "openai-codex/gpt-5.4",
          name: "openai-codex/GPT-5.4",
          description: "272K context · 128K max out · thinking · images",
        },
        {
          value: "openai-codex/gpt-5.4-mini",
          name: "openai-codex/GPT-5.4 Mini",
        },
      ],
    });
  });
});
