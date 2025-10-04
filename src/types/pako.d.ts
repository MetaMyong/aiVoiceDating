declare module 'pako' {
  export function inflate(data: Uint8Array | ArrayBuffer | number[] | Buffer): Uint8Array;
}
