import iconv from "iconv-lite";
import { Encoding } from "./encoding.js";

// Mud servers generally send latin1 or utf-8.
// We'll try to decode it as utf-8 and fallback to latin1 if it fails.
export function decodeText(
  data: Uint8Array,
  knownCharset?: "auto" | Encoding,
): {
  text: string;
  charset: Encoding;
} {
  // Callsite knows charset, so use it
  if (knownCharset && knownCharset !== "auto") {
    // TextDecoder can handle utf8 (and latin1, a subset of utf8)
    if (knownCharset === "utf8" || knownCharset === "latin1") {
      return {
        text: new TextDecoder(knownCharset).decode(data),
        charset: knownCharset,
      };
    }
    // Otherwise, use iconv-lite
    return {
      text: iconv.decode(Buffer.from(data), knownCharset),
      charset: knownCharset,
    };
  }

  // Attempt utf-8 first
  try {
    const decoder = new TextDecoder("utf-8", {
      // important, so that we fail on latin1 that's not utf-8
      fatal: true,
    });
    return { text: decoder.decode(data), charset: "utf8" };
  } catch {
    // UTF-8 failed, use Latin-1 (which never fails) and remember this for future decoding
    return { text: new TextDecoder("latin1").decode(data), charset: "latin1" };
  }
}
