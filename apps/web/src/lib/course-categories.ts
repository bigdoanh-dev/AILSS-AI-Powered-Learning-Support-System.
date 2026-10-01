import { useEffect, useState } from "react";
import { request } from "./api";
import { categories as defaults } from "../components/CourseArtwork";
export type CourseCategory = { id: string; name: string };
export function useCourseCategories() {
  const [items, setItems] = useState<CourseCategory[]>([...defaults]);
  useEffect(() => {
    const abort = new AbortController();
    void request<{ data: CourseCategory[] }>("/course-categories", { signal: abort.signal })
      .then((result) => {
        if (
          !abort.signal.aborted &&
          Array.isArray(result.data) &&
          result.data.every((item) => item && typeof item.id === "string" && typeof item.name === "string")
        )
          setItems(result.data);
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return items;
}
