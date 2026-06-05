import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";
import { CATEGORIES } from "./categories.js";

const projects = defineCollection({
    //watch this folder. One markdown file = one entry
    loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects"}),
    //Define the shape each project file MUST follow
    schema: z.object({
        order: z.number(),
        projTitle: z.string(),
        cardTitle: z.string(),
        projType: z.enum(["case study", "overview & timeline"]),
        icon: z.enum(["crab"]),
        category: z.enum(CATEGORIES),
        tags: z.record(z.array(z.string())).optional(),
        // The case-study page's summary tabs, e.g. { Task: "…", Goal: "…" }.
        projectOverview: z.record(z.string()).optional(),
        // Link to this project's landing-page panel in the `overviews` collection.
        overview: reference("overviews").optional(),
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
    }),
})

export const collections = { projects, overviews };
