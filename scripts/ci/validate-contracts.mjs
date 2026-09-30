import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import YAML from "yaml";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const api = await readJson("contracts/api-registry.json");
const queries = await readJson("contracts/query-registry.json");
const events = await readJson("contracts/event-registry.json");
function unique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
}
if (api.publicCount !== 116 || api.public.length !== 116)
  throw new Error("Public API registry must contain exactly 116 contracts");
if (api.internalCount !== 15 || api.internal.length !== 15)
  throw new Error("Internal API registry must contain exactly 15 contracts");
if (queries.count !== 84 || queries.queries.length !== 84)
  throw new Error("Query registry must contain exactly 84 Query IDs");
if (events.count !== 22 || events.events.length !== 22)
  throw new Error("Event registry must contain exactly 22 events");
unique(
  api.public.map((value) => value.id),
  "public API IDs",
);
unique(
  api.internal.map((value) => value.id),
  "internal API IDs",
);
unique(
  queries.queries.map((value) => value.queryId),
  "Query IDs",
);
unique(
  events.events.map((value) => value.eventType),
  "event types",
);
const queryIds = new Set(queries.queries.map((value) => value.queryId));
for (const contract of [...api.public, ...api.internal])
  for (const queryId of contract.queryIds ?? [])
    if (!queryIds.has(queryId)) throw new Error(`${contract.id} references unknown ${queryId}`);
const eventTypes = new Set(events.events.map((value) => value.eventType));
for (const contract of [...api.public, ...api.internal])
  if (contract.event && !eventTypes.has(contract.event))
    throw new Error(`${contract.id} references unknown ${contract.event}`);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
await readJson("contracts/events/envelope-v1.schema.json").then((schema) => ajv.compile(schema));
for (const event of events.events)
  await readJson(`contracts/events/${event.schema}`).then((schema) => ajv.compile(schema));

function operationIds(document) {
  return Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .map((operation) => operation.operationId)
    .filter(Boolean);
}
function operationContracts(document) {
  return Object.entries(document.paths).flatMap(([path, pathItem]) =>
    Object.entries(pathItem)
      .filter(([, operation]) => operation?.operationId)
      .map(([method, operation]) => ({ id: operation.operationId, method: method.toUpperCase(), path })),
  );
}
function assertRegistryMatchesOpenApi(registry, document, label) {
  const actual = new Map(operationContracts(document).map((operation) => [operation.id, operation]));
  for (const expected of registry) {
    const operation = actual.get(expected.id);
    if (!operation) throw new Error(`${label} OpenAPI is missing ${expected.id}`);
    if (operation.method !== expected.method || operation.path !== expected.path)
      throw new Error(
        `${label} ${expected.id} registry/OpenAPI mismatch: ${expected.method} ${expected.path} vs ${operation.method} ${operation.path}`,
      );
  }
}
const publicOpenApi = YAML.parse(await readFile("contracts/openapi/public-v1.yaml", "utf8"));
const internalOpenApi = YAML.parse(await readFile("contracts/openapi/internal-v1.yaml", "utf8"));
if (publicOpenApi.openapi !== "3.1.0" || operationIds(publicOpenApi).length !== 116)
  throw new Error("Public OpenAPI must expose 116 OpenAPI 3.1 operations");
if (internalOpenApi.openapi !== "3.1.0" || operationIds(internalOpenApi).length !== 15)
  throw new Error("Internal OpenAPI must expose 15 OpenAPI 3.1 operations");
assertRegistryMatchesOpenApi(api.public, publicOpenApi, "Public");
assertRegistryMatchesOpenApi(api.internal, internalOpenApi, "Internal");
const businessServices = new Set(
  api.public.map((value) => value.service).filter((value) => value !== "Notification"),
);
if (
  businessServices.size !== 6 ||
  !["Identity", "Learning", "Classroom", "Assessment", "Interaction", "AI"].every((value) =>
    businessServices.has(value),
  )
)
  throw new Error("Business service inventory must remain six");
const packageJson = await readJson("package.json");
if (
  Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }).some((name) =>
    /redis/i.test(name),
  )
)
  throw new Error("Redis dependency is forbidden by Phase 5 errata");

const callback = api.public.find((operation) => operation.id === "LRN-31");
if (
  api.externalCallbacks?.length !== 1 ||
  api.externalCallbacks[0] !== "LRN-31" ||
  callback?.auth !== "SePayApiKey"
)
  throw new Error("External callback inventory mismatch");
for (const table of ["sepay_transaction_by_id", "sepay_payment_by_order"])
  if (
    !queries.queries.some(
      (query) =>
        query.owner === "Learning" && query.tables.includes(table) && query.apiConsumers.includes("LRN-31"),
    )
  )
    throw new Error(`Unregistered callback table ${table}`);

console.log(
  JSON.stringify({
    stage: "contract-validation",
    status: "PASS",
    publicApis: 116,
    businessServices: businessServices.size,
    internalApis: 15,
    queryIds: 84,
    events: 22,
    openApi: "3.1.0",
    redis: false,
  }),
);
