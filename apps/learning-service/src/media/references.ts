import { AppError } from "../../../../packages/http/src/index.js";
import type { LearningLessonRepository } from "../lessons/repository.js";
import type { MediaStore } from "./repository.js";

// Read/publication guards do not depend on MEDIA_ENABLED or object-store
// credentials. Turning off upload/delivery must not resurrect legacy read URLs.
export class MediaReferences {
  constructor(
    private readonly store: MediaStore,
    private readonly lessons: Pick<LearningLessonRepository, "list">,
    private readonly tenantId: string,
  ) {}
  async lessonMedia(lessonId: string) {
    const id = await this.store.binding(this.tenantId, lessonId);
    if (!id) return undefined;
    const asset = await this.store.get(this.tenantId, id);
    if (!asset)
      throw new AppError("MEDIA_REFERENCE_UNAVAILABLE", 503, "Required media metadata is unavailable", true);
    return { mediaAssetId: asset.mediaAssetId, mediaStatus: asset.status };
  }
  async requireReady(courseId: string, contentVersion: number) {
    for (const lesson of await this.lessons.list(courseId, contentVersion)) {
      const media = await this.lessonMedia(lesson.lessonId);
      if (media && media.mediaStatus !== "READY")
        throw new AppError(
          "COURSE_MEDIA_NOT_READY",
          409,
          "Required lesson video must be READY before publication",
        );
    }
  }
}
