import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TELNET, type Chunk } from "../src/telnet/index.js";
import { Readable, PassThrough } from "stream";
import { createParser, createParserStream, createChunk } from "../src/telnet/index.js";


describe("Parser - Text Chunks", () => {
  test("parses simple text data", () => {
    const parser = createParser();
    const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"

    parser.push(testData);
    const chunk = parser.next();

    assert.deepEqual(chunk, createChunk.text(testData));
  });

  test("handles empty text data", () => {
    const parser = createParser();
    parser.push(new Uint8Array([]));

    const chunk = parser.next();
    assert.equal(chunk, null);
  });

  test("parses text until IAC byte", () => {
    const parser = createParser();
    const data = new Uint8Array([
      72,
      101,
      108,
      108,
      111,
      TELNET.IAC,
      TELNET.DO,
      TELNET.ECHO,
    ]);

    parser.push(data);
    const textChunk = parser.next();

    assert.deepEqual(textChunk, createChunk.text(new Uint8Array([72, 101, 108, 108, 111])));

    // Should have negotiation chunk next
    const negChunk = parser.next();
    assert.deepEqual(negChunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));
  });

  test("handles partial text data across multiple pushes", () => {
    const parser = createParser();

    parser.push(new Uint8Array([72, 101])); // "He"
    parser.push(new Uint8Array([108, 108, 111])); // "llo"

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([72, 101, 108, 108, 111]))); // "Hello"
  });

  test("handles binary data in text chunks", () => {
    const parser = createParser();
    const binaryData = new Uint8Array([0, 1, 2, 3, 254, 253, 252]); // High bytes but not 255 (IAC)

    parser.push(binaryData);
    const chunk = parser.next();

    assert.deepEqual(chunk, createChunk.text(binaryData));
  });
});

describe("Parser - Negotiation Chunks", () => {
  test("parses IAC DO command", () => {
    const parser = createParser();
    parser.push(new Uint8Array([TELNET.IAC, TELNET.DO, TELNET.ECHO]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));
  });

  test("parses IAC DONT command", () => {
    const parser = createParser();
    parser.push(new Uint8Array([TELNET.IAC, TELNET.DONT, TELNET.WINDOW_SIZE]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DONT, TELNET.WINDOW_SIZE));
  });

  test("parses IAC WILL command", () => {
    const parser = createParser();
    parser.push(new Uint8Array([TELNET.IAC, TELNET.WILL, TELNET.MCCP2]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.WILL, TELNET.MCCP2));
  });

  test("parses IAC WONT command", () => {
    const parser = createParser();
    parser.push(new Uint8Array([TELNET.IAC, TELNET.WONT, TELNET.GMCP]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.WONT, TELNET.GMCP));
  });

  test("handles partial negotation", () => {
    const parser = createParser();

    // IAC DO is incomplete negotiation
    parser.push(new Uint8Array([TELNET.IAC, TELNET.DO]));
    assert.equal(parser.next(), null);

    // IAC is incomplete
    const parser2 = createParser();
    parser2.push(new Uint8Array([TELNET.IAC]));
    assert.equal(parser2.next(), null);

    // Complete the negotiation
    parser2.push(new Uint8Array([TELNET.DO, TELNET.ECHO]));
    const chunk = parser2.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));
  });

  test("handles negotiation with unknown option codes", () => {
    const parser = createParser();
    const unknownOption = 199;
    parser.push(new Uint8Array([TELNET.IAC, TELNET.WILL, unknownOption]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.WILL, unknownOption));
  });
});

