import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { lecturerError, lecturerRequest, useLecturer } from "./api";
import { State } from "./ui";
type Comment = { commentId: string; authorId: string; body: string | null; version: number; state: string };
export default function Comments() {
  const { resourceType = "", resourceId = "" } = useParams(),
    q = useLecturer<Comment[]>(`/resources/${resourceType}/${resourceId}/comments?limit=50`),
    [message, setMessage] = useState("");
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await lecturerRequest(`/resources/${resourceType}/${resourceId}/comments`, "POST", {
        body: String(new FormData(form).get("body")),
      });
      form.reset();
      q.retry();
    } catch (error) {
      setMessage(lecturerError(error));
    }
  }
  return (
    <>
      <p className="eyebrow">THẢO LUẬN</p>
      <h1>Bình luận {resourceType.toLowerCase()}.</h1>
      <State q={q}>
        {(items) => (
          <div className="workspace-cards">
            {items.map((item) => (
              <article key={item.commentId}>
                <span className="badge">{item.state}</span>
                <p>{item.body || "Bình luận đã được xóa"}</p>
                <small>Tác giả {item.authorId}</small>
              </article>
            ))}
          </div>
        )}
      </State>
      <form className="form-panel" onSubmit={(e) => void create(e)}>
        <label>
          Nội dung
          <textarea name="body" rows={4} required />
        </label>
        <button className="button">Gửi bình luận</button>
      </form>
      <p role="status">{message}</p>
    </>
  );
}
