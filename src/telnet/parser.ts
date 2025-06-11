import { TELNET } from "./code.js";

/*
  Parses text into a sequence of telnet command chunks and data chunks.

  Example:

      net.connect(url)
        .pipe(zlib.createInflate())
        .pipe(createParserStream())
        .on('data', (chunk) => {
          switch (chunk.type) {
            case 'data':
              console.log('data chunk (%d bytes)', chunk.data.length)
              break
            case 'negotiation':
              console.log('server is negotiating with us')
              break
            case 'command':
              console.log('received other telnet command')
              break
          }
        })
*/

type ChunkBase<T extends string> = { type: T };

// Viewable text data
export type TextChunk = ChunkBase<"text"> & { data: Uint8Array };

// Negotiation (IAC DO <option>, IAC DONT <option>, IAC WILL <option>, IAC WONT <option>)
export type NegotiationChunk = ChunkBase<"negotiation"> & {
  verb: TELNET["WILL"] | TELNET["WONT"] | TELNET["DO"] | TELNET["DONT"];
  target: number;
};

// Subnegotiation (data message resulting from negotiation)
export type SubnegotiationChunk = ChunkBase<"subnegotiation"> & {
  target: number;
  data: Uint8Array;
};

// Other commands like IAC AYT, IAC GA, etc.
export type CommandChunk = ChunkBase<"command"> & {
  code: number;
};

export type Chunk =
  | TextChunk
  | NegotiationChunk
  | SubnegotiationChunk
  | CommandChunk;

export const createChunk = {
  text: (data: Uint8Array): TextChunk => ({ type: "text", data }),
  negotiation: (
    verb: TELNET["DO"] | TELNET["DONT"] | TELNET["WILL"] | TELNET["WONT"],
    target: number,
  ): NegotiationChunk => ({
    type: "negotiation",
    verb,
    target,
  }),
  subnegotiation: (target: number, data: Uint8Array): SubnegotiationChunk => ({
    type: "subnegotiation",
    target,
    data,
  }),
  command: (code: number): CommandChunk => ({ type: "command", code }),
};

// bufferOverflow | parseError
export class ParserError extends Error {
  code: "BUFFER_OVERFLOW" | "PARSE_ERROR";
  constructor(message: string, code: "BUFFER_OVERFLOW" | "PARSE_ERROR") {
    super(message);
    this.name = "ParserError";
    this.code = code;
  }
}

export interface Parser {
  drain: () => Uint8Array;
  push: (bytes: Uint8Array | Buffer) => void;
  next: () => Chunk | null;
  bufferedLength: () => number;
}

export type ParserConfig = {
  maxBufferSize?: number;
};

export function createParser({
  maxBufferSize = 1024 * 1024,
}: ParserConfig = {}): Parser {
  // Internal state
  let buf = new Uint8Array(maxBufferSize);
  let bufPos = 0; // where valid data starts
  let bufLen = 0; // how much valid data is in the buffer
  let bufCapacity = buf.length;

  const drain = (): Uint8Array => {
    const drained = buf.slice(bufPos, bufPos + bufLen);
    bufPos = 0;
    bufLen = 0;
    return drained;
  };

  const push = (bytes: Uint8Array | Buffer): void => {
    // Check if we need to compact
    if (bufPos + bufLen + bytes.length > buf.length) {
      // Compact: move data to start
      buf.copyWithin(0, bufPos, bufPos + bufLen);
      bufPos = 0;
    }

    // Check for overflow after compacting
    if (bufLen + bytes.length > bufCapacity) {
      throw new ParserError(
        `Buffer overflow: attempted to push ${bytes.length} bytes, but only ${bufCapacity - bufLen} bytes available (max: ${bufCapacity})`,
        "BUFFER_OVERFLOW",
      );
    }

    // Copy new data
    buf.set(bytes, bufPos + bufLen);
    bufLen += bytes.length;
  };

  const next = (): Chunk | null => {
    if (bufLen === 0) return null;

    const start = bufPos;
    const end = bufPos + bufLen;

    // Fast path for text data
    let textEnd = start;
    while (textEnd < end && buf[textEnd] !== TELNET.IAC) {
      textEnd++;
    }

    if (textEnd > start) {
      const data = buf.slice(start, textEnd);
      bufPos = textEnd;
      bufLen -= textEnd - start;
      return { type: "text", data };
    }

    // Not enough data for any command
    if (bufLen < 2) return null;

    const cmd = buf[start + 1];

    // Handle negotiation commands
    if (
      cmd === TELNET.DO ||
      cmd === TELNET.DONT ||
      cmd === TELNET.WILL ||
      cmd === TELNET.WONT
    ) {
      if (bufLen < 3) return null;

      const target = buf[start + 2];
      bufPos += 3;
      bufLen -= 3;
      return { type: "negotiation", verb: cmd, target };
    }

    // Handle subnegotiation
    if (cmd === TELNET.SB) {
      if (bufLen < 3) return null;

      const option = buf[start + 2];
      const data: number[] = [];
      let i = start + 3;

      while (i < end - 1) {
        if (buf[i] === TELNET.IAC) {
          if (buf[i + 1] === TELNET.SE) {
            // Complete subnegotiation found
            bufPos = i + 2;
            bufLen = end - bufPos;
            return {
              type: "subnegotiation",
              target: option,
              data: Uint8Array.from(data),
            };
          } else if (buf[i + 1] === TELNET.IAC) {
            // Escaped IAC
            data.push(TELNET.IAC);
            i += 2;
            continue;
          }
        }
        data.push(buf[i]);
        i++;
      }

      // Incomplete subnegotiation
      return null;
    }

    // Other commands
    bufPos += 2;
    bufLen -= 2;
    return { type: "command", code: cmd };
  };

  const bufferedLength = () => bufLen;

  return { drain, push, next, bufferedLength };
}
