import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decodeMessage } from "../src/encoding.js";

describe("decodeMessage", () => {
  test("decodes valid UTF-8 text with auto charset", () => {
    const text = "Hello, World! 🌍";
    const data = new TextEncoder().encode(text);
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, text);
    assert.equal(result.charset, "utf8");
  });

  test("decodes valid UTF-8 text with explicit utf-8 charset", () => {
    const text = "Hello, World! 🌍";
    const data = new TextEncoder().encode(text);
    const result = decodeMessage(data, "utf8");

    assert.equal(result.text, text);
    assert.equal(result.charset, "utf8");
  });

  test("falls back to latin1 for invalid UTF-8 with auto charset", () => {
    // Create invalid UTF-8 sequence (Latin-1 characters)
    const data = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xff, 0xfe,
    ]); // "Hello " + invalid UTF-8
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, "Hello ÿþ"); // Latin-1 interpretation
    assert.equal(result.charset, "latin1");
  });

  test("uses latin1 when explicitly specified", () => {
    // Create data with high bytes that would be invalid in UTF-8
    const data = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xe9, 0xe8,
    ]); // "Hello éè" in Latin-1
    const result = decodeMessage(data, "latin1");

    assert.equal(result.text, "Hello éè");
    assert.equal(result.charset, "latin1");
  });

  test("handles empty data", () => {
    const data = new Uint8Array(0);
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, "");
    assert.equal(result.charset, "utf8");
  });

  test("handles ASCII text (valid in both encodings)", () => {
    const text = "Hello World 123!@#";
    const data = new TextEncoder().encode(text);
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, text);
    assert.equal(result.charset, "utf8"); // UTF-8 is tried first
  });

  test("handles multi-byte UTF-8 characters", () => {
    const text = "日本語 中文 한글"; // Japanese, Chinese, Korean
    const data = new TextEncoder().encode(text);
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, text);
    assert.equal(result.charset, "utf8");
  });

  test("handles UTF-8 with BOM", () => {
    // UTF-8 BOM (EF BB BF) followed by "Hello"
    const data = new Uint8Array([
      0xef, 0xbb, 0xbf, 0x48, 0x65, 0x6c, 0x6c, 0x6f,
    ]);
    const result = decodeMessage(data, "auto");

    // TextDecoder should handle BOM transparently
    assert.equal(result.text, "Hello");
    assert.equal(result.charset, "utf8");
  });

  test("respects explicit charset even for valid UTF-8", () => {
    const text = "Hello"; // Valid in both encodings
    const data = new TextEncoder().encode(text);
    const result = decodeMessage(data, "latin1");

    assert.equal(result.text, text);
    assert.equal(result.charset, "latin1");
  });

  test("handles common Latin-1 accented characters", () => {
    // Common accented characters in Latin-1
    const data = new Uint8Array([
      0xc0,
      0xc9,
      0xd1,
      0xd6,
      0xdc, // ÀÉÑÖÜ
      0xe0,
      0xe9,
      0xf1,
      0xf6,
      0xfc, // àéñöü
    ]);
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, "ÀÉÑÖÜàéñöü");
    assert.equal(result.charset, "latin1");
  });

  test("handles control characters", () => {
    // Text with newlines and tabs
    const text = "Line 1\nLine 2\tTabbed";
    const data = new TextEncoder().encode(text);
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, text);
    assert.equal(result.charset, "utf8");
  });

  test("handles null bytes", () => {
    // Text with null bytes
    const data = new Uint8Array([0x48, 0x69, 0x00, 0x21]); // "Hi\0!"
    const result = decodeMessage(data, "auto");

    assert.equal(result.text, "Hi\0!");
    assert.equal(result.charset, "utf8");
  });
});
