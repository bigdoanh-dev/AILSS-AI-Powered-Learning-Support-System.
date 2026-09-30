import { Router } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { FederationService } from "./service.js";

const text = z.string().trim().min(1).max(4_096);
const ltiLogin = z
  .object({
    iss: z.string().url().max(2_048),
    client_id: text,
    lti_deployment_id: text,
    login_hint: text,
    target_link_uri: z.string().url().max(2_048),
    lti_message_hint: text.optional(),
  })
  .strict();
const ltiLaunch = z.object({ state: text, id_token: z.string().min(100).max(32_768) }).strict();
const samlAcs = z.object({ RelayState: text, SAMLResponse: z.string().min(100).max(2_000_000) }).strict();

export function federationRouter(service: FederationService): Router {
  const router = Router();
  router.get("/api/v1/auth/saml/:organizationId/metadata", async (req, res, next) => {
    try {
      res
        .type("application/samlmetadata+xml")
        .send(await service.samlMetadata(uuidParam(req.params.organizationId)));
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/v1/auth/saml/:organizationId/login", async (req, res, next) => {
    try {
      res.redirect(302, await service.beginSaml(uuidParam(req.params.organizationId)));
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/v1/auth/saml/:organizationId/acs", async (req, res, next) => {
    try {
      const body = samlAcs.safeParse(req.body);
      if (!body.success) throw new AppError("SAML_REQUEST_INVALID", 422, "SAML ACS request is invalid");
      res.status(200).json({
        data: await service.completeSaml(
          uuidParam(req.params.organizationId),
          body.data.RelayState,
          body.data.SAMLResponse,
        ),
        meta: meta(),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/v1/auth/lti/login", async (req, res, next) => {
    try {
      const query = ltiLogin.safeParse(req.query);
      if (!query.success)
        throw new AppError("LTI_LOGIN_INVALID", 422, "LTI login initiation request is invalid");
      res.redirect(
        302,
        await service.beginLti({
          issuer: query.data.iss,
          clientId: query.data.client_id,
          deploymentId: query.data.lti_deployment_id,
          loginHint: query.data.login_hint,
          targetLinkUri: query.data.target_link_uri,
          ...(query.data.lti_message_hint ? { ltiMessageHint: query.data.lti_message_hint } : {}),
        }),
      );
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/v1/auth/lti/launch", async (req, res, next) => {
    try {
      const body = ltiLaunch.safeParse(req.body);
      if (!body.success) throw new AppError("LTI_LAUNCH_INVALID", 422, "LTI launch request is invalid");
      res
        .status(200)
        .json({ data: await service.completeLti(body.data.state, body.data.id_token), meta: meta() });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

const uuidParam = (value: string | undefined) => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success)
    throw new AppError("ORGANIZATION_ID_INVALID", 422, "Organization identifier is invalid");
  return parsed.data;
};
const meta = () => ({
  requestId: currentRequestContext()?.requestId ?? "",
  timestamp: new Date().toISOString(),
});