describe("Parser - Command Chunks", () => {
  test("parses IAC NOP command", () => {
    const parser = createParser();
    parser.push(new Uint8Array([TELNET.IAC, TELNET.NOP]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(TELNET.NOP));
  });

  test("parses IAC AYT command", () => {
    const parser = createParser();
    parser.push(new Uint8Array([TELNET.IAC, TELNET.ARE_YOU_THERE]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(TELNET.ARE_YOU_THERE));
  });

  test("parses IAC GA command", () => {
    const parser = createParser();
    parser.push(new Uint8Array([TELNET.IAC, TELNET.GA]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(TELNET.GA));
  });

  test("handles partial command", () => {
    const parser = createParser();

    parser.push(new Uint8Array([TELNET.IAC]));
    assert.equal(parser.next(), null);

    parser.push(new Uint8Array([TELNET.NOP]));
    const chunk = parser.next();

    assert.deepEqual(chunk, createChunk.command(TELNET.NOP));
  });

  test("handles unknown command codes", () => {
    const parser = createParser();
    const unknownCode = 200;
    parser.push(new Uint8Array([TELNET.IAC, unknownCode]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(unknownCode));
  });
});

describe("Parser - Subnegotiation Chunks", () => {
  test("parses basic subnegotiation", () => {
    const parser = createParser();
    const testData = [1, 2, 3, 4];
    parser.push(
      new Uint8Array([
        TELNET.IAC,
        TELNET.SB,
        TELNET.WINDOW_SIZE,
        ...testData,
        TELNET.IAC,
        TELNET.SE,
      ]),
    );

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.subnegotiation(TELNET.WINDOW_SIZE, new Uint8Array(testData)));
  });

  test("handles IAC escaping in subnegotiation data", () => {
    const parser = createParser();
    // Data should be [1, 255, 2] with IAC escaped as IAC IAC
    parser.push(
      new Uint8Array([
        TELNET.IAC,
        TELNET.SB,
        TELNET.MCCP2,
        1,
        TELNET.IAC,
        TELNET.IAC,
        2,
        TELNET.IAC,
        TELNET.SE,
      ]),
    );

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.subnegotiation(TELNET.MCCP2, new Uint8Array([1, 255, 2])));
  });

  test("handles multiple consecutive escaped IACs", () => {
    const parser = createParser();
    // Data should be [255, 255, 255]
    parser.push(
      new Uint8Array([
        TELNET.IAC,
        TELNET.SB,
        50,
        TELNET.IAC,
        TELNET.IAC,
        TELNET.IAC,
        TELNET.IAC,
        TELNET.IAC,
        TELNET.IAC,
        TELNET.IAC,
        TELNET.SE,
      ]),
    );

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.subnegotiation(50, new Uint8Array([255, 255, 255])));
  });

  test("handles empty subnegotiation", () => {
    const parser = createParser();
    parser.push(
      new Uint8Array([
        TELNET.IAC,
        TELNET.SB,
        TELNET.ECHO,
        TELNET.IAC,
        TELNET.SE,
      ]),
    );

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.subnegotiation(TELNET.ECHO, new Uint8Array([])));
  });

  test("waits for complete subnegotiation", () => {
    const parser = createParser();

    // Incomplete subnegotiation
    parser.push(new Uint8Array([TELNET.IAC, TELNET.SB, TELNET.GMCP, 1, 2, 3]));
    assert.equal(parser.next(), null);

    // Complete it
    parser.push(new Uint8Array([TELNET.IAC, TELNET.SE]));
    const chunk = parser.next();

    assert.deepEqual(chunk, createChunk.subnegotiation(TELNET.GMCP, new Uint8Array([1, 2, 3])));
  });

  test("handles partial IAC at end of buffer", () => {
    const parser = createParser();

    // Buffer ends with IAC - could be IAC IAC or IAC SE
    parser.push(new Uint8Array([TELNET.IAC, TELNET.SB, 100, 1, 2, TELNET.IAC]));
    assert.equal(parser.next(), null);

    // It's IAC SE (terminator)
    parser.push(new Uint8Array([TELNET.SE]));
    const chunk = parser.next();

    assert.deepEqual(chunk, createChunk.subnegotiation(100, new Uint8Array([1, 2])));
  });

  test("handles IAC followed by non-IAC/SE in data", () => {
    const parser = createParser();

    // IAC followed by regular byte (protocol error but handled gracefully)
    parser.push(
      new Uint8Array([
        TELNET.IAC,
        TELNET.SB,
        100,
        1,
        TELNET.IAC,
        50,
        2, // IAC 50 treated as regular data
        TELNET.IAC,
        TELNET.SE,
      ]),
    );

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.subnegotiation(100, new Uint8Array([1, TELNET.IAC, 50, 2])));
  });
});

