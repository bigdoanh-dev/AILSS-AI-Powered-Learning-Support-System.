import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import {
  requiresStepUp,
  resolveStepUpTarget,
  type ProtectedIdentityRoute,
} from "../../apps/api-gateway/src/protected-identity-proxy.js";

describe("Gateway Centralized Step-Up Policy", () => {
  it("classifies sensitive admin mutations as requiring step-up", () => {
    expect(requiresStepUp("identity.lecturer-application.decision")).toBe(true);
    expect(requiresStepUp("identity.admin.user.status.change")).toBe(true);
    expect(requiresStepUp("identity.admin.lecturer.verify")).toBe(true);
  });

  it("classifies non-sensitive and read-only routes as NOT requiring step-up", () => {
    expect(requiresStepUp("identity.admin.users.search")).toBe(false);
    expect(requiresStepUp("identity.admin.user.detail")).toBe(false);
    expect(requiresStepUp("identity.profile.read")).toBe(false);
    expect(requiresStepUp("identity.profile.update")).toBe(false);
    expect(requiresStepUp("identity.password.change")).toBe(false);
  });

  it("resolves target for identity.admin.user.status.change correctly", () => {
    const userId = randomUUID();
    const route: ProtectedIdentityRoute = {
      method: "PATCH",
      path: "/api/v1/admin/users/:userId/status",
      purpose: "identity.admin.user.status.change",
      onInvalidBearer: () => {},
    };
    const req = {
      params: { userId },
      body: {
        status: "SUSPENDED",
        currentPassword: "admin-secret-password",
        reason: "Policy violation",
      },
      query: {},
    } as unknown as Request;

    const target = resolveStepUpTarget(route, req);
    expect(target).not.toBeNull();
    expect(target).toMatchObject({
      action: "ADMIN_USER_STATUS_CHANGE",
      resourceType: "USER",
      resourceId: userId,
      currentPassword: "admin-secret-password",
    });
  });

  it("resolves target for identity.admin.lecturer.verify correctly", () => {
    const userId = randomUUID();
    const route: ProtectedIdentityRoute = {
      method: "POST",
      path: "/api/v1/admin/lecturers/:userId/verify",
      purpose: "identity.admin.lecturer.verify",
      onInvalidBearer: () => {},
    };
    const req = {
      params: { userId },
      body: {
        currentPassword: "admin-secret-password",
      },
      query: {},
    } as unknown as Request;

    const target = resolveStepUpTarget(route, req);
    expect(target).not.toBeNull();
    expect(target).toMatchObject({
      action: "ADMIN_LECTURER_VERIFY",
      resourceType: "USER",
      resourceId: userId,
      currentPassword: "admin-secret-password",
    });
  });

  it("resolves target for identity.lecturer-application.decision correctly", () => {
    const applicationId = randomUUID();
    const route: ProtectedIdentityRoute = {
      method: "POST",
      path: "/api/v1/admin/lecturer-applications/:applicationId/decision",
      purpose: "identity.lecturer-application.decision",
      onInvalidBearer: () => {},
    };
    const req = {
      params: { applicationId },
      body: {
        decision: "APPROVE",
        currentPassword: "admin-secret-password",
      },
      query: {},
    } as unknown as Request;

    const target = resolveStepUpTarget(route, req);
    expect(target).not.toBeNull();
    expect(target).toMatchObject({
      action: "LECTURER_APPLICATION_APPROVE",
      resourceType: "LECTURER_APPLICATION",
      resourceId: applicationId,
      currentPassword: "admin-secret-password",
      forwardedBody: { decision: "APPROVE" },
    });
  });

  it("rejects invalid status change payloads", () => {
    const userId = randomUUID();
    const route: ProtectedIdentityRoute = {
      method: "PATCH",
      path: "/api/v1/admin/users/:userId/status",
      purpose: "identity.admin.user.status.change",
      onInvalidBearer: () => {},
    };
    const req = {
      params: { userId },
      body: {
        status: "INVALID_STATUS",
        currentPassword: "pass",
      },
      query: {},
    } as unknown as Request;

    expect(() => resolveStepUpTarget(route, req)).toThrow();
  });
});
