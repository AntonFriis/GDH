declare module 'picomatch' {
  interface PicomatchApi {
    isMatch(input: string, pattern: string, options?: { dot?: boolean }): boolean;
  }

  const picomatch: PicomatchApi;

  export default picomatch;
}
