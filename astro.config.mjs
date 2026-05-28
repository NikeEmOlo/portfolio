// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
    fonts: [
    {
        provider: fontProviders.fontsource(),
        name: "David Libre",
        cssVariable: "--main-font"
    },
    {
        provider: fontProviders.fontsource(),
        name: "DM Sans",
        cssVariable: "--secondary-font"
    }]
});
