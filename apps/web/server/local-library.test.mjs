import test from "node:test";
import assert from "node:assert/strict";
import { byteRange } from "./local-library.mjs";
test("video ranges support seeking and suffix requests without reading whole files", () => {
  assert.deepEqual(byteRange("bytes=100-199", 1000), { start: 100, end: 199, partial: true });
  assert.deepEqual(byteRange("bytes=900-", 1000), { start: 900, end: 999, partial: true });
  assert.deepEqual(byteRange("bytes=-100", 1000), { start: 900, end: 999, partial: true });
  assert.deepEqual(byteRange(undefined, 1000), { start: 0, end: 999, partial: false });
  for (const range of ["bytes=1000-", "bytes=90-10", "bytes=0-1,3-4", "bytes=-0", "bytes=-", "garbage"])
    assert.equal(byteRange(range, 1000), null);
});
