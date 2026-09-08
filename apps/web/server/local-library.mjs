import { readFile, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { relative, isAbsolute } from "node:path";
import { pipeline } from "node:stream/promises";
const manifest = new URL("../../../tmp/local-library.json", import.meta.url);
export function byteRange(value, size) {
  if (!value) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start)
    return null;
  return { start, end, partial: true };
}
export async function localLibrary(req, res) {
  let items = [];
  try {
    items = JSON.parse(await readFile(manifest, "utf8")).items;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const pathname = new URL(req.url, "http://local").pathname;
  if (pathname === "/web-session/library") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        data: items.map(({ id, title, group, contentType, size }) => ({
          id,
          title,
          group,
          contentType,
          size,
        })),
      }),
    );
    return;
  }
  const id = pathname.split("/").pop();
  const item = items.find((x) => x.id === id);
  if (!item) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const path = await realpath(item.path),
    root = await realpath(item.root),
    rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  const size = (await stat(path)).size,
    range = byteRange(req.headers.range, size);
  if (!range) {
    res.statusCode = 416;
    res.setHeader("Content-Range", `bytes */${size}`);
    res.end();
    return;
  }
  res.statusCode = range.partial ? 206 : 200;
  res.setHeader("Content-Type", item.contentType);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", range.end - range.start + 1);
  if (range.partial) res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader(
    "Content-Disposition",
    `${item.contentType.includes("wordprocessingml") ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(item.title + ({ "application/pdf": ".pdf", "video/mp4": ".mp4", "video/webm": ".webm", "audio/mpeg": ".mp3", "audio/mp4": ".m4a" }[item.contentType] || ".docx"))}`,
  );
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  await pipeline(createReadStream(path, { start: range.start, end: range.end }), res);
}

export async function courseMedia() {
  try {
    const primary = JSON.parse(
      await readFile(new URL("../../../tmp/course-media.json", import.meta.url), "utf8"),
    );
    let extra = {};
    try {
      extra = JSON.parse(
        await readFile(new URL("../../../tmp/instructor-media.json", import.meta.url), "utf8"),
      );
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    return { ...primary, ...extra };
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}
export async function enrichCourseLesson(result) {
  const item = (await courseMedia())[result?.data?.lessonId];
  if (!item || item.courseId !== result.data.courseId) return result;
  return {
    ...result,
    data: {
      ...result.data,
      ...(item.externalVideo
        ? { externalVideo: item.externalVideo }
        : { contentUrl: "/web-session/library/" + item.fileId, contentType: item.contentType }),
    },
  };
}
