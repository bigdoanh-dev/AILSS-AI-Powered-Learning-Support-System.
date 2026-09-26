import { startService } from "../../../packages/runtime/src/index.js";
import { mediaRuntime } from "../../learning-service/src/media/config.js";
import { mediaDeliveryRouter } from "./router.js";
await startService(
  {
    serviceId: "media-delivery",
    ownerDomain: "Authorized private media delivery",
    defaultPort: 8211,
    publicApiIds: [],
    internalApiIds: [],
    producedEvents: [],
    consumedQueues: [],
  },
  {
    configure: (app, config) => {
      const settings = mediaRuntime(config);
      if (!settings) throw Error("MEDIA_DELIVERY_CONFIGURATION_REQUIRED");
      app.use(
        mediaDeliveryRouter(
          settings.storage,
          settings.secret,
          config.PLATFORM_TENANT_ID,
          config.MEDIA_ALLOWED_ORIGINS.split(",").filter(Boolean),
        ),
      );
      return undefined;
    },
  },
);
