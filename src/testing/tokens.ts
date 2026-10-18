// Fake bot tokens used by the leak tests. They are assembled here, at run time, so no complete token-shaped string is stored in the repository
// (GitHub's secret scanning rightly refuses those, even when they are made up). Datasets contain placeholders such as <<token-a>>.
const PARTS: Record<string, [string, string, string]> = {
  a: ['MTIzNDU2Nzg5', 'MDEyMzQ1Njc4OQ', 'GhIjKl.abcdefghijklmnopqrstuvwxyz123456'],
  b: ['NzQ5NTU1NTU1', 'NTU1NTU1NTU1', 'XyZaBc.abcdefghijklmnopqrstuvwxyz12345'],
  c: ['OTk1MjU1NTU1', 'NTU1NTU1NTU1', 'GxYzAb.AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
};
export const fakeToken = (key: string): string => { const p = PARTS[key]; if (!p) throw new Error(`unknown token placeholder ${key}`); return `${p[0]}${p[1]}.${p[2]}`; };
/** Replaces <<token-a>> style placeholders with the fake tokens. */
export const expandTokens = (text: string): string => text.replace(/<<token-(\w)>>/g, (_m, k: string) => fakeToken(k));
