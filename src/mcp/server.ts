import { createInterface } from "node:readline";
import pkg from "../../package.json" with { type: "json" };
import { TOOL_LIST, TOOL_MAP } from "./tool";

/**
 * Minimal MCP server over stdio: newline-delimited JSON-RPC on stdin/stdout.
 *
 * Written by hand rather than with @modelcontextprotocol/sdk because the SDK
 * pulls 91 packages (express, hono, jose, eventsource) to support HTTP
 * transports and OAuth, none of which this server uses. The surface a stdio
 * tool host actually calls is four methods wide.
 */

const SERVER_NAME = "tabelog";
const LATEST_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSION_LIST = ["2025-06-18", "2025-03-26", "2024-11-05"];

const ERROR_CODE = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParam: -32602,
  internal: -32603,
} as const;

interface RpcRequest {
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const send = (payload: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...payload })}\n`);
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const handleMethod = async (method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> => {
  switch (method) {
    case "initialize": {
      // Echo the client's version when we speak it, so an older host is not
      // forced onto a newer revision it may not understand.
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : undefined;
      const protocolVersion =
        requested !== undefined && SUPPORTED_PROTOCOL_VERSION_LIST.includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: pkg.version },
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: TOOL_LIST.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const tool = TOOL_MAP.get(name);
      if (!tool) {
        throw new RpcError(ERROR_CODE.invalidParam, `Unknown tool: ${name || "(none)"}`);
      }
      const input = (params.arguments ?? {}) as Record<string, unknown>;
      try {
        return { content: [{ type: "text", text: await tool.run(input) }] };
      } catch (error) {
        // A failed Tabelog fetch is a tool result, not a protocol fault: report it
        // as isError so the host shows the model what went wrong and stays up.
        return { content: [{ type: "text", text: errorMessage(error) }], isError: true };
      }
    }
    default:
      throw new RpcError(ERROR_CODE.methodNotFound, `Unknown method: ${method}`);
  }
};

const handleLine = async (line: string): Promise<void> => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request: RpcRequest;
  try {
    request = JSON.parse(trimmed) as RpcRequest;
  } catch {
    send({ id: null, error: { code: ERROR_CODE.parse, message: "Invalid JSON" } });
    return;
  }

  const id = request.id;
  const isNotification = id === undefined || id === null;

  if (typeof request.method !== "string") {
    if (!isNotification) {
      send({ id, error: { code: ERROR_CODE.invalidRequest, message: "Missing method" } });
    }
    return;
  }

  // Notifications get no reply at all, by spec. notifications/initialized and
  // notifications/cancelled both land here and are correctly ignored.
  if (isNotification) return;

  try {
    send({ id, result: await handleMethod(request.method, request.params ?? {}) });
  } catch (error) {
    const code = error instanceof RpcError ? error.code : ERROR_CODE.internal;
    send({ id, error: { code, message: errorMessage(error) } });
  }
};

export const runMcp = async (): Promise<void> => {
  // stdout belongs to JSON-RPC from here on. Redirect the console writers that
  // land there by default, so a stray log in shared code cannot corrupt a frame.
  console.log = console.error;
  console.info = console.error;
  console.warn = console.error;

  const reader = createInterface({ input: process.stdin });
  // Lines are dispatched without awaiting so a slow Tabelog fetch does not block
  // the next request; each reply carries its own id.
  reader.on("line", (line) => {
    void handleLine(line);
  });
  await new Promise<void>((resolve) => {
    reader.on("close", () => resolve());
  });
};
