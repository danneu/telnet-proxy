import { Transform } from "stream";
import { ParserStream } from "./parser.js";
import net from "net";

export type PipelineManager = ReturnType<typeof createPipelineManager>;

export function createPipelineManager(
  source: net.Socket, // or more simply: `Duplex`
  sink: ParserStream,
) {
  const transforms: Transform[] = [];
  const transformOwners = new WeakMap<Transform, string>();
  rebuildPipeline();

  function appendTransform(transform: Transform, owner: string) {
    console.log(`[Pipeline] ${owner} adding transform`);
    source.pause();

    // Drain sink buffer before rebuild
    const buffered = sink.drain();

    transforms.push(transform);
    transformOwners.set(transform, owner);

    rebuildPipeline();

    // Reinject buffered data back into the start of the pipeline
    if (buffered.length > 0) {
      source.push(buffered);
    }

    source.resume();
  }

  function removeTransform(transform: Transform): boolean {
    const owner = transformOwners.get(transform);
    const index = transforms.indexOf(transform);
    if (index === -1) return false;

    console.log(`[Pipeline] ${owner} removing transform`);

    source.pause();

    // Drain sink buffer
    const buffered = sink.drain();

    transforms.splice(index, 1);
    transformOwners.delete(transform);

    // Destroy the transform
    transform.destroy();

    rebuildPipeline();

    // Reinject buffered data back into the start of the pipeline
    if (buffered.length > 0) {
      source.push(buffered);
    }

    source.resume();

    return true;
  }

  function rebuildPipeline() {
    // Unpipe everything so we can rewire them
    source.unpipe();
    for (const transform of transforms) {
      transform.unpipe();
    }

    // Rebuild pipeline
    let current: NodeJS.ReadableStream = source;
    for (const transform of transforms) {
      current = current.pipe(transform);
    }
    current.pipe(sink);

    console.log(`[Pipeline] Rebuilt: ${printPipeline()}`);
  }

  function printPipeline(): string {
    return transforms.length === 0
      ? "source -> sink"
      : "source -> " +
          transforms
            .map((t) => transformOwners.get(t) || "<unknown>")
            .join(" -> ") +
          " -> sink";
  }

  return {
    appendTransform,
    removeTransform,
  };
}
