// Renders every marketing page to static HTML after `vite build`, so crawlers
// get the page content without running the app. Each page lands in
// dist/client/_pages/<name>.html, which the worker serves for that path.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "dist/client");
const serverDir = path.join(root, "dist/prerender");
const ROOT_DIV = '<div id="root"></div>';

const template = await fs.readFile(path.join(clientDir, "index.html"), "utf8");
if (!template.includes(ROOT_DIV)) {
  throw new Error(`prerender: ${ROOT_DIV} not found in index.html`);
}

const { render, SEO_PAGES } = await import(
  path.join(serverDir, "entry-server.js")
);

await fs.mkdir(path.join(clientDir, "_pages"), { recursive: true });

for (const pathname of Object.keys(SEO_PAGES)) {
  const appHtml = await render(pathname);
  const html = template.replace(
    ROOT_DIV,
    () => `<div id="root">${appHtml}</div>`,
  );
  const name = pathname === "/" ? "home" : pathname.slice(1);
  await fs.writeFile(path.join(clientDir, "_pages", `${name}.html`), html);
  console.log(`prerendered ${pathname} → _pages/${name}.html`);
}

await fs.rm(serverDir, { recursive: true, force: true });
