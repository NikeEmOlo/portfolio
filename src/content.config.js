import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projects = defineCollection({
    //watch this folder. One markdown file = one entry
    loader: glob({ pattern: "**/*.md", base: "./src/content/projects"}),
    //Define the shape each project file MUST follow
    schema: z.object({
        order: z.number(),
        projTitle: z.string(),
        cardTitle: z.string(),
        projType: z.string(),
        icon: z.string(),
        category: z.string(),
        tags: z.record(z.array(z.string())).optional(),
        overview: z.record(z.string()).optional(),
        buttonTxt: string().optional(),
        links: z.record(z.string()).optional(),
        active: z.boolean().default(true),
    }),
});

export const collections = { projects };