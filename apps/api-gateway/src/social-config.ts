import type { RequestHandler } from "express";

export function socialConfigHandler(googleWebClientId: string): RequestHandler {
  return (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.json({ data: { googleClientId: googleWebClientId.trim() } });
  };
}
