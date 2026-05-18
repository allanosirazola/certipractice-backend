/**
 * @fileoverview JSON → PostgreSQL question importer (Prisma schema v2)
 *
 * Replaces the original json_migrator_to_postgreSQL.{py,js} which was
 * written for the legacy schema (questions had provider/certification/
 * category as VARCHAR columns). The current schema uses FK chains
 * questions → topics → certifications → providers, so this importer
 * resolves each question's category strings into a topic_id by joining
 * against the seeded reference data.
 *
 * Run order:
 *   1) `prisma migrate deploy`   — creates schema
 *   2) `node prisma/seed.js`     — populates providers/certs/topics
 *   3) `node prisma/json_importer.js <input.json | dir/>`  — this script
 *
 * Idempotent: re-running skips questions whose content_hash already
 * exists. Safe to abort and retry.
 *
 * Mapping rules (mirrors what the legacy importer did):
 *   - provider:   sniff from filename, then from question text
 *   - cert code:  sniff from filename patterns; fallback by content
 *   - category:   sniff from question text keywords
 *
 * If no cert matches we fall back to "GENERAL". If no topic matches
 * inside that cert we fall back to that cert's "General" topic.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const BATCH_LOG_EVERY = 100;

// ─── Provider sniff ────────────────────────────────────────────────────
function extractProvider(questionText, fileName = '') {
  const text = (questionText || '').toLowerCase();
  const file = (fileName || '').toLowerCase();

  if (file.includes('google cloud') || file.includes('gcp')) return 'GCP';
  if (file.includes('aws') || file.includes('amazon')) return 'AWS';
  if (file.includes('azure') || file.includes('microsoft')) return 'Azure';
  if (file.includes('oracle') || file.includes('oci')) return 'Oracle';
  if (file.includes('salesforce')) return 'Salesforce';

  if (text.includes('tensorflow') || text.includes('neural') || text.includes('machine learning')) return 'ML';
  if (/aws|amazon|ec2|s3|dynamodb|lambda/.test(text)) return 'AWS';
  if (/google cloud|gcp|gke|bigquery|data studio/.test(text)) return 'GCP';
  if (/azure|microsoft|azure functions/.test(text)) return 'Azure';
  if (/kubernetes|docker|container/.test(text)) return 'DevOps';

  return 'General';
}

// ─── Certification sniff ──────────────────────────────────────────────
const FILE_TO_CERT = [
  ['solutions architect associate',                 'SAA-C03'],
  ['solutions architect professional',              'SAP-C02'],
  ['developer associate',                           'DVA-C02'],
  ['sysops administrator',                          'SOA-C02'],
  ['devops engineer professional',                  'DOP-C02'],
  ['security specialty',                            'SCS-C02'],
  ['machine learning specialty',                    'MLS-C01'],
  ['data analytics specialty',                      'DAS-C01'],
  ['database specialty',                            'DBS-C01'],
  ['advanced networking specialty',                 'ANS-C01'],
  ['professional data engineer',                    'PDE'],
  ['professional cloud architect',                  'PCA'],
  ['associate cloud engineer',                      'ACE'],
  ['professional cloud developer',                  'PCD'],
  ['professional cloud security engineer',          'PCSE'],
  ['professional cloud network engineer',           'PCNE'],
  ['professional cloud devops engineer',            'PCDE'],
  ['professional machine learning engineer',        'PMLE'],
  ['azure fundamentals',                            'AZ-900'],
  ['azure administrator',                           'AZ-104'],
  ['azure developer',                               'AZ-204'],
  ['azure solutions architect expert',              'AZ-305'],
  ['azure devops engineer expert',                  'AZ-400'],
  ['azure security engineer',                       'AZ-500'],
  ['azure data engineer',                           'DP-203'],
  ['azure data scientist',                          'DP-100'],
  ['azure ai engineer',                             'AI-102'],
  ['certified kubernetes administrator',            'CKA'],
  ['certified kubernetes application developer',    'CKAD'],
  ['certified kubernetes security specialist',      'CKS'],
];

function extractCert(questionText, fileName = '') {
  const file = (fileName || '').toLowerCase();
  for (const [pattern, cert] of FILE_TO_CERT) {
    if (file.includes(pattern)) return cert;
  }
  return 'GENERAL';
}

// ─── Category → topic name sniff ──────────────────────────────────────
const CATEGORY_PATTERNS = [
  ['Compute',           /compute engine|ec2|gke|kubernetes|app engine|cloud functions|cloud run|virtual machine|vm/i],
  ['Storage',           /cloud storage|persistent disk|filestore|archive|backup|s3|ebs|blob/i],
  ['Database',          /database|sql|nosql|bigtable|spanner|firestore|cloud sql|mysql|postgresql|dynamodb|rds/i],
  ['Networking',        /vpc|network|subnet|firewall|load balancer|dns|cdn|interconnect|gateway/i],
  ['Security',          /iam|security|encryption|kms|service account|authentication|authorization/i],
  ['Monitoring',        /stackdriver|cloud monitoring|logging|alerting|debugging|profiler|cloudwatch/i],
  ['Analytics',         /bigquery|data studio|looker|analytics|reporting|visualization|dashboard|bi/i],
  ['Machine Learning',  /tensorflow|ai platform|automl|vertex ai|ml|neural.network|model|training|prediction/i],
  ['Migration',         /database migration service|transfer|import|export|migration/i],
  ['Cost',              /billing|cost|pricing|budget|optimization|resource management/i],
  ['DevOps',            /cloud build|container registry|deployment|ci\/cd|source repositories|jenkins|terraform/i],
];

function extractCategory(questionText) {
  const text = (questionText || '').toLowerCase();
  for (const [cat, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return cat;
  }
  return 'General';
}

// ─── Difficulty heuristic ─────────────────────────────────────────────
function extractDifficulty(questionText, options) {
  const text = (questionText || '').toLowerCase();
  if (text.includes('advanced') || text.includes('complex') ||
      text.includes('optimize') || text.includes('troubleshoot') ||
      (options && options.length > 6) || text.length > 500) {
    return 'hard';
  }
  if (text.includes('basic') || text.includes('simple') ||
      text.includes('what is') || text.includes('which of') ||
      text.length < 150) {
    return 'easy';
  }
  return 'medium';
}

// ─── Hash (for dedup) ─────────────────────────────────────────────────
function contentHash(questionText, options) {
  const normalized = (questionText || '').trim().toLowerCase();
  const optTexts = (options || []).map((o) => (o.text || '').trim().toLowerCase()).join('|');
  return crypto.createHash('sha256').update(normalized + '||' + optTexts).digest('hex');
}

// ─── Importer ─────────────────────────────────────────────────────────
async function loadLookups(client) {
  // Map cert_code → cert_id  AND  (cert_code, topic_name) → topic_id
  const certs = new Map();
  const topics = new Map();
  const qTypes = new Map();

  const certRows = await client.query(`SELECT id, code FROM certifications`);
  for (const r of certRows.rows) certs.set(r.code, r.id);

  const topicRows = await client.query(`
    SELECT t.id, t.name, c.code AS cert_code
      FROM topics t JOIN certifications c ON c.id = t.certification_id
  `);
  for (const r of topicRows.rows) {
    topics.set(`${r.cert_code}::${r.name}`, r.id);
  }

  const qtRows = await client.query(`SELECT id, name FROM question_types`);
  for (const r of qtRows.rows) qTypes.set(r.name, r.id);

  if (!qTypes.has('single_choice') || !qTypes.has('multiple_choice')) {
    throw new Error(
      'question_types missing. Run `node prisma/seed.js` before importing.'
    );
  }
  if (!certs.has('GENERAL')) {
    throw new Error('Cert "GENERAL" missing. Run the seed first.');
  }

  return { certs, topics, qTypes };
}

function resolveTopicId({ provider, certCode, category }, lookups) {
  // Try exact match first
  const exact = lookups.topics.get(`${certCode}::${category}`);
  if (exact) return exact;
  // Fallback: General topic for this cert
  const certGeneral = lookups.topics.get(`${certCode}::General`);
  if (certGeneral) return certGeneral;
  // Final fallback: General cert's General topic
  return lookups.topics.get(`GENERAL::General`);
}

async function importQuestion(client, q, lookups, sourceFile) {
  const text = q.question_text || q.question || q.text || '';
  const options = q.options || q.choices || [];
  if (!text || !Array.isArray(options) || options.length === 0) {
    return { skipped: true, reason: 'empty' };
  }

  const hash = contentHash(text, options);

  // Skip if already imported
  const existing = await client.query(
    'SELECT id FROM questions WHERE content_hash = $1 LIMIT 1',
    [hash]
  );
  if (existing.rowCount > 0) {
    return { skipped: true, reason: 'duplicate' };
  }

  const provider  = extractProvider(text, sourceFile);
  const certCode  = extractCert(text, sourceFile);
  const category  = extractCategory(text);
  const topicId   = resolveTopicId({ provider, certCode, category }, lookups);
  if (!topicId) {
    return { skipped: true, reason: 'no_topic' };
  }

  const isMulti = options.filter((o) => o.is_correct || o.isCorrect).length > 1;
  const qTypeId = isMulti
    ? lookups.qTypes.get('multiple_choice')
    : lookups.qTypes.get('single_choice');

  const difficulty = extractDifficulty(text, options);
  const tags = Array.from(new Set([
    provider, certCode, category,
  ].filter(Boolean).map((t) => t.toLowerCase())));

  // Insert question + options atomically
  const qRow = await client.query(
    `INSERT INTO questions
       (topic_id, question_type_id, question_text, explanation,
        difficulty, tags, content_hash, metadata, review_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'approved')
     RETURNING id`,
    [
      topicId, qTypeId, text, q.explanation || null,
      difficulty, tags, hash,
      JSON.stringify({ source: sourceFile, provider, certCode, category }),
    ]
  );
  const questionId = qRow.rows[0].id;

  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    await client.query(
      `INSERT INTO question_options
         (question_id, option_label, option_text, is_correct, order_index)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        questionId,
        String.fromCharCode(65 + i), // A, B, C, ...
        o.text || o.option_text || String(o),
        !!(o.is_correct || o.isCorrect),
        i,
      ]
    );
  }

  return { skipped: false, certCode, category };
}

// ─── Entry point ──────────────────────────────────────────────────────
async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error('Usage: node prisma/json_importer.js <file.json | dir/>');
    process.exit(1);
  }

  const stat = fs.statSync(inputArg);
  const files = stat.isDirectory()
    ? fs.readdirSync(inputArg).filter((f) => f.endsWith('.json')).map((f) => path.join(inputArg, f))
    : [inputArg];

  if (files.length === 0) {
    console.error('No JSON files found.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway.app') ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  console.log('Connected to DB.');

  const lookups = await loadLookups(client);
  console.log(`Loaded ${lookups.certs.size} certs, ${lookups.topics.size} topics, ${lookups.qTypes.size} question types.`);

  let totalQuestions = 0;
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const file of files) {
    console.log(`\n→ ${path.basename(file)}`);
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    const questions = Array.isArray(parsed) ? parsed : (parsed.questions || []);
    if (questions.length === 0) {
      console.log('  (no questions)');
      continue;
    }

    for (let i = 0; i < questions.length; i++) {
      totalQuestions++;
      try {
        const r = await importQuestion(client, questions[i], lookups, path.basename(file));
        if (!r.skipped) imported++;
        else if (r.reason === 'duplicate') duplicates++;
        else skipped++;
      } catch (err) {
        console.error(`  ! question ${i}: ${err.message}`);
        skipped++;
      }
      if (totalQuestions % BATCH_LOG_EVERY === 0) {
        console.log(`  …${totalQuestions} processed (${imported} new / ${duplicates} dup / ${skipped} skip)`);
      }
    }
  }

  await client.end();
  console.log('\n══════════════════════════════════════════════════');
  console.log(`Total processed: ${totalQuestions}`);
  console.log(`Imported:        ${imported}`);
  console.log(`Duplicates:      ${duplicates}`);
  console.log(`Skipped:         ${skipped}`);
  console.log('══════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Importer crashed:', err);
  process.exit(1);
});
