// Copies design/tokens.css to the two places that consume it as a plain stylesheet.
// The app imports design/tokens.css directly; the site and /public get copies.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("site", { recursive: true });
mkdirSync("public", { recursive: true });
copyFileSync("design/tokens.css", "site/tokens.css");
copyFileSync("design/tokens.css", "public/tokens.css");
copyFileSync("shared/chain.mjs", "site/chain.mjs");
copyFileSync("design/icons.json", "site/icons.json");
console.log("synced: tokens.css → site/, public/; chain.mjs → site/");
