/**
 * Type shim for static asset imports.
 *
 * Bun resolves `import logo from "./logo.png" with { type: "file" }` to
 * a runtime URL string. TypeScript needs the module to be declared so
 * the import typechecks.
 */
declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*.svg" {
  const url: string;
  export default url;
}

declare module "*.jpg" {
  const url: string;
  export default url;
}
