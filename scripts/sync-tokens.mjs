// Copies the tool's design tokens to its public stylesheet. No website checkout required.
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("public", { recursive: true });
copyFileSync("design/tokens.css", "public/tokens.css");
console.log("synced: tokens.css to public/");
