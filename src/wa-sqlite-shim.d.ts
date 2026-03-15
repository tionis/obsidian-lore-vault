declare module '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs' {
  const moduleFactory: (moduleArg?: unknown) => Promise<unknown>;
  export default moduleFactory;
}

declare module '@journeyapps/wa-sqlite/src/examples/OPFSAdaptiveVFS.js' {
  export const OPFSAdaptiveVFS: any;
}

declare module '*.wasm' {
  const wasmBinary: Uint8Array;
  export default wasmBinary;
}
