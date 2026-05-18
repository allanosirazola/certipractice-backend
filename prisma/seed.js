/**
 * @fileoverview Database seed
 *
 * Populates the lookup tables that questions reference:
 *   - question_types   (single_choice, multiple_choice)
 *   - providers        (AWS, GCP, Azure, Oracle, Salesforce, ML, DevOps, General)
 *   - certifications   (full list extracted from the Python importer)
 *   - topics           (one default "General" topic per certification +
 *                       a placeholder set of common categories)
 *
 * The categories list mirrors what extractCategory() detected in the
 * original importer, so when we re-run the JSON importer it can map
 * "Compute", "Storage", etc. directly onto topic rows.
 *
 * Idempotent: re-running the seed is safe. Every INSERT uses
 * ON CONFLICT DO NOTHING so manually-added rows are preserved.
 *
 * Usage:
 *   npx prisma db seed
 *   # or directly
 *   node prisma/seed.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// ─── Static reference data ────────────────────────────────────────────

const QUESTION_TYPES = [
  { name: 'single_choice',    description: 'One correct answer out of N options' },
  { name: 'multiple_choice',  description: 'Multiple correct answers expected' },
];

const PROVIDERS = [
  { code: 'AWS',         name: 'Amazon Web Services',  description: 'Amazon cloud platform' },
  { code: 'GCP',         name: 'Google Cloud Platform', description: 'Google cloud platform' },
  { code: 'Azure',       name: 'Microsoft Azure',       description: 'Microsoft cloud platform' },
  { code: 'Oracle',      name: 'Oracle Cloud',          description: 'Oracle Cloud Infrastructure' },
  { code: 'Salesforce',  name: 'Salesforce',            description: 'Salesforce platform' },
  { code: 'ML',          name: 'Machine Learning',      description: 'Provider-agnostic ML/AI' },
  { code: 'DevOps',      name: 'DevOps & Containers',   description: 'Kubernetes, Docker, CI/CD' },
  { code: 'General',     name: 'General',               description: 'Provider-agnostic content' },
];

// Cert code → { name, providerCode }. Source: extractCertification() in
// the original Python importer.
const CERTIFICATIONS = [
  // AWS
  { code: 'SAA-C03', name: 'AWS Certified Solutions Architect – Associate',         providerCode: 'AWS' },
  { code: 'SAA-C02', name: 'AWS Certified Solutions Architect – Associate (C02)',   providerCode: 'AWS' },
  { code: 'SAP-C02', name: 'AWS Certified Solutions Architect – Professional',      providerCode: 'AWS' },
  { code: 'DVA-C01', name: 'AWS Certified Developer – Associate (C01)',             providerCode: 'AWS' },
  { code: 'DVA-C02', name: 'AWS Certified Developer – Associate',                   providerCode: 'AWS' },
  { code: 'SOA-C02', name: 'AWS Certified SysOps Administrator – Associate',        providerCode: 'AWS' },
  { code: 'DOP-C02', name: 'AWS Certified DevOps Engineer – Professional',          providerCode: 'AWS' },
  { code: 'SCS-C02', name: 'AWS Certified Security – Specialty',                    providerCode: 'AWS' },
  { code: 'MLS-C01', name: 'AWS Certified Machine Learning – Specialty',            providerCode: 'AWS' },
  { code: 'DAS-C01', name: 'AWS Certified Data Analytics – Specialty',              providerCode: 'AWS' },
  { code: 'DBS-C01', name: 'AWS Certified Database – Specialty',                    providerCode: 'AWS' },
  { code: 'ANS-C01', name: 'AWS Certified Advanced Networking – Specialty',         providerCode: 'AWS' },

  // GCP
  { code: 'PDE',     name: 'Professional Data Engineer',                            providerCode: 'GCP' },
  { code: 'PCA',     name: 'Professional Cloud Architect',                          providerCode: 'GCP' },
  { code: 'ACE',     name: 'Associate Cloud Engineer',                              providerCode: 'GCP' },
  { code: 'PCD',     name: 'Professional Cloud Developer',                          providerCode: 'GCP' },
  { code: 'PCSE',    name: 'Professional Cloud Security Engineer',                  providerCode: 'GCP' },
  { code: 'PCNE',    name: 'Professional Cloud Network Engineer',                   providerCode: 'GCP' },
  { code: 'PCDE',    name: 'Professional Cloud DevOps Engineer',                    providerCode: 'GCP' },
  { code: 'PMLE',    name: 'Professional Machine Learning Engineer',                providerCode: 'GCP' },

  // Azure
  { code: 'AZ-900',  name: 'Azure Fundamentals',                                    providerCode: 'Azure' },
  { code: 'AZ-104',  name: 'Azure Administrator Associate',                         providerCode: 'Azure' },
  { code: 'AZ-204',  name: 'Azure Developer Associate',                             providerCode: 'Azure' },
  { code: 'AZ-305',  name: 'Azure Solutions Architect Expert',                      providerCode: 'Azure' },
  { code: 'AZ-400',  name: 'Azure DevOps Engineer Expert',                          providerCode: 'Azure' },
  { code: 'AZ-500',  name: 'Azure Security Engineer Associate',                     providerCode: 'Azure' },
  { code: 'DP-203',  name: 'Azure Data Engineer Associate',                         providerCode: 'Azure' },
  { code: 'DP-100',  name: 'Azure Data Scientist Associate',                        providerCode: 'Azure' },
  { code: 'AI-102',  name: 'Azure AI Engineer Associate',                           providerCode: 'Azure' },

  // Kubernetes (DevOps)
  { code: 'CKA',     name: 'Certified Kubernetes Administrator',                    providerCode: 'DevOps' },
  { code: 'CKAD',    name: 'Certified Kubernetes Application Developer',            providerCode: 'DevOps' },
  { code: 'CKS',     name: 'Certified Kubernetes Security Specialist',              providerCode: 'DevOps' },

  // Generic
  { code: 'GENERAL', name: 'General Knowledge',                                     providerCode: 'General' },
];

// Default categories per cert. The importer maps a question's "category"
// string to (cert_code → topic_name) via these. Anything unknown falls
// back to "General".
const TOPIC_NAMES_PER_CERT = [
  'General',
  'Compute',
  'Storage',
  'Networking',
  'Database',
  'Security',
  'Monitoring',
  'Cost',
  'Migration',
  'Analytics',
  'Machine Learning',
  'DevOps',
];

// ─── Run ──────────────────────────────────────────────────────────────

async function main() {
  console.log('▶ Seeding question_types…');
  for (const qt of QUESTION_TYPES) {
    await prisma.questionType.upsert({
      where:  { name: qt.name },
      update: {},
      create: qt,
    });
  }

  console.log('▶ Seeding providers…');
  const providerByCode = new Map();
  for (const p of PROVIDERS) {
    const row = await prisma.provider.upsert({
      where:  { code: p.code },
      update: {},
      create: p,
    });
    providerByCode.set(p.code, row.id);
  }

  console.log('▶ Seeding certifications…');
  const certByCode = new Map();
  for (const c of CERTIFICATIONS) {
    const providerId = providerByCode.get(c.providerCode);
    if (!providerId) {
      console.warn(`  ✗ no provider for cert ${c.code}; skipping`);
      continue;
    }
    const row = await prisma.certification.upsert({
      where:  { code: c.code },
      update: {},
      create: {
        code: c.code, name: c.name, providerId, difficulty: 'medium',
      },
    });
    certByCode.set(c.code, row.id);
  }

  console.log('▶ Seeding topics (one set per certification)…');
  let topicCount = 0;
  for (const [certCode, certId] of certByCode.entries()) {
    for (let i = 0; i < TOPIC_NAMES_PER_CERT.length; i++) {
      const name = TOPIC_NAMES_PER_CERT[i];
      await prisma.topic.upsert({
        where:  { certificationId_name: { certificationId: certId, name } },
        update: {},
        create: { certificationId: certId, name, orderIndex: i },
      });
      topicCount++;
    }
  }
  console.log(`  ✓ ${topicCount} topics ready`);

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
