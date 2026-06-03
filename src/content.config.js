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
        // Single-entry map of { categoryName: navSortOrder }, e.g. { development: 1 }.
        category: z.record(z.number()),
        tags: z.record(z.array(z.string())).optional(),
        overview: z.record(z.string()).optional(),
        buttonTxt: z.string().optional(),
        links: z.record(z.string()).optional(),
        active: z.boolean().default(true),
    }),
});

const overviews = defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/overviews" }),
    schema: ({ image }) => z.object({   
        projTitle: z.string(),
        img: image().optional(),
        imgClass: z.string().optional(),       
        buttonTxt: z.string().default("Dive In"),
        link: z.string(),
    }),
})

export const collections = { projects, overviews };