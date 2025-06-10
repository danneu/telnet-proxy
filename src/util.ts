import { Cmd } from "./parser.js";

export function autonegotiate(
  incoming: Cmd["DO"] | Cmd["DONT"] | Cmd["WILL"] | Cmd["WONT"],
  reply: "accept" | "reject",
): Cmd["DO"] | Cmd["DONT"] | Cmd["WILL"] | Cmd["WONT"] {
  switch (incoming) {
    case Cmd.DO: // Server tells us to do something
      return reply === "accept"
        ? Cmd.WILL // I will do it
        : Cmd.WONT; // I won't do it
    case Cmd.WILL: // Server says it will do something
      return reply === "accept"
        ? Cmd.DO // ok, you can do that
        : Cmd.DONT; // no, don't do it
    case Cmd.DONT: // Server tells us not to do something
      return Cmd.WONT; // ok, I won't do it
    case Cmd.WONT: // Server says it won't do something
      return Cmd.DONT; // ok, you don't need to do it
    default: {
      const exhaustive: never = incoming;
      throw new Error(`Unexpected negotiation request: ${exhaustive}`);
    }
  }
}
