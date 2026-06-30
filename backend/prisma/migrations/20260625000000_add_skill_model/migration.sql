-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_key" ON "Skill"("name");

-- CreateIndex
CREATE INDEX "Skill_name_idx" ON "Skill"("name");

-- Seed: standard skill taxonomy with common alternate spellings, so existing
-- free-text values like "ReactJS" / "react.js" normalise to one canonical
-- skill ("React") instead of fragmenting search and category filtering.
INSERT INTO "Skill" ("id", "name", "aliases", "category") VALUES
    (gen_random_uuid()::text, 'React', ARRAY['ReactJS', 'React.js', 'react.js'], 'Frontend'),
    (gen_random_uuid()::text, 'Next.js', ARRAY['NextJS', 'Next'], 'Frontend'),
    (gen_random_uuid()::text, 'Vue.js', ARRAY['VueJS', 'Vue'], 'Frontend'),
    (gen_random_uuid()::text, 'Angular', ARRAY['AngularJS'], 'Frontend'),
    (gen_random_uuid()::text, 'TypeScript', ARRAY['TS'], 'Frontend'),
    (gen_random_uuid()::text, 'JavaScript', ARRAY['JS'], 'Frontend'),
    (gen_random_uuid()::text, 'Tailwind CSS', ARRAY['Tailwind', 'TailwindCSS'], 'Frontend'),
    (gen_random_uuid()::text, 'Node.js', ARRAY['NodeJS', 'Node'], 'Backend'),
    (gen_random_uuid()::text, 'Express.js', ARRAY['ExpressJS', 'Express'], 'Backend'),
    (gen_random_uuid()::text, 'Python', ARRAY[]::TEXT[], 'Backend'),
    (gen_random_uuid()::text, 'Django', ARRAY[]::TEXT[], 'Backend'),
    (gen_random_uuid()::text, 'Go', ARRAY['Golang'], 'Backend'),
    (gen_random_uuid()::text, 'SQL', ARRAY[]::TEXT[], 'Backend'),
    (gen_random_uuid()::text, 'PostgreSQL', ARRAY['Postgres'], 'Backend'),
    (gen_random_uuid()::text, 'MongoDB', ARRAY['Mongo'], 'Backend'),
    (gen_random_uuid()::text, 'GraphQL', ARRAY[]::TEXT[], 'Backend'),
    (gen_random_uuid()::text, 'Rust', ARRAY[]::TEXT[], 'Smart Contract'),
    (gen_random_uuid()::text, 'Solidity', ARRAY[]::TEXT[], 'Smart Contract'),
    (gen_random_uuid()::text, 'Soroban', ARRAY[]::TEXT[], 'Smart Contract'),
    (gen_random_uuid()::text, 'Docker', ARRAY[]::TEXT[], 'DevOps'),
    (gen_random_uuid()::text, 'Kubernetes', ARRAY['K8s'], 'DevOps'),
    (gen_random_uuid()::text, 'AWS', ARRAY['Amazon Web Services'], 'DevOps'),
    (gen_random_uuid()::text, 'Figma', ARRAY[]::TEXT[], 'Design'),
    (gen_random_uuid()::text, 'UI/UX Design', ARRAY['UX Design', 'UI Design'], 'Design'),
    (gen_random_uuid()::text, 'Swift', ARRAY[]::TEXT[], 'Mobile'),
    (gen_random_uuid()::text, 'Kotlin', ARRAY[]::TEXT[], 'Mobile'),
    (gen_random_uuid()::text, 'React Native', ARRAY['ReactNative'], 'Mobile'),
    (gen_random_uuid()::text, 'Flutter', ARRAY[]::TEXT[], 'Mobile'),
    (gen_random_uuid()::text, 'Technical Writing', ARRAY[]::TEXT[], 'Documentation'),
    (gen_random_uuid()::text, 'Copywriting', ARRAY[]::TEXT[], 'Documentation');
