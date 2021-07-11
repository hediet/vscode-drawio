import { Buffer as Buf } from "buffer";

export type BufferImpl = Buffer;
export const BufferImpl = typeof Buffer === "undefined" ? Buf : Buffer;
