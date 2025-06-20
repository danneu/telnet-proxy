import { test } from "node:test";
import { deepStrictEqual } from "node:assert";
import iconv from "iconv-lite";
import { decodeMessage } from "../src/encoding.js";

test("decodeMessage handles GBK encoding", () => {
  // Chinese text: "你好世界" (Hello World)
  const chineseText = "你好世界";
  const gbkBuffer = iconv.encode(chineseText, "gbk");

  const result = decodeMessage(gbkBuffer, "gbk");

  deepStrictEqual(result.text, chineseText);
  deepStrictEqual(result.charset, "gbk");
});

test("decodeMessage handles Big5 encoding", () => {
  // Traditional Chinese text: "你好世界" (Hello World)
  const chineseText = "你好世界";
  const big5Buffer = iconv.encode(chineseText, "big5");

  const result = decodeMessage(big5Buffer, "big5");

  deepStrictEqual(result.text, chineseText);
  deepStrictEqual(result.charset, "big5");
});

test("decodeMessage does not auto-detect GBK", () => {
  // Chinese text that would be garbled if auto-detected as UTF-8 or Latin-1
  const chineseText = "测试";
  const gbkBuffer = iconv.encode(chineseText, "gbk");

  // With auto mode, it should not correctly decode GBK
  const autoResult = decodeMessage(gbkBuffer, "auto");

  // The text should be garbled (not equal to original)
  deepStrictEqual(autoResult.text !== chineseText, true);
  // Should detect as latin1 (fallback)
  deepStrictEqual(autoResult.charset, "latin1");

  // But with explicit GBK, it should work
  const gbkResult = decodeMessage(gbkBuffer, "gbk");
  deepStrictEqual(gbkResult.text, chineseText);
  deepStrictEqual(gbkResult.charset, "gbk");
});

test("decodeMessage does not auto-detect Big5", () => {
  // Traditional Chinese text
  const chineseText = "測試";
  const big5Buffer = iconv.encode(chineseText, "big5");

  // With auto mode, it should not correctly decode Big5
  const autoResult = decodeMessage(big5Buffer, "auto");

  // The text should be garbled
  deepStrictEqual(autoResult.text !== chineseText, true);
  // Should detect as latin1 (fallback)
  deepStrictEqual(autoResult.charset, "latin1");

  // But with explicit Big5, it should work
  const big5Result = decodeMessage(big5Buffer, "big5");
  deepStrictEqual(big5Result.text, chineseText);
  deepStrictEqual(big5Result.charset, "big5");
});
