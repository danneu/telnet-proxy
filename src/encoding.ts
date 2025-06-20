export const Encoding = {
  utf8: "utf8",
  latin1: "latin1",
  gbk: "gbk",
  big5: "big5",
  "euc-kr": "euc-kr",
  cp949: "cp949",
} as const;

// eslint-disable-next-line
export type Encoding = (typeof Encoding)[keyof typeof Encoding];

export const allEncodings = Object.values(Encoding);
