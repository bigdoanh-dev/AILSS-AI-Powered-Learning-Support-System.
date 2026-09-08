# AILSS P12.1 media provenance

Created 2026-09-06 for this repository. No external media URLs are used at runtime. No third-party stock photos, customer likeness claims, watermarks, music or unrelated brand art.

| Asset                                 | Creator / source                                                                                 | Rights / use                                                                                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| knowledge-{640,1280}.{avif,webp}      | OpenAI Image Gen, generated in this task, source `exec-35a3168f-c348-4f45-ac32-e8924b5a17fd.png` | Original generated illustration for AILSS hero, AI page, auth and gallery. Use subject to the applicable OpenAI terms; not a claim of exclusive copyright. |
| students-{640,1280}.{avif,webp}       | OpenAI Image Gen, source `exec-a086ddc2-fe62-461d-bfdc-07d5f5fa5926.png`                         | Generated adult students, not real customers. Editorial illustration for audience pages and generic course-card art.                                       |
| ailss-workflow.webm                   | Original task-authored motion, `apps/web/scripts/video.mjs`                                      | Repository MIT license; 18-second silent video of the six-step workflow, Canvas + MediaRecorder VP9.                                                       |
| workflow-poster.svg / workflow.vi.vtt | Original task-authored SVG and captions                                                          | Repository MIT license. Poster, Vietnamese captions and HTML transcript.                                                                                   |
| ../brand/*.svg / *.png                | Original NVD geometry authored in this task                                                      | Repository MIT license. Canonical mark is vector; no tracing of unrelated company logos. Raster exports use Sharp.                                         |

No third-party source URLs apply to these locally generated assets. System fonts are used; no font downloads, analytics or media embeds.

## Generation prompts

- Knowledge: premium 3D glass knowledge sphere with fine cyan network lines, floating translucent document panels and human-review check, navy background, no logos or text, 1536×1024.
- Students: three adult Vietnamese university students collaborating around an unbranded laptop in a sunlit campus library, realistic anatomy, no brands or watermarks, 1536×1024.
- Design concepts: premium navy/blue AILSS hero and coordinated AI workflow/audience/architecture continuation. Concepts are evidence only, not shipped UI. Invented footer contact details, AI recommendations and fictional statistics in the generated concept were explicitly rejected.

Source image generation used the built-in Image Gen tool. Optimized exports retain source aspect ratio and ship both 640 and 1280 widths. See scripts/assets.mjs for exact encoding parameters.

## Web redesign assets (2026-09-08)

The coding, database, ai and study images in 640/1280 AVIF/WebP were generated with OpenAI Image Gen for AILSS. They are illustrative images, not photographs of actual courses or customers. Source images: exec-cdfe7608-2868-4ad3-9f2b-148f27bcf62b.png (coding), exec-d865211d-5bbd-4f11-add4-a8e706050fa2.png (database), exec-6941d40b-0fd6-4cfa-9c5f-1cf9532c3a92.png (AI), exec-df42ca36-d81e-424b-a0d2-7dd2d2013be2.png (study). Use is subject to applicable OpenAI terms.

Original Vietnamese demonstration curricula are in scripts/dev/demo/courses.json. PDF/text handouts are generated from that source; the video builder presents the same explanations as silent teaching slides. These are sample teaching materials, not accreditation claims.

Các bìa `cover-*.svg` được vẽ riêng bằng vector cho từng chủ đề trong AILSS; mã tạo tại `scripts/dev/demo/build-covers.mjs`. Video Python tham khảo được nhúng từ freeCodeCamp, không tải lại hoặc phân phối lại video. Các khóa IELTS cục bộ giữ nguyên quyền của tác giả và không thuộc giấy phép mã nguồn.
