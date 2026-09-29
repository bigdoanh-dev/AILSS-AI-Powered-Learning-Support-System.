export const categories = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Lập trình", image: "coding", keyword: "web" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Cơ sở dữ liệu", image: "database", keyword: "lieu" },
  { id: "10000000-0000-4000-8000-000000000003", name: "Trí tuệ nhân tạo", image: "ai", keyword: "tue" },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Tiếng Anh & kỹ năng học",
    image: "study",
    keyword: "hoc",
  },
] as const;
export function courseSubject(title: string, categoryId?: string) {
  return (
    categories.find((c) => c.id === categoryId) ||
    (/dữ liệu|database|sql|cassandra/i.test(title)
      ? categories[1]
      : /trí tuệ|\bai\b|máy học/i.test(title)
        ? categories[2]
        : /web|react|python|javascript|lập trình/i.test(title)
          ? categories[0]
          : categories[3])
  );
}
export function CourseArtwork({
  title,
  categoryId,
  imageUrl,
  courseId,
  eager = false,
}: {
  title: string;
  categoryId?: string;
  imageUrl?: string;
  courseId?: string;
  eager?: boolean;
}) {
  const customCover =
    imageUrl ||
    (courseId && typeof window !== "undefined"
      ? localStorage.getItem(`ailss_course_cover_${courseId}`)
      : null);

  if (customCover) {
    return (
      <img
        className="course-artwork"
        src={customCover}
        alt={`Ảnh bìa khóa học ${title}`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        style={{ width: "100%", height: "180px", objectFit: "cover", borderRadius: "10px 10px 0 0" }}
      />
    );
  }

  const subject = courseSubject(title, categoryId);
  const cover = /listening/i.test(title)
    ? "listening"
    : /reading/i.test(title)
      ? "reading"
      : /speaking/i.test(title)
        ? "speaking"
        : /writing/i.test(title)
          ? "writing"
          : /ngữ pháp/i.test(title)
            ? "grammar"
            : /phát âm/i.test(title)
              ? "pronunciation"
              : /từ vựng/i.test(title)
                ? "vocabulary"
                : /python/i.test(title)
                  ? "python"
                  : /javascript/i.test(title)
                    ? "javascript"
                    : null;
  return (
    <img
      className="course-artwork"
      src={cover ? `/assets/media/cover-${cover}.svg` : `/assets/media/${subject.image}-1280.webp`}
      srcSet={
        cover
          ? undefined
          : `/assets/media/${subject.image}-640.webp 640w, /assets/media/${subject.image}-1280.webp 1280w`
      }
      sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw"
      width="1280"
      height="853"
      alt={`Minh họa chủ đề ${subject.name.toLowerCase()}`}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
