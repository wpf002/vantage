// Lets TypeScript resolve side-effect CSS imports (e.g. `import '@/styles/globals.css'`).
// Next.js handles the actual bundling; this only satisfies the type checker.
declare module '*.css';
