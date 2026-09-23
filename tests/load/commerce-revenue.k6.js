import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  scenarios: {
    catalog: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.K6_RATE ?? 4),
      timeUnit: "1s",
      duration: __ENV.K6_DURATION ?? "2m",
      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
  },
};

const origin = __ENV.AILSS_ORIGIN;
if (!origin) throw new Error("AILSS_ORIGIN is required");

export default function () {
  // The catalog endpoint requires an exact category UUID. Search exercises the same
  // public gateway and Cassandra-backed catalog without relying on a seeded ID.
  const response = http.get(`${origin}/api/v1/courses/search?q=data&limit=20`, { redirects: 0 });
  check(response, { "catalog search is successful": (r) => r.status === 200 });
  sleep(0.2);
}
