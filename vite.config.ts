import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "webview",
  base: "./",
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
    rollupOptions: { output: { entryFileNames: "app.js", assetFileNames: "app.[ext]" } }
  }
});
