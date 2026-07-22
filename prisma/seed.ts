import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, TagType } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding categories...");

  const categories = [
    {
      name: "Anime/Manga",
      description: "All fanfictions based on anime and manga.",
      slug: "anime-manga",
    },
    {
      name: "Books",
      description: "All fanfictions based on books.",
      slug: "books",
    },
    {
      name: "Cartoons",
      description: "All fanfictions based on cartoons.",
      slug: "cartoons",
    },
    {
      name: "Comics",
      description: "All fanfictions based on comics.",
      slug: "comics",
    },
    {
      name: "Video Games",
      description: "All fanfictions based on video games.",
      slug: "video-games",
    },
    {
      name: "Movies/TV",
      description: "All fanfictions based on movies and TV shows.",
      slug: "movies-tv",
    },
    {
      name: "Music",
      description: "All fanfictions based on music.",
      slug: "music",
    },
    {
      name: "Plays",
      description: "All fanfictions based on plays.",
      slug: "plays",
    },
    {
      name: "Podcasts",
      description: "All fanfictions based on podcasts.",
      slug: "podcasts",
    },
    { name: "Others", description: "All other fanfictions.", slug: "others" },
  ];

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        name: category.name,
        description: category.description,
        slug: category.slug,
      },
    });
  }

  console.log("✅ Categories seeded successfully!");

  console.log("🌱 Seeding Original Content...");

  await prisma.fandom.upsert({
    where: { slug: "original-content" },
    update: {},
    create: {
      name: "Original Content",
      description: "Original content created by the community.",
      slug: "original-content",
      category: {
        connectOrCreate: {
          where: { slug: "others" },
          create: {
            name: "Others",
            description: "All other fanfictions.",
            slug: "others",
          },
        },
      },
    },
  });

  await prisma.fandom.upsert({
    where: { slug: "historical" },
    update: {},
    create: {
      name: "Historical",
      description: "Historical fiction created by the community.",
      slug: "historical",
      category: {
        connectOrCreate: {
          where: { slug: "others" },
          create: {
            name: "Others",
            description: "All other fanfictions.",
            slug: "others",
          },
        },
      },
    },
  });

  console.log("✅ Original Content & Historical Ficition seeded successfully!");

  console.log("🌱 Seeding Warning Tags...");

  const WARNING_TAGS = [
    { name: "major character death", slug: "major-character-death" },
    { name: "graphic violence", slug: "graphic-violence" },
    { name: "rape/non-con", slug: "rape-non-con" },
    { name: "underage", slug: "underage" },
    { name: "self-harm", slug: "self-harm" },
    { name: "suicide", slug: "suicide" },
    { name: "no warnings apply", slug: "no-warnings-apply" },
    {
      name: "author chose not to use warnings",
      slug: "author-chose-not-to-warn",
    },
  ];

  for (const warning of WARNING_TAGS) {
    await prisma.tag.upsert({
      where: { name: warning.name },
      update: {},
      create: { ...warning, type: TagType.WARNING, usageCount: 0 },
    });
  }

  console.log("✅ Original Content & Historical Ficition seeded successfully!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
