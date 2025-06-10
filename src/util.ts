import { Cmd } from "./parser.js";

export type NegotiationVerb = "DO" | "DONT" | "WILL" | "WONT";

export function autonegotiate(
  incoming: NegotiationVerb,
  reply: "accept" | "reject",
): (typeof Cmd)[keyof typeof Cmd] {
  switch (incoming) {
    case "DO": // Server tells us to do something
      return reply === "accept"
        ? Cmd.WILL // I will do it
        : Cmd.WONT; // I won't do it
    case "WILL": // Server says it will do something
      return reply === "accept"
        ? Cmd.DO // ok, you can do that
        : Cmd.DONT; // no, don't do it
    case "DONT": // Server tells us not to do something
      return Cmd.WONT; // ok, I won't do it
    case "WONT": // Server says it won't do something
      return Cmd.DONT; // ok, you don't need to do it
    default: {
      const exhaustive: never = incoming;
      throw new Error(`Unexpected negotiation request: ${exhaustive}`);
    }
  }
}
