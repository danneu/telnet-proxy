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
  option: number;
};

// Subnegotiation (data message resulting from negotiation)
export type SubnegotiationChunk = ChunkBase<"subnegotiation"> & {
  option: number;
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
  text: (data: Uint8Array): TextChunk => {
    return { type: "text", data };
  },

  negotiation: (
    verb: TELNET["DO"] | TELNET["DONT"] | TELNET["WILL"] | TELNET["WONT"],
    option: number,
  ): NegotiationChunk => {
    return {
      type: "negotiation",
      verb,
      option,
    };
  },

  subnegotiation: (option: number, data: Uint8Array): SubnegotiationChunk => {
    return {
      type: "subnegotiation",
      option,
      data,
    };
  },

  command: (code: number): CommandChunk => {
    return { type: "command", code };
  },
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
  let buf = new Uint8Array(maxBufferSize);
  let start = 0; // where valid data starts
  let end = 0; // where valid data ends (exclusive)

  const drain = (): Uint8Array => {
    const drained = buf.slice(start, end);
    start = 0;
    end = 0;
    return drained;
  };

  const push = (bytes: Uint8Array | Buffer): void => {
    const currentLen = end - start;
    const newLen = currentLen + bytes.length;

    // Check if we need to compact (move data to start of memoryBlock)
    if (end + bytes.length > buf.length) {
      // Compact: move data to start
      buf.copyWithin(0, start, end);
      start = 0;
      end = currentLen;
    }

    // Check for overflow after compacting
    if (newLen > buf.length) {
      throw new ParserError(
        `Buffer overflow: attempted to push ${bytes.length} bytes, but only ${buf.length - currentLen} bytes available (max: ${buf.length})`,
        "BUFFER_OVERFLOW",
      );
    }

    // Copy new data
    buf.set(bytes, end);
    end += bytes.length;
  };

  const next = (): Chunk | null => {
    const currentLen = end - start;

    // No data buffered, so nothing to do
    if (currentLen === 0) return null;

    // Iterate until we find an IAC or end of buffered data
    let textEnd = start;
    while (textEnd < end && buf[textEnd] !== TELNET.IAC) {
      textEnd++;
    }

    // If we were able to move the pointer, we have text data
    if (textEnd > start) {
      const data = buf.slice(start, textEnd);
      start = textEnd;
      return createChunk.text(data);
    }

    // Not enough data buffered for any command (Need at least 2 bytes)
    if (currentLen < 2) return null;

    // start is pointing at IAC, so let's see what the next byte is
    const cmd = buf[start + 1];

    // Handle negotiation
    // A negotiation is 3 bytes: IAC <verb> <option>
    if (
      cmd === TELNET.DO ||
      cmd === TELNET.DONT ||
      cmd === TELNET.WILL ||
      cmd === TELNET.WONT
    ) {
      // There wasn't a 3rd byte: wait for more data
      if (currentLen < 3) return null;
      const option = buf[start + 2];
      start += 3;
      return createChunk.negotiation(cmd, option);
    }

    // Handle subnegotiation
    // A subnegotiation is: IAC SB <...data> IAC SE
    if (cmd === TELNET.SB) {
      if (currentLen < 3) return null;
      const option = buf[start + 2];
      const data: number[] = [];
      let i = start + 3;

      while (i < end - 1) {
        // IAC SE = end of subnegotiation data
        // IAC IAC = escaped IAC; it's part of the data
        if (buf[i] === TELNET.IAC) {
          if (buf[i + 1] === TELNET.SE) {
            // Complete subnegotiation found
            start = i + 2;
            return createChunk.subnegotiation(option, Uint8Array.from(data));
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
    start += 2;
    return createChunk.command(cmd);
  };

  const bufferedLength = () => end - start;

  return { drain, push, next, bufferedLength };
}