describe("Parser - Mixed Content Streaming", () => {
  test("parses sequence of different chunk types", () => {
    const parser = createParser();

    const data = new Uint8Array([
      // Text data
      72,
      101,
      108,
      108,
      111,
      32, // "Hello "
      // Negotiation
      TELNET.IAC,
      TELNET.DO,
      TELNET.ECHO,
      // More text
      87,
      111,
      114,
      108,
      100, // "World"
      // Command
      TELNET.IAC,
      TELNET.NOP,
      // Subnegotiation
      TELNET.IAC,
      TELNET.SB,
      TELNET.WINDOW_SIZE,
      1,
      2,
      TELNET.IAC,
      TELNET.SE,
    ]);

    parser.push(data);

    // Parse text chunk
    let chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([72, 101, 108, 108, 111, 32])));

    // Parse negotiation
    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));

    // Parse more text
    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([87, 111, 114, 108, 100])));

    // Parse command
    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(TELNET.NOP));

    // Parse subnegotiation
    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.subnegotiation(TELNET.WINDOW_SIZE, new Uint8Array([1, 2])));

    // No more chunks
    assert.equal(parser.next(), null);
  });

  test("handles streaming data across multiple pushes", () => {
    const parser = createParser();

    // Push data in small chunks
    parser.push(new Uint8Array([72, 101])); // "He"
    parser.push(new Uint8Array([108, 108, 111])); // "llo"
    parser.push(new Uint8Array([TELNET.IAC])); // Start IAC
    parser.push(new Uint8Array([TELNET.DO])); // Continue negotiation
    parser.push(new Uint8Array([TELNET.ECHO])); // Complete negotiation

    // Should get text chunk first
    let chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([72, 101, 108, 108, 111])));

    // Should get negotiation chunk
    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));
  });

  test("handles interleaved complete and incomplete chunks", () => {
    const parser = createParser();

    // Complete text + incomplete IAC
    parser.push(new Uint8Array([72, 101, 108, 108, 111, TELNET.IAC]));

    // Should get text chunk
    let chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([72, 101, 108, 108, 111])));

    // Should not get command yet (incomplete IAC)
    chunk = parser.next();
    assert.equal(chunk, null);

    // Complete the command + add more text
    parser.push(new Uint8Array([TELNET.NOP, 87, 111, 114, 108, 100]));

    // Should get command
    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(TELNET.NOP));

    // Should get more text
    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([87, 111, 114, 108, 100])));
  });
});

describe("Parser - Buffer Management", () => {
  test("drain() returns and clears buffer", () => {
    const parser = createParser();
    parser.push(new Uint8Array([1, 2, 3, 4, 5]));

    const drained = parser.drain();
    assert.deepEqual(drained, new Uint8Array([1, 2, 3, 4, 5]));
    assert.equal(parser.bufferedLength(), 0);
  });

  test("drain() returns empty array when buffer is empty", () => {
    const parser = createParser();
    const drained = parser.drain();
    assert.deepEqual(drained, new Uint8Array([]));
  });

  test("handles buffer overflow protection", () => {
    const smallParser = createParser({ maxBufferSize: 10 }); // 10 byte max

    // This should trigger overflow protection
    assert.throws(
      () => {
        smallParser.push(new Uint8Array(15));
      },
      {
        name: "ParserError",
        code: "BUFFER_OVERFLOW",
      },
    );

    // Buffer untouched (throws before adding any bytes)
    assert.equal(smallParser.bufferedLength(), 0);
  });

  test("buffer overflow resets and allows new data", () => {
    const smallParser = createParser({ maxBufferSize: 5 });

    // Fill buffer to capacity
    smallParser.push(new Uint8Array([1, 2, 3, 4, 5]));
    assert.equal(smallParser.bufferedLength(), 5);

    // This should trigger overflow and reset, but then add the new byte
    assert.throws(
      () => {
        smallParser.push(new Uint8Array([6]));
      },
      {
        name: "ParserError",
        code: "BUFFER_OVERFLOW",
      },
    );

    // Buffer untouched (throws before adding any bytes)
    assert.equal(smallParser.bufferedLength(), 5);
  });
});

