declare module 'viem' {
  export function toHex(value: string): `0x${string}`;
  export function keccak256(value: `0x${string}`): `0x${string}`;
}
