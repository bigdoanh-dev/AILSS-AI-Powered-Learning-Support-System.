import type { IncomingMessage, ServerResponse } from "node:http";
import type { EventEmitter } from "node:events";
export function attachAiRealtime(
  server: EventEmitter,
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  origin: string,
): () => void;
