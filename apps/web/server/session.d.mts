import type { IncomingMessage, ServerResponse } from "node:http";
export function createSessionAdapter(options: {
  gateway: URL | string;
  origin: string;
  production?: boolean;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
