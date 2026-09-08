import assert from "node:assert/strict";
import test from "node:test";
import { studentOperation } from "./student.mjs";
const id = "00000000-0000-4000-8000-000000000001";
test("Student commerce allowlist maps offering, order and payment simulation exactly", () => {
  assert.equal(
    studentOperation(`/web-session/student/courses/${id}/offerings`, "GET", undefined, {}).path,
    `/courses/${id}/offerings`,
  );
  assert.equal(
    studentOperation(
      "/web-session/student/orders",
      "POST",
      { offeringId: id },
      { "idempotency-key": "create-order" },
    ).path,
    "/orders",
  );
  assert.equal(
    studentOperation(`/web-session/student/orders/${id}`, "GET", undefined, {}).path,
    `/orders/${id}`,
  );
  assert.equal(
    studentOperation(
      `/web-session/student/orders/${id}/simulate-payment`,
      "POST",
      { outcome: "SUCCESS" },
      { "idempotency-key": "pay-order" },
    ).path,
    `/orders/${id}/simulate-payment`,
  );
});
test("Student commerce rejects real payment fields and unsupported outcomes", () => {
  assert.throws(() =>
    studentOperation(
      "/web-session/student/orders",
      "POST",
      { offeringId: id, card: "4111" },
      { "idempotency-key": "k" },
    ),
  );
  assert.throws(() =>
    studentOperation(
      `/web-session/student/orders/${id}/simulate-payment`,
      "POST",
      { outcome: "CAPTURE" },
      { "idempotency-key": "k" },
    ),
  );
});
