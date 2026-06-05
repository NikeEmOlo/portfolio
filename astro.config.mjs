// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

import mdx from "@astrojs/mdx";

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
      name: "DM Mono",
      cssVariable: "--secondary-font"
  },
  {
      provider: fontProviders.fontsource(),
      name: "Boldonse",
      cssVariable: "--boldonse"
  }],

  integrations: [mdx()]
});