import iconv from "iconv-lite";
import ws from "ws";

// Functions in this file expect encoding to be lowercase

export function isEncodingSupported(encoding: string): boolean {
  return iconv.encodingExists(encoding);
}

/** Turn ws.RawData into a Uint8Array using an encoding */
export function encodeWsRawData(
  data: ws.RawData,
  isBinary: boolean,
  encoding: string,
): Uint8Array {
  if (!isBinary) {
    // If encoding is still auto at this point, use latin1
    return encodeMessage(
      data.toString(),
      encoding === "auto" ? "latin1" : encoding,
    );
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  } else if (Array.isArray(data)) {
    // Buffer[]
    return Buffer.concat(data);
  } else {
    // Must be Buffer, which is already a Uint8Array
    return data;
  }
}

/** Encode a string into a Uint8Array using an encoding */
export function encodeMessage(message: string, encoding: string): Uint8Array {
  switch (encoding) {
    case "utf8":
    case "utf-8":
      // Use native TextEncoder for UTF-8
      return new TextEncoder().encode(message);

    case "ascii":
    case "latin1":
    case "iso88591":
    case "iso-8859-1":
      // Use Node's Buffer for latin1
      return Uint8Array.from(Buffer.from(message, "latin1"));

    default:
      // Use iconv-lite for everything else
      return Uint8Array.from(iconv.encode(message, encoding));
  }
}

// Try UTF-8 first, then latin1
function decodeMessageAuto(data: Uint8Array): {
  text: string;
  charset: "utf8" | "latin1";
} {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    return { text, charset: "utf8" };
  } catch {
    return {
      text: new TextDecoder("latin1").decode(data),
      charset: "latin1",
    };
  }
}

const nativeEncodings = new Set([
  "utf8",
  "utf-8",
  "latin1",
  "iso-8859-1",
  "iso88591",
]);

function normalizeForTextDecoder(encoding: string): string {
  switch (encoding) {
    case "utf-8":
      return "utf8";
    case "latin1":
    case "iso88591":
    case "iso-8859-1":
      return "latin1";
    default:
      return encoding;
  }
}

/** Decode a Uint8Array into a string using an encoding */
export function decodeMessage(
  data: Uint8Array,
  encoding: "auto" | string,
): { text: string; charset: string } {
  // Auto-detect utf8 vs latin1
  if (encoding === "auto") {
    return decodeMessageAuto(data);
  }

  // See if Node can handle it
  if (nativeEncodings.has(encoding)) {
    const normalizedEncoding = normalizeForTextDecoder(encoding);
    return {
      text: new TextDecoder(normalizedEncoding).decode(data),
      charset: normalizedEncoding,
    };
  }

  // Fall back to iconv-lite
  return {
    text: iconv.decode(Buffer.from(data), encoding),
    charset: encoding,
  };
}
