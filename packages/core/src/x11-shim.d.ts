declare module "x11" {
  const x11: {
    createClient: (
      opts: { display?: string } | ((err: Error | null, display: unknown) => void),
      cb?: (err: Error | null, display: unknown) => void,
    ) => void;
    eventMask: Record<string, number>;
  };
  export = x11;
}
