import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    root: "game",
    base: "/game/",
    publicDir: "../game-public",
    plugins: [react()],
    build: {
        outDir: "../public/game",
        emptyOutDir: true,
    },
});
