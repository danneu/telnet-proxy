import iconv from "iconv-lite";

// Mud servers generally send latin1 or utf-8.
// We'll try to decode it as utf-8 and fallback to latin1 if it fails.
export function decodeText(
  data: Uint8Array,
  knownCharset?: "auto" | "latin1" | "utf8" | "gbk" | "big5"
): {
  text: string;
  charset: "latin1" | "utf8" | "gbk" | "big5";
} {
  // Callsite knows charset, so use it
  if (knownCharset && knownCharset !== "auto") {
    if (knownCharset === "gbk" || knownCharset === "big5") {
      return {
        text: iconv.decode(Buffer.from(data), knownCharset),
        charset: knownCharset,
      };
    }
    return {
      text: new TextDecoder(knownCharset).decode(data),
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
