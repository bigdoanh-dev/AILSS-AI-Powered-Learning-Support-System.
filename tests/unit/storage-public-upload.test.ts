import { describe, expect, it, vi } from "vitest";
const clients = vi.hoisted(
  () => [] as Array<{ options: Record<string, unknown>; presignedPutObject: ReturnType<typeof vi.fn> }>,
);
vi.mock("minio", () => ({
  Client: class {
    presignedPutObject = vi.fn(async () => "signed-upload");
    constructor(options: Record<string, unknown>) {
      clients.push({ options, presignedPutObject: this.presignedPutObject });
    }
  },
}));
import { MinioStorage } from "../../packages/storage/src/index.js";
describe("Public browser uploads", () => {
  it("signs uploads using the configured public origin, retaining internal storage endpoint", async () => {
    const storage = new MinioStorage(
      "private",
      { endPoint: "minio", port: 9000, useSSL: false, accessKey: "test", secretKey: "test" },
      "https://files.example.com",
    );
    await storage.createUploadIntent("documents/test.txt", "text/plain", 100);
    expect(clients[0]?.options.endPoint).toBe("minio");
    expect(clients[0]?.presignedPutObject).not.toHaveBeenCalled();
    expect(clients[1]?.options).toMatchObject({ endPoint: "files.example.com", port: 443, useSSL: true });
    expect(clients[1]?.presignedPutObject).toHaveBeenCalledWith("private", "documents/test.txt", 900);
  });
});
