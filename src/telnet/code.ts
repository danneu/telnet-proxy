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
  GA: 249,
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
