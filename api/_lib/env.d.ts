/** Server-only env access for Vercel/Node without pulling @types/node into the Vite app. */
declare const process: {
  env: Record<string, string | undefined>;
};
