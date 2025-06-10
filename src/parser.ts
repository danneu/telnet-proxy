// parser.ts
import { Transform } from "stream";

/*
  Parses text into a sequence of telnet command chunks and data chunks.

  Example:

      net.connect(url)
        .pipe(zlib.createInflate())
        .pipe(Parser.createStream())
        .on('data', (chunk) => {
          switch (chunk.type) {
            case 'DATA':
              console.log('data chunk (%d bytes)', chunk.data.length)
              break
            case 'NEGOTIATION':
              console.log('server is negotiating with us')
              break
            case 'CMD':
              console.log('received other telnet command')
              break
          }
        })
*/

export type TelnetCodeName = keyof typeof TELNET;
export type TelnetCode = (typeof TELNET)[TelnetCodeName];

export const TELNET = {
  IAC: 255,
  // Negotiation
  WILL: 251,
  WONT: 252,
  DO: 253,
  DONT: 254,
  // Subnegotiation
  SE: 240,
  SB: 250,
  // General options
  ECHO: 1,
  SUPPRESS_GO_AHEAD: 3,
  STATUS: 5,
  TIMING_MARK: 6,
  EXTENDED_ASCII: 17,
  TERMINAL_SPEED: 24,
  TELOPT_EOR: 25,
  WINDOW_SIZE: 31, // https://www.rfc-editor.org/rfc/rfc1073.html Negotiate about window size (NAWS)

  REMOTE_FLOW_CONTROL: 33,
  LINEMODE: 34,
  ENVIRON: 36,
  NEW_ENVIRON: 39, // https://www.rfc-editor.org/rfc/rfc1572.html

  CHARSET: 42,
  NOP: 241,
  ARE_YOU_THERE: 246,
  GO_AHEAD: 249,
  // MUD options https://mudcoders.fandom.com/wiki/List_of_Telnet_Options
  MSDP: 69,
  MSSP: 70,
  MCCP1: 85,
  MCCP2: 86,
  MCCP3: 87,
  MSP: 90, // https://www.zuggsoft.com/zmud/msp.htm
  MXP: 91,
  ZMP: 93,
  ATCP: 200,
  GMCP: 201,
  EOR: 239, // https://tintin.mudhalla.net/protocols/eor/
} as const;

// eslint-disable-next-line no-redeclare
export type TELNET = typeof TELNET;

export function isTelnetCode(code: number): code is TelnetCode {
  return code in codeToName;
}

// Look up friendly code name from a code number
const codeToName: TelnetNameLookup = (() => {
  const inverted = Object.create(null) as TelnetNameLookup;
  for (const [k, v] of Object.entries(TELNET)) {
    inverted[v as TelnetCode] = k as Extract<TelnetCodeName, string>;
  }
  return inverted;
})();

type TelnetNameLookup = {
  [K in TelnetCode]: Extract<TelnetCodeName, string>;
};

export function getTelnetCodeName(code: TelnetCode): TelnetCodeName {
  return codeToName[code];
}

export type Chunk =
  // Viewable text data
  | { type: "text"; data: Uint8Array }
  // Negotiation (IAC DO <option>, IAC DONT <option>, IAC WILL <option>, IAC WONT <option>)
  | {
      type: "negotiation";
      verb: TELNET["WILL"] | TELNET["WONT"] | TELNET["DO"] | TELNET["DONT"];
      target: number;
    }
  // Subnegotiation (data message resulting from negotiation)
  | { type: "subnegotiation"; target: number; data: Uint8Array }
  // Other commands like IAC AYT, IAC GA, etc.
  | { type: "command"; code: number };

// match(this.buf, [Cmd.IAC, Cmd.DO, 'number'])
// 'number' matches a single number slot
function match(buf: number[], pattern: (number | "number")[]): boolean {
  if (buf.length < pattern.length) {
    return false;
  }
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "number" && typeof buf[i] !== "number") {
      return false;
    } else if (pattern[i] !== "number" && pattern[i] !== buf[i]) {
      return false;
    }
  }
  return true;
}

export type ParserStream = Transform & {
  drain: () => Uint8Array;
};

export class Parser {
  buf: number[] = [];
  maxBufferSize: number;

  constructor(maxBufferSize: number = 1024 * 1024) {
    this.maxBufferSize = maxBufferSize;
  }

  // Return and reset the internal buffer
  drain(): Uint8Array {
    const drained = Uint8Array.from(this.buf);
    this.buf = [];
    return drained;
  }

  static createStream(maxBufferSize?: number): ParserStream {
    const parser = new Parser(maxBufferSize);
    const stream = new Transform({
      objectMode: true,
      // TODO: Custom flush?
      // flush() {},
      transform(data, _, done) {
        parser.push(data);
        let chunk;
        while ((chunk = parser.next())) {
          this.push(chunk);
        }
        done();
      },
    }) as ParserStream;

    stream.drain = () => parser.drain();

    return stream;
  }

