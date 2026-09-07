// Copies design/tokens.css to the two places that consume it as a plain stylesheet.
// The app imports design/tokens.css directly; the site and /public get copies.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("site", { recursive: true });
mkdirSync("public", { recursive: true });
copyFileSync("design/tokens.css", "site/tokens.css");
copyFileSync("design/tokens.css", "public/tokens.css");
console.log("tokens synced → site/tokens.css, public/tokens.css");
