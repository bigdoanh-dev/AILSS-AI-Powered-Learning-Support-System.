import { generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HttpAssistantDomainClient, extractCatalogSearchTokens } from "../../apps/ai-service/src/assistant/domain-client.js";

const CASSANDRA_ID = "00000000-0000-4000-8000-000000000101";
const SQL_ID = "00000000-0000-4000-8000-000000000102";

describe("Advisor published catalog retrieval", () => {
  let client: HttpAssistantDomainClient;

  beforeAll(async () => {
    const { privateKey } = await generateKeyPair("Ed25519");
    client = new HttpAssistantDomainClient({
      learningUrl: "http://learning",
      assessmentUrl: "http://assessment",
      classroomUrl: "http://classroom",
      key: privateKey,
      kid: "test",
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("extracts subject words instead of Vietnamese question words and skips an unspecified goal", async () => {
    expect(extractCatalogSearchTokens("Tôi muốn tìm khóa học về Cassandra và SQL"))
      .toEqual(["cassandra", "sql"]);
    expect(extractCatalogSearchTokens("Tôi không biết chọn khóa học nào")).toEqual([]);
    expect(extractCatalogSearchTokens("Xin chào, bạn khỏe không?")).toEqual([]);
    expect(extractCatalogSearchTokens("Tìm khóa học phù hợp với người mới bắt đầu")).toEqual([]);
    expect(extractCatalogSearchTokens("Tôi chỉ rảnh buổi tối")).toEqual([]);
    expect(extractCatalogSearchTokens("Ngân sách dưới 500 nghìn")).toEqual([]);
    expect(extractCatalogSearchTokens("Tôi có nền tảng cơ bản")).toEqual([]);
    expect(extractCatalogSearchTokens("Tôi mới bắt đầu học Python")).toEqual(["python"]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(client.searchCourses("Tôi không biết chọn khóa học nào")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queries bounded published title prefixes, deduplicates results and does not invent level", async () => {
    const fetchMock = vi.fn((input: string) => {
      const token = new URL(input).searchParams.get("q");
      const data = token === "cassandra"
        ? [{ courseId: CASSANDRA_ID, title: "Cassandra nâng cao", price: "890000", currency: "VND" }]
        : [
            { courseId: CASSANDRA_ID, title: "Cassandra nâng cao", price: "890000", currency: "VND" },
            { courseId: SQL_ID, title: "SQL chuyên sâu", price: "1200000", currency: "VND" },
          ];
      return Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const courses = await client.searchCourses("Tôi muốn học Cassandra và SQL", "BEGINNER", 900000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([input]) => new URL(input).searchParams.get("q")))
      .toEqual(["cassandra", "sql"]);
    expect(courses).toEqual([{
      courseId: CASSANDRA_ID,
      title: "Cassandra nâng cao",
      description: "",
      priceAmount: 890000,
      priceCurrency: "VND",
      level: "UNSPECIFIED",
    }]);
  });

  it("distinguishes an empty published result from catalog outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 })));
    await expect(client.searchCourses("Cassandra")).resolves.toEqual([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(client.searchCourses("Cassandra")).rejects.toThrow("CATALOG_UNAVAILABLE");
  });

  it("maps public course detail without claiming fields the endpoint does not return", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { courseId: CASSANDRA_ID, title: "Cassandra nâng cao", price: "890000", currency: "VND" },
    }), { status: 200 })));
    await expect(client.getCourseDetails(CASSANDRA_ID)).resolves.toEqual({
      courseId: CASSANDRA_ID,
      title: "Cassandra nâng cao",
      description: "",
      priceAmount: 890000,
      priceCurrency: "VND",
      level: "UNSPECIFIED",
    });
  });

  it("returns null for a missing published detail but reports backend failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    await expect(client.getCourseDetails(CASSANDRA_ID)).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    await expect(client.getCourseDetails(CASSANDRA_ID)).rejects.toThrow("CATALOG_UNAVAILABLE");
  });
});