  push(bytes: Uint8Array | Buffer) {
    if (this.buf.length + bytes.length > this.maxBufferSize) {
      console.warn(
        `Parser buffer overflow (${
          this.buf.length + bytes.length
        } bytes), resetting buffer`,
      );
      this.buf = [];
    }

    bytes.forEach((b) => {
      this.buf.push(b);
    });
  }

  // decodes next chunk from buf, if possible
  // mutates this.buf
  //
  // it's important that when next() encounters an incomplete sequence
  // it leaves the internal buffer unmodified.
  next(): Chunk | null {
    let i = 0;
    let data = [];

    // Detect data chunk (consume data bytes from start until IAC)
    while (i < this.buf.length) {
      if (this.buf[i] === TELNET.IAC) {
        break;
      }
      data.push(this.buf[i]);
      i++;
    }

    if (data.length > 0) {
      this.buf.splice(0, data.length);
      return { type: "text", data: Uint8Array.from(data) };
    }

    // Decode IAC chunk
    data = [];
    if (match(this.buf, [TELNET.IAC, TELNET.DO, "number"])) {
      const chunk: Chunk = {
        type: "negotiation",
        verb: TELNET.DO,
        target: this.buf[2],
      };
      this.buf.splice(0, 3);
      return chunk;
    } else if (match(this.buf, [TELNET.IAC, TELNET.DONT, "number"])) {
      const chunk: Chunk = {
        type: "negotiation",
        verb: TELNET.DONT,
        target: this.buf[2],
      };
      this.buf.splice(0, 3);
      return chunk;
    } else if (match(this.buf, [TELNET.IAC, TELNET.WILL, "number"])) {
      const chunk: Chunk = {
        type: "negotiation",
        verb: TELNET.WILL,
        target: this.buf[2],
      };
      this.buf.splice(0, 3);
      return chunk;
    } else if (match(this.buf, [TELNET.IAC, TELNET.WONT, "number"])) {
      const chunk: Chunk = {
        type: "negotiation",
        verb: TELNET.WONT,
        target: this.buf[2],
      };
      this.buf.splice(0, 3);
      return chunk;
    } else if (match(this.buf, [TELNET.IAC, TELNET.SB, "number"])) {
      // Subnegotiation parsing: IAC SB <option> <data...> IAC SE
      //
      // Within subnegotiation data, IAC bytes must be escaped as IAC IAC.
      // Example: To send data [1, 2, 255, 3, 4] for option 86:
      //   Wire format: IAC SB 86 1 2 IAC IAC 3 4 IAC SE
      //   Parsed data: [1, 2, 255, 3, 4]
      //
      // This parser handles:
      // - IAC IAC -> single IAC byte in data
      // - IAC SE -> end of subnegotiation
      // - Incomplete sequences (returns null to wait for more data)

      let i = 3;
      let data = [];
      while (i < this.buf.length - 1) {
        // Ensure we can check i+1
        if (this.buf[i] === TELNET.IAC) {
          if (this.buf[i + 1] === TELNET.SE) {
            // Found terminator - return complete subnegotiation
            const chunk: Chunk = {
              type: "subnegotiation",
              target: this.buf[2],
              data: Uint8Array.from(data),
            };
            this.buf.splice(0, i + 2); // Remove through IAC SE
            return chunk;
          } else if (this.buf[i + 1] === TELNET.IAC) {
            // Escaped IAC - add single IAC to data
            data.push(TELNET.IAC);
            i += 2; // Skip both IAC bytes
            continue;
          }
          // else: IAC followed by something else - protocol error, but we'll
          // treat it as regular data to be lenient
        }
        data.push(this.buf[i]);
        i++;
      }
      // Incomplete sequence - wait for more data
      return null;
    } else if (match(this.buf, [TELNET.IAC, "number"])) {
      const chunk: Chunk = { type: "command", code: this.buf[1] };
      this.buf.splice(0, 2);
      return chunk;
    } else {
      // Not enough buffered data to parse a chunk
    }

    return null;
  }
}

// const parser = new Parser()
// parser.push(Buffer.from([
//   Cmd.IAC, Cmd.DO, Cmd.MCCP2,
//   Cmd.IAC, Cmd.SB, 1, 2, 3, Cmd.IAC, Cmd.SE,
//   Cmd.IAC, Cmd.DO, Cmd.MCCP2,
// ]))
// console.log('buf', parser.buf)
// console.log(parser.next())
// console.log('buf', parser.buf)
// console.log(parser.next())
// console.log('buf', parser.buf)
// console.log(parser.next())

// const buffer = Uint8Array.from([
//   1, 2, 3,
//   Cmd.IAC, Cmd.DO, Cmd.MCCP2,
//   Cmd.IAC, Cmd.SB, 1, 2, 3, Cmd.IAC, Cmd.SE,
//   Cmd.IAC, Cmd.DO, Cmd.MCCP2,
//   4, 5, 6,
// ])

// const r = new Readable()
// r.push(buffer)
// r.push(null)

// const stream = Parser.createStream()
// stream.on('data', chunk => {
//   console.log({chunk})
// })
// stream.on('end', () => {
//   console.log('parser end')
// })
// r.pipe(stream)
