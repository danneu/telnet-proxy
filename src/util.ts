import { TELNET } from "./telnet/index.js";

export function autonegotiate(
  incoming: TELNET["DO"] | TELNET["DONT"] | TELNET["WILL"] | TELNET["WONT"],
  reply: "accept" | "reject",
): TELNET["DO"] | TELNET["DONT"] | TELNET["WILL"] | TELNET["WONT"] {
  switch (incoming) {
    case TELNET.DO: // Server tells us to do something
      return reply === "accept"
        ? TELNET.WILL // I will do it
        : TELNET.WONT; // I won't do it
    case TELNET.WILL: // Server says it will do something
      return reply === "accept"
        ? TELNET.DO // ok, you can do that
        : TELNET.DONT; // no, don't do it
    case TELNET.DONT: // Server tells us not to do something
      return TELNET.WONT; // ok, I won't do it
    case TELNET.WONT: // Server says it won't do something
      return TELNET.DONT; // ok, you don't need to do it
    default: {
      const exhaustive: never = incoming;
      throw new Error(`Unexpected negotiation request: ${exhaustive}`);
    }
  }
}
