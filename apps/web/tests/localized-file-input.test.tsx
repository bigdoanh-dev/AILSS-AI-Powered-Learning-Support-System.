import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LanguageProvider, useLanguage } from "../src/lib/i18n";
import { LocalizedFileInput } from "../src/components/LocalizedFileInput";

function Form({ onChange = vi.fn() }) {
  const { setLanguage } = useLanguage();
  return (
    <form aria-label="Upload">
      <LocalizedFileInput aria-label="Video" name="video" accept="video/mp4" required onChange={onChange} />
      <button type="button" onClick={() => setLanguage("en")}>
        EN
      </button>
      <button type="button" onClick={() => setLanguage("vi")}>
        VI
      </button>
    </form>
  );
}
afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("localizes the chooser without remounting or translating the selected filename", () => {
  render(
    <LanguageProvider>
      <Form />
    </LanguageProvider>,
  );
  const input = screen.getByLabelText("Video") as HTMLInputElement;
  expect(screen.getByText("Chưa chọn tệp")).toBeTruthy();
  const file = new File(["video"], "Khóa học.mp4", { type: "video/mp4" });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.click(screen.getByText("EN"));
  expect(screen.getByText("Choose file")).toBeTruthy();
  expect(screen.getByText(file.name)).toBeTruthy();
  expect(screen.getByLabelText("Video")).toBe(input);
  expect(input.files?.[0]).toBe(file);
  expect(input.accept).toBe("video/mp4");
  expect(input.required).toBe(true);
  fireEvent.click(screen.getByText("VI"));
  expect(screen.getByText("Chọn tệp")).toBeTruthy();
  expect(input.files?.[0]).toBe(file);
});
it("forwards the original change event and keeps disabled state", () => {
  const change = vi.fn();
  render(
    <LanguageProvider>
      <LocalizedFileInput aria-label="Document" disabled onChange={change} />
    </LanguageProvider>,
  );
  const input = screen.getByLabelText("Document") as HTMLInputElement;
  expect(input.disabled).toBe(true);
  fireEvent.change(input, { target: { files: [] } });
  expect(change).toHaveBeenCalledTimes(1);
});
it("clears the displayed filename when the form is reset", () => {
  render(
    <LanguageProvider>
      <Form />
    </LanguageProvider>,
  );
  const input = screen.getByLabelText("Video");
  fireEvent.change(input, { target: { files: [new File(["video"], "Lesson.mp4")] } });
  expect(screen.getByText("Lesson.mp4")).toBeTruthy();
  fireEvent.reset(screen.getByRole("form", { name: "Upload" }));
  expect(screen.queryByText("Lesson.mp4")).toBeNull();
  expect(screen.getByText("Chưa chọn tệp")).toBeTruthy();
});
