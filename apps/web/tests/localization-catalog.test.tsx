import { describe, expect, it } from "vitest";
import { ENGLISH_MESSAGES } from "../../../packages/localization/src/catalog";
import { formatInterface, translateInterface, interfaceMessage } from "../../../packages/localization/src";
import { metadata, pages } from "../src/metadata";
import { questions } from "../src/components/Faq";
import { steps } from "../src/components/Workflow";
import { tutorPrompts } from "../src/student/aiTutorConversation";
import { stateLabel } from "../src/components/product";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
describe("Shared interface catalog (Web and mobile)", () => {
  it("covers every explicitly localized literal across Web and mobile", () => {
    const missing: string[] = [];
    const root = path.resolve(process.cwd(), "src");
    function scan(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          scan(file);
          continue;
        }
        if (!file.endsWith(".tsx")) continue;
        const source = ts.createSourceFile(
          file,
          readFileSync(file, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        function visit(node: ts.Node) {
          if (
            ts.isCallExpression(node) &&
            ts.isIdentifier(node.expression) &&
            /^(uiText|interfaceMessage|setError|setMsg|setMessage|setStatus|setNotice|setSuccess)$/.test(
              node.expression.text,
            )
          ) {
            const message = node.arguments[0];
            if (
              message &&
              ts.isStringLiteral(message) &&
              /[ÀÁÂÃĂĐÈÉÊÌÍÒÓÔÕƠÙÚƯÝàáâãăđèéêìíòóôõơùúưý\u1ea0-\u1ef9]/u.test(message.text) &&
              translateInterface(message.text, "en") === message.text
            )
              missing.push(`${path.relative(root, file)}: ${message.text}`);
          }
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
    scan(root);
    scan(path.resolve(process.cwd(), "../mobile/app"));
    scan(path.resolve(process.cwd(), "../mobile/src"));
    expect(missing).toEqual([]);
  });
  it("covers authored public security, experience, and architecture metadata", () => {
    const missing: string[] = [];
    for (const file of ["pages/Trust.tsx", "pages/Platform.tsx", "components/Architecture.tsx"]) {
      const source = ts.createSourceFile(
        file,
        readFileSync(path.resolve(process.cwd(), "src", file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node: ts.Node) {
        if (ts.isStringLiteral(node) && /[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u.test(node.text)) {
          let parent: ts.Node | undefined = node;
          let owner = "";
          while (parent) {
            if (ts.isVariableDeclaration(parent)) owner = parent.name.getText(source);
            parent = parent.parent;
          }
          if (
            (file !== "pages/Platform.tsx" ||
              [
                "BLOOM_TIERS",
                "FORMAT_SPECS",
                "featureItems",
                "studentJourney",
                "lecturerJourney",
                "experiences",
              ].includes(owner)) &&
            translateInterface(node.text, "en") === node.text
          )
            missing.push(`${file}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });
  it("covers shared state chips and preserves user course names in translated suggestions", () => {
    for (const state of [
      "DRAFT",
      "IN_REVIEW",
      "PUBLISHED",
      "ARCHIVED",
      "HIDDEN",
      "DELETED",
      "CLOSED",
      "READY",
      "INCOMPLETE",
      "ACTIVE",
      "PENDING",
      "SCHEDULED",
      "COMPLETED",
      "CANCELLED",
      "NOT_RECORDED",
      "PRESENT",
      "ABSENT",
      "EXCUSED",
      "SELF_PACED",
      "LIVE_COHORT",
      "PRIVATE",
      "INSTITUTIONAL",
    ])
      expect(translateInterface(stateLabel(state), "en"), state).not.toMatch(/[À-ỹĐđ]/u);
    expect(tutorPrompts("selected", "Khóa học", "en")[2]).toBe("Suggest courses related to Khóa học");
    expect(tutorPrompts("", undefined, "en").join(" ")).not.toMatch(/[À-ỹĐđ]/u);
  });
  it("preserves interpolation placeholders and user-supplied values", () => {
    for (const [source, translated] of Object.entries(ENGLISH_MESSAGES)) {
      expect(translated.trim().length).toBeGreaterThan(0);
      expect([...translated.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(), source).toEqual(
        [...source.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(),
      );
    }
    expect(formatInterface("Mức sử dụng API AI · {0}.", "en", ["Khóa học"])).toBe("AI API usage · Khóa học.");
    expect(formatInterface("Gửi mã sau {0}s", "en", [30])).toBe("Send code in 30s");
    expect(translateInterface("constructor", "en")).toBe("constructor");
    expect(translateInterface("Một bước bắt đầu.\nNhiều điều để khám phá.", "en")).not.toMatch(/[À-ỹĐđ]/u);
  });
  it("reformats stored operation feedback when the language changes without translating user names", () => {
    const feedback = interfaceMessage("Đã xóa {0} khỏi lớp.", ["Khóa học"]);
    expect(formatInterface(feedback, "en")).toBe("Removed Khóa học from the class.");
    expect(formatInterface(feedback, "vi")).toBe("Đã xóa Khóa học khỏi lớp.");
    const nested = interfaceMessage("{0} Câu hỏi đã được giữ lại để bạn thử lại.", [
      interfaceMessage("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."),
    ]);
    expect(formatInterface(nested, "en")).toBe(
      "Your session has expired. Please log in again. Your question has been preserved so you can retry.",
    );
    expect(formatInterface(nested, "vi")).toContain("Phiên đăng nhập đã hết hạn.");
  });
  it("covers public and role-based page metadata", () => {
    const paths = [
      ...Object.keys(pages),
      "/app",
      "/app/account",
      "/app/admin",
      "/app/admin/revenue",
      "/app/admin/logs",
      "/app/admin/stats",
      "/app/admin/settings",
      "/app/teaching",
      "/app/learn",
      "/app/schedule",
      "/app/attendance",
      "/app/teaching/schedule",
      "/app/teaching/attendance",
      "/courses/example",
      "/missing",
    ];
    for (const path of paths)
      for (const copy of metadata(path)) {
        if (/[À-ỹĐđ]/u.test(copy)) expect(translateInterface(copy, "en"), path).not.toBe(copy);
      }
  });
  it("covers shared FAQ and workflow copy", () => {
    for (const copy of [...questions.flat(), ...steps.flat()])
      if (/[À-ỹĐđ]/u.test(copy)) expect(translateInterface(copy, "en")).not.toBe(copy);
  });
});