describe("Parser - Stream Interface", () => {
  test("createStream() returns Transform stream", () => {
    const stream = createParserStream();
    assert(stream);
    assert.equal(typeof stream.pipe, "function");
    assert.equal(typeof stream.drain, "function");
  });

  test("stream processes data through transform", async () => {
    const stream = createParserStream();
    const chunks: Chunk[] = [];

    stream.on("data", (chunk) => {
      chunks.push(chunk);
    });

    const promise = new Promise<void>((resolve) => {
      stream.on("end", resolve);
    });

    // Write data to stream
    stream.write(new Uint8Array([72, 101, 108, 108, 111])); // "Hello"
    stream.write(new Uint8Array([TELNET.IAC, TELNET.DO, TELNET.ECHO]));
    stream.end();

    await promise;

    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0], createChunk.text(new Uint8Array([72, 101, 108, 108, 111])));
    assert.deepEqual(chunks[1], createChunk.negotiation(TELNET.DO, TELNET.ECHO));
  });

  test("stream drain() works correctly", () => {
    const stream = createParserStream();

    // Write incomplete data (just IAC)
    stream.write(new Uint8Array([TELNET.IAC]));

    // Drain should return the buffered data
    const drained = stream.drain();
    assert.deepEqual(drained, new Uint8Array([TELNET.IAC]));
  });

  test("stream handles backpressure correctly", async () => {
    const stream = createParserStream();
    const readable = new Readable({
      read() {
        this.push(new Uint8Array([72, 101, 108, 108, 111])); // "Hello"
        this.push(new Uint8Array([TELNET.IAC, TELNET.NOP]));
        this.push(null);
      },
    });

    const chunks: Chunk[] = [];
    const passThrough = new PassThrough({ objectMode: true });

    passThrough.on("data", (chunk) => {
      chunks.push(chunk);
    });

    const promise = new Promise<void>((resolve) => {
      passThrough.on("end", resolve);
    });

    readable.pipe(stream).pipe(passThrough);

    await promise;

    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0], createChunk.text(new Uint8Array([72, 101, 108, 108, 111])));
    assert.deepEqual(chunks[1], createChunk.command(TELNET.NOP));
  });

  test("stream with custom buffer size", () => {
    const stream = createParserStream({ maxBufferSize: 100 });
    assert(stream);

    // Test that it accepts the custom size by trying to overflow
    const data = new Uint8Array(50);
    data.fill(65); // Fill with 'A'

    stream.write(data);

    // Stream should still be functional
    assert.equal(typeof stream.drain, "function");
  });
});

describe("Parser - Edge Cases and Error Conditions", () => {
  test("handles consecutive IAC bytes", () => {
    const parser = createParser();

    // Multiple consecutive IAC commands
    parser.push(
      new Uint8Array([
        TELNET.IAC,
        TELNET.NOP,
        TELNET.IAC,
        TELNET.NOP,
        TELNET.IAC,
        TELNET.DO,
        TELNET.ECHO,
      ]),
    );

    let chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(TELNET.NOP));

    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.command(TELNET.NOP));

    chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));
  });

  test("handles zero-length pushes", () => {
    const parser = createParser();

    parser.push(new Uint8Array([]));
    assert.equal(parser.next(), null);

    parser.push(new Uint8Array([72, 101, 108, 108, 111]));
    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([72, 101, 108, 108, 111])));
  });

  test("handles single byte at a time", () => {
    const parser = createParser();

    const bytes = [TELNET.IAC, TELNET.DO, TELNET.ECHO];
    bytes.forEach((byte) => {
      parser.push(new Uint8Array([byte]));
    });

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));
  });

  test("handles Buffer input", () => {
    const parser = createParser();

    // Test with Node.js Buffer instead of Uint8Array
    parser.push(Buffer.from([72, 101, 108, 108, 111]));

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.text(new Uint8Array([72, 101, 108, 108, 111])));
  });

  test("preserves state across multiple next() calls with no data", () => {
    const parser = createParser();

    parser.push(new Uint8Array([TELNET.IAC])); // Incomplete IAC

    // Multiple calls should return null without corrupting state
    assert.equal(parser.next(), null);
    assert.equal(parser.next(), null);
    assert.equal(parser.next(), null);

    // Complete the command
    parser.push(new Uint8Array([TELNET.NOP]));
    const chunk = parser.next();

    assert.deepEqual(chunk, createChunk.command(TELNET.NOP));
  });

  test("handles large text chunks", () => {
    const parser = createParser();

    // Create large text chunk (1KB)
    const largeText = new Uint8Array(1024);
    largeText.fill(65); // Fill with 'A'

    parser.push(largeText);
    const chunk = parser.next();

    assert.deepEqual(chunk, createChunk.text(largeText));
  });

  test("handles maximum option code values", () => {
    const parser = createParser();

    // Test with maximum byte value (255 = IAC, but as option target)
    parser.push(new Uint8Array([TELNET.IAC, TELNET.DO, 254])); // 254 is max valid option

    const chunk = parser.next();
    assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, 254));
  });
});
