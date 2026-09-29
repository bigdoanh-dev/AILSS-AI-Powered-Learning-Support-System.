import type { IncomingMessage, ServerResponse } from "node:http";
export function createSessionAdapter(options: {
  gateway: URL | string;
  origin: string;
  production?: boolean;
  googleClientId?: string;
  appleClientId?: string;
  appleRedirectUri?: string;
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
