import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TELNET } from "../src/telnet/index.js";
import { createParser, createChunk } from "../src/telnet/parser.js";

describe("Parser - Long-term Stability Tests", () => {
  test("handles thousands of operations without degradation", () => {
    const parser = createParser();
    let totalChunks = 0;
    let textChunks = 0;
    let negotiationChunks = 0;
    let commandChunks = 0;
    let subnegotiationChunks = 0;

    // Helper to consume all available chunks
    function consumeAllChunks() {
      let chunk;
      while ((chunk = parser.next()) !== null) {
        totalChunks++;
        switch (chunk.type) {
          case "text":
            textChunks++;
            break;
          case "negotiation":
            negotiationChunks++;
            break;
          case "command":
            commandChunks++;
            break;
          case "subnegotiation":
            subnegotiationChunks++;
            break;
        }
      }
    }

    // Perform 10,000 operations with mixed data
    for (let i = 0; i < 10000; i++) {
      const operation = i % 7;

      switch (operation) {
        case 0: {
          // Simple text
          const text = `Hello World ${i}`;
          const data = new TextEncoder().encode(text);
          parser.push(data);
          consumeAllChunks();
          break;
        }

        case 1: {
          // Negotiation command
          parser.push(new Uint8Array([TELNET.IAC, TELNET.DO, TELNET.ECHO]));
          consumeAllChunks();
          break;
        }

        case 2: {
          // Command
          parser.push(new Uint8Array([TELNET.IAC, TELNET.NOP]));
          consumeAllChunks();
          break;
        }

        case 3: {
          // Subnegotiation with data
          const data = new Uint8Array([1, 2, 3, i % 256]);
          parser.push(
            new Uint8Array([
              TELNET.IAC,
              TELNET.SB,
              TELNET.WINDOW_SIZE,
              ...data,
              TELNET.IAC,
              TELNET.SE,
            ]),
          );
          consumeAllChunks();
          break;
        }

        case 4: {
          // Mixed content in single push
          const textData = new TextEncoder().encode(`Mixed ${i}`);
          parser.push(
            new Uint8Array([
              ...textData,
              TELNET.IAC,
              TELNET.WILL,
              TELNET.MCCP2,
              65,
              66,
              67, // More text: "ABC"
            ]),
          );
          consumeAllChunks();
          break;
        }

        case 5: {
          // Partial data across multiple pushes
          parser.push(new Uint8Array([72, 101])); // "He"
          parser.push(new Uint8Array([108, 108, 111])); // "llo"
          parser.push(new Uint8Array([TELNET.IAC])); // Start IAC
          parser.push(new Uint8Array([TELNET.DO])); // Continue
          parser.push(new Uint8Array([TELNET.CHARSET])); // Complete
          consumeAllChunks();
          break;
        }

        case 6: {
          // Subnegotiation with IAC escaping
          parser.push(
            new Uint8Array([
              TELNET.IAC,
              TELNET.SB,
              TELNET.GMCP,
              100,
              TELNET.IAC,
              TELNET.IAC,
              200, // 100, 255, 200
              TELNET.IAC,
              TELNET.SE,
            ]),
          );
          consumeAllChunks();
          break;
        }
      }
    }

    // Verify we processed a reasonable number of chunks
    assert(totalChunks > 8000, `Expected >8000 chunks, got ${totalChunks}`);
    assert(textChunks > 0, "Should have processed text chunks");
    assert(negotiationChunks > 0, "Should have processed negotiation chunks");
    assert(commandChunks > 0, "Should have processed command chunks");
    assert(
      subnegotiationChunks > 0,
      "Should have processed subnegotiation chunks",
    );

    console.log(`Processed ${totalChunks} chunks total:`);
    console.log(`  Text: ${textChunks}`);
    console.log(`  Negotiation: ${negotiationChunks}`);
    console.log(`  Command: ${commandChunks}`);
    console.log(`  Subnegotiation: ${subnegotiationChunks}`);
  });

  test("buffer management remains consistent over many operations", () => {
    const parser = createParser({ maxBufferSize: 1000 });

    // Add incomplete data multiple times
    for (let i = 0; i < 1000; i++) {
      // Add incomplete subnegotiation
      parser.push(new Uint8Array([TELNET.IAC, TELNET.SB, 100, 1, 2, 3]));

      // Verify buffer has data
      assert(parser.bufferedLength() > 0);

      // Try to parse (should return null)
      assert.equal(parser.next(), null);

      // Complete it
      parser.push(new Uint8Array([TELNET.IAC, TELNET.SE]));

      // Should now parse successfully
      const chunk = parser.next();
      assert.deepEqual(
        chunk,
        createChunk.subnegotiation(100, new Uint8Array([1, 2, 3])),
      );

      // Buffer should be empty now
      assert.equal(parser.bufferedLength(), 0);
    }
  });

  test("handles alternating complete and incomplete sequences", () => {
    const parser = createParser();
    let completeChunks = 0;

    for (let i = 0; i < 5000; i++) {
      if (i % 2 === 0) {
        // Complete sequence
        parser.push(new Uint8Array([TELNET.IAC, TELNET.NOP]));
        const chunk = parser.next();
        assert.deepEqual(chunk, createChunk.command(TELNET.NOP));
        completeChunks++;
      } else {
        // Incomplete then complete
        parser.push(new Uint8Array([TELNET.IAC]));
        assert.equal(parser.next(), null);

        parser.push(new Uint8Array([TELNET.ARE_YOU_THERE]));
        const chunk = parser.next();
        assert.deepEqual(chunk, createChunk.command(TELNET.ARE_YOU_THERE));
        completeChunks++;
      }
    }

    assert.equal(completeChunks, 5000);
  });

  test("repeated drain and fill operations", () => {
    const parser = createParser();

    for (let i = 0; i < 1000; i++) {
      // Fill with incomplete data
      parser.push(new Uint8Array([72, 101, 108, 108, 111])); // "Hello"
      parser.push(new Uint8Array([TELNET.IAC])); // Incomplete

      // Verify we can get the text but not the IAC
      const textChunk = parser.next();
      assert.deepEqual(
        textChunk,
        createChunk.text(new Uint8Array([72, 101, 108, 108, 111])),
      );
      assert.equal(parser.next(), null);

      // Drain the buffer
      const drained = parser.drain();
      assert.deepEqual(drained, new Uint8Array([TELNET.IAC]));
      assert.equal(parser.bufferedLength(), 0);

      // Fill again with both IAC and NOP to make a complete command
      parser.push(new Uint8Array([TELNET.IAC, TELNET.NOP]));
      const cmdChunk = parser.next();
      assert.deepEqual(cmdChunk, createChunk.command(TELNET.NOP));
    }
  });

  test("large data chunks with embedded commands", () => {
    const parser = createParser({ maxBufferSize: 10000 });

    for (let i = 0; i < 100; i++) {
      // Create large text with embedded telnet commands
      const largeText = new Uint8Array(1000 + i);
      largeText.fill(65 + (i % 26)); // Fill with letters A-Z

      const data = new Uint8Array([
        ...largeText,
        TELNET.IAC,
        TELNET.WILL,
        TELNET.ECHO,
        ...largeText,
        TELNET.IAC,
        TELNET.SB,
        TELNET.WINDOW_SIZE,
        80,
        24,
        TELNET.IAC,
        TELNET.SE,
        ...largeText,
      ]);

      parser.push(data);

      // Should get first text chunk
      let chunk = parser.next();
      assert.deepEqual(chunk, createChunk.text(largeText));

      // Should get negotiation
      chunk = parser.next();
      assert.deepEqual(
        chunk,
        createChunk.negotiation(TELNET.WILL, TELNET.ECHO),
      );

      // Should get second text chunk
      chunk = parser.next();
      assert.deepEqual(chunk, createChunk.text(largeText));

      // Should get subnegotiation
      chunk = parser.next();
      assert.deepEqual(
        chunk,
        createChunk.subnegotiation(
          TELNET.WINDOW_SIZE,
          new Uint8Array([80, 24]),
        ),
      );

      // Should get third text chunk
      chunk = parser.next();
      assert.deepEqual(chunk, createChunk.text(largeText));

      // No more chunks
      assert.equal(parser.next(), null);
    }
  });

  test("state preservation across thousands of incomplete sequences", () => {
    const parser = createParser();
    let completedSequences = 0;

    // Build up incomplete sequences and then complete them
    for (let i = 0; i < 1000; i++) {
      // Start incomplete subnegotiation (ensure target is 1-254, not 0 or 255)
      const target = (i % 254) + 1;
      parser.push(new Uint8Array([TELNET.IAC, TELNET.SB, target]));

      // Add some data (avoid 255 which would need escaping)
      const data = new Uint8Array(5);
      const fillValue = i % 255; // 0-254, never 255
      data.fill(fillValue);
      parser.push(data);

      // Should be incomplete
      assert.equal(parser.next(), null);

      // Complete with IAC SE
      parser.push(new Uint8Array([TELNET.IAC, TELNET.SE]));

      // Should now be complete
      const chunk = parser.next();
      assert.deepEqual(chunk, createChunk.subnegotiation(target, data));
      completedSequences++;

      // Verify buffer is clean
      assert.equal(parser.bufferedLength(), 0);
    }

    assert.equal(completedSequences, 1000);
  });

  test("memory usage remains stable during continuous operation", () => {
    const parser = createParser({ maxBufferSize: 5000 });

    // Run continuous operations and monitor buffer size
    const maxBufferSizes: number[] = [];

    for (let i = 0; i < 2000; i++) {
      // Add varying amounts of data
      const textSize = (i % 100) + 1;
      const textData = new Uint8Array(textSize);
      textData.fill(65 + (i % 26));

      parser.push(textData);
      parser.push(new Uint8Array([TELNET.IAC, TELNET.DO, TELNET.ECHO]));

      // Process chunks
      let chunk = parser.next();
      assert.deepEqual(chunk, createChunk.text(textData));

      chunk = parser.next();
      assert.deepEqual(chunk, createChunk.negotiation(TELNET.DO, TELNET.ECHO));

      // Record buffer size (should be 0 after processing)
      maxBufferSizes.push(parser.bufferedLength());

      // Occasionally add incomplete data to test buffer management
      if (i % 50 === 0) {
        parser.push(new Uint8Array([TELNET.IAC]));
        assert.equal(parser.next(), null);
        parser.push(new Uint8Array([TELNET.NOP]));
        chunk = parser.next();
        assert.deepEqual(chunk, createChunk.command(TELNET.NOP));
      }
    }

    // Buffer should consistently return to 0 after processing
    const nonZeroBuffers = maxBufferSizes.filter((size) => size > 0);
    assert(
      nonZeroBuffers.length < maxBufferSizes.length * 0.1,
      "Buffer should be empty most of the time after processing",
    );
  });
});
