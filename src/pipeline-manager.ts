import { Transform } from "stream";
import { ParserStream } from "./parser.js";
import net from "net";

export type PipelineManager = ReturnType<typeof createPipelineManager>;

export function createPipelineManager(source: net.Socket, sink: ParserStream) {
  const transforms: Transform[] = [];
  const transformOwners: WeakMap<Transform, string> = new WeakMap();
  rebuildPipeline();

  function appendTransform(transform: Transform, owner: string) {
    console.log(`[Pipeline] ${owner} adding transform`);

    // Drain sink buffer before rebuild
    const buffered = sink.drain();

    transforms.push(transform);
    transformOwners.set(transform, owner);

    rebuildPipeline();

    // Reinject buffered data
    if (buffered?.length > 0) {
      source.push(buffered);
    }
  }

  function removeTransform(transform: Transform): boolean {
    const owner = transformOwners.get(transform);
    const index = transforms.indexOf(transform);

    if (index === -1) return false;

    console.log(`[Pipeline] ${owner} removing transform`);

    // Drain sink buffer
    const buffered = sink.drain();

    transforms.splice(index, 1);
    transformOwners.delete(transform);

    rebuildPipeline();

    // Reinject buffered data
    if (buffered?.length > 0) {
      source.push(buffered);
    }

    return true;
  }

  function rebuildPipeline() {
    // Unpipe everything
    source.unpipe();
    for (const transform of transforms) {
      transform.unpipe();
    }

    // Rebuild pipeline: source -> ...transforms -> sink
    let current: NodeJS.ReadableStream = source;
    for (const transform of transforms) {
      current = current.pipe(transform);
    }
    current.pipe(sink);

    console.log(
      `[Pipeline] Rebuilt: source -> ${transforms
        .map((t) => transformOwners.get(t) || "<unknown>")
        .join(" -> ")} -> sink`,
    );
  }

  return {
    appendTransform,
    removeTransform,
  };
}
