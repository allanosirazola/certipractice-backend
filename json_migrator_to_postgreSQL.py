#!/usr/bin/env node

const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class QuestionMigrator {
  constructor() {
    this.pool = new Pool({
      user: process.env.DB_USER || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'certification_db',
      password: process.env.DB_PASSWORD || 'password',
      port: process.env.DB_PORT || 5432,
    });

    this.stats = {
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0
    };
  }

  // Generar hash único para detectar duplicados
  generateQuestionHash(questionText, options) {
    const normalizedText = questionText.trim().toLowerCase();
    const normalizedOptions = options
      .map(opt => opt.text.trim().toLowerCase())
      .sort()
      .join('|');
    
    return crypto
      .createHash('sha256')
      .update(normalizedText + normalizedOptions)
      .digest('hex');
  }

  // Extraer proveedor del texto de la pregunta Y del nombre del archivo
  extractProvider(questionText, fileName = '') {
    const text = questionText.toLowerCase();
    const file = fileName.toLowerCase();
    
    // Primero, verificar el nombre del archivo (más confiable)
    if (file.includes('google cloud') || file.includes('gcp')) {
      return 'GCP';
    }
    if (file.includes('aws') || file.includes('amazon')) {
      return 'AWS';
    }
    if (file.includes('azure') || file.includes('microsoft')) {
      return 'Azure';
    }
    if (file.includes('oracle') || file.includes('oci')) {
      return 'Oracle';
    }
    if (file.includes('salesforce')) {
      return 'Salesforce';
    }
    
    // Si no se detecta por archivo, usar el contenido de la pregunta
    if (text.includes('tensorflow') || text.includes('neural') || text.includes('machine learning')) {
      return 'ML';
    }
    if (text.includes('aws') || text.includes('amazon') || text.includes('ec2') || 
        text.includes('s3') || text.includes('dynamodb') || text.includes('lambda')) {
      return 'AWS';
    }
    if (text.includes('google cloud') || text.includes('gcp') || text.includes('gke') || 
        text.includes('bigquery') || text.includes('data studio')) {
      return 'GCP';
    }
    if (text.includes('azure') || text.includes('microsoft') || text.includes('azure functions')) {
      return 'Azure';
    }
    if (text.includes('kubernetes') || text.includes('docker') || text.includes('container')) {
      return 'DevOps';
    }
    
    return 'General';
  }

  // Extraer certificación del texto Y del nombre del archivo
  extractCertification(questionText, fileName = '') {
    const text = questionText.toLowerCase();
    const file = fileName.toLowerCase();
    
    // Patrones específicos de certificaciones por archivo
    const filePatterns = {
      'professional data engineer': 'PDE',
      'professional cloud architect': 'PCA', 
      'associate cloud engineer': 'ACE',
      'professional cloud developer': 'PCD',
      'professional cloud security engineer': 'PCSE',
      'professional cloud network engineer': 'PCNE',
      'professional cloud devops engineer': 'PCDE',
      'professional machine learning engineer': 'PMLE',
      'solutions architect associate': 'SAA-C03',
      'solutions architect professional': 'SAP-C02',
      'developer associate': 'DVA-C02',
      'sysops administrator': 'SOA-C02',
      'devops engineer professional': 'DOP-C02',
      'security specialty': 'SCS-C02',
      'machine learning specialty': 'MLS-C01',
      'data analytics specialty': 'DAS-C01',
      'database specialty': 'DBS-C01',
      'advanced networking specialty': 'ANS-C01',
      'azure fundamentals': 'AZ-900',
      'azure administrator': 'AZ-104',
      'azure developer': 'AZ-204',
      'azure solutions architect expert': 'AZ-305',
      'azure devops engineer expert': 'AZ-400',
      'azure security engineer': 'AZ-500',
      'azure data engineer': 'DP-203',
      'azure data scientist': 'DP-100',
      'azure ai engineer': 'AI-102',
      'certified kubernetes administrator': 'CKA',
      'certified kubernetes application developer': 'CKAD',
      'certified kubernetes security specialist': 'CKS'
    };

    // Buscar por nombre de archivo primero
    for (const [pattern, cert] of Object.entries(filePatterns)) {
      if (file.includes(pattern)) {
        return cert;
      }
    }
    
    // Buscar en el contenido de la pregunta
    const contentPatterns = {
      'SAA-C03': /solutions architect associate|saa.c03/i,
      'SAA-C02': /solutions architect associate|saa.c02/i,
      'DVA-C01': /developer associate|dva.c01/i,
      'SOA-C02': /sysops administrator|soa.c02/i,
      'PDE': /professional data engineer|bigquery|dataflow|pub\/sub/i,
      'PCA': /professional cloud architect|gcp architect/i,
      'ACE': /associate cloud engineer|ace/i,
      'AZ-900': /azure fundamentals|az.900/i,
      'AZ-104': /azure administrator|az.104/i,
      'AZ-204': /azure developer|az.204/i,
      'CKA': /certified kubernetes administrator|cka/i,
      'CKAD': /certified kubernetes application developer|ckad/i,
      'ML-Specialty': /machine learning|tensorflow|neural.network|ai/i
    };

    for (const [cert, pattern] of Object.entries(contentPatterns)) {
      if (pattern.test(text)) return cert;
    }
    
    return 'General';
  }

  // Extraer categoría del texto (especializado para GCP Data Engineer)
  extractCategory(questionText) {
    const text = questionText.toLowerCase();
    
    const categories = {
      'Data Processing': /bigquery|dataflow|dataproc|apache beam|spark|hadoop|etl|batch processing|stream processing/i,
      'Data Storage': /cloud storage|bigtable|firestore|cloud sql|spanner|data lake|warehouse/i,
      'Data Pipeline': /pub\/sub|dataflow|cloud composer|airflow|pipeline|orchestration|workflow/i,
      'Machine Learning': /tensorflow|ai platform|automl|vertex ai|ml|neural.network|model|training|prediction/i,
      'Analytics & BI': /data studio|looker|analytics|reporting|visualization|dashboard|bi/i,
      'Database': /database|sql|nosql|bigtable|spanner|firestore|cloud sql|mysql|postgresql/i,
      'Compute': /compute engine|gke|kubernetes|app engine|cloud functions|cloud run|containers/i,
      'Security & Identity': /iam|security|encryption|kms|service account|authentication|authorization/i,
      'Networking': /vpc|network|subnet|firewall|load balancer|dns|cdn|interconnect/i,
      'Monitoring & Operations': /stackdriver|cloud monitoring|logging|alerting|debugging|profiler/i,
      'Storage': /cloud storage|persistent disk|filestore|archive|backup/i,
      'Serverless': /cloud functions|cloud run|app engine|serverless|event driven/i,
      'DevOps & CI/CD': /cloud build|container registry|deployment|ci\/cd|source repositories/i,
      'Data Migration': /database migration service|transfer|import|export|migration/i,
      'Cost Optimization': /billing|cost|pricing|budget|optimization|resource management/i
    };

    for (const [category, pattern] of Object.entries(categories)) {
      if (pattern.test(text)) return category;
    }
    
    return 'General';
  }

  // Extraer nivel de dificultad
  extractDifficulty(questionText, options) {
    const text = questionText.toLowerCase();
    
    // Indicadores de dificultad alta
    if (text.includes('advanced') || text.includes('complex') || 
        text.includes('optimize') || text.includes('troubleshoot') ||
        options.length > 6 || text.length > 500) {
      return 'hard';
    }
    
    // Indicadores de dificultad baja
    if (text.includes('basic') || text.includes('simple') || 
        text.includes('what is') || text.includes('which of') ||
        text.length < 150) {
      return 'easy';
    }
    
    return 'medium';
  }

  // Extraer tags del texto
  extractTags(questionText) {
    const text = questionText.toLowerCase();
    const tags = [];
    
    const tagPatterns = {
      'tensorflow': /tensorflow/i,
      'neural-networks': /neural.network/i,
      'overfitting': /overfitting|overfit/i,
      'regularization': /dropout|regularization/i,
      'machine-learning': /machine.learning|ml/i,
      'aws-ec2': /ec2|elastic.compute/i,
      'aws-s3': /s3|simple.storage/i,
      'aws-lambda': /lambda|serverless/i,
      'kubernetes': /kubernetes|k8s/i,
      'docker': /docker|container/i,
      'security': /security|encryption|auth/i,
      'networking': /network|vpc|subnet/i,
      'database': /database|sql|nosql/i,
      'monitoring': /monitoring|logging|metrics/i,
      'performance': /performance|optimization|scaling/i
    };

    for (const [tag, pattern] of Object.entries(tagPatterns)) {
      if (pattern.test(text)) tags.push(tag);
    }
    
    return tags;
  }

  // Procesar archivo JSON
  async processJsonFile(filePath) {
    try {
      console.log(`\n🔄 Procesando archivo: ${filePath}`);
      
      const data = await fs.readFile(filePath, 'utf8');
      const jsonData = JSON.parse(data);
      
      // Manejar diferentes estructuras de JSON
      let questions = [];
      if (jsonData.questions && Array.isArray(jsonData.questions)) {
        questions = jsonData.questions;
      } else if (Array.isArray(jsonData)) {
        questions = jsonData;
      } else {
        throw new Error('Estructura de JSON no reconocida');
      }

      console.log(`📊 Encontradas ${questions.length} preguntas`);
      
      // Extraer nombre del archivo para contexto
      const fileName = path.basename(filePath, '.json');
      console.log(`📝 Archivo de certificación: ${fileName}`);

      for (const question of questions) {
        await this.processQuestion(question, fileName);
      }

      console.log(`✅ Archivo procesado: ${path.basename(filePath)}`);
      
    } catch (error) {
      console.error(`❌ Error procesando ${filePath}:`, error.message);
      this.stats.errors++;
    }
  }

  // Procesar una pregunta individual
  async processQuestion(questionData, fileName = '') {
    const client = await this.pool.connect();
    
    try {
      this.stats.processed++;
      
      // Normalizar datos de entrada
      const questionText = questionData.question || questionData.text || '';
      const options = questionData.options || [];
      
      if (!questionText.trim()) {
        console.log(`⚠️  Pregunta ${questionData.id} sin texto, saltando...`);
        this.stats.skipped++;
        return;
      }

      if (options.length < 2) {
        console.log(`⚠️  Pregunta ${questionData.id} con menos de 2 opciones, saltando...`);
        this.stats.skipped++;
        return;
      }

      // Generar hash para detectar duplicados
      const questionHash = this.generateQuestionHash(questionText, options);
      
      // Verificar si ya existe
      const existingQuestion = await client.query(
        'SELECT id, updated_at FROM questions WHERE content_hash = $1',
        [questionHash]
      );

      const provider = this.extractProvider(questionText, fileName);
      const certification = this.extractCertification(questionText, fileName);
      const category = this.extractCategory(questionText);
      const difficulty = this.extractDifficulty(questionText, options);
      const tags = this.extractTags(questionText);

      // Detectar respuestas múltiples
      const correctAnswers = this.extractCorrectAnswers(questionData, options);
      const isMultipleChoice = correctAnswers.length > 1;

      // Metadatos adicionales del archivo
      const metadata = {
        sourceFile: fileName,
        originalId: questionData.id,
        hasCorrectAnswer: correctAnswers.length > 0,
        extractionDate: new Date().toISOString()
      };

      if (existingQuestion.rows.length > 0) {
        // Actualizar pregunta existente
        const questionId = existingQuestion.rows[0].id;
        
        await client.query('BEGIN');
        
        // Actualizar pregunta
        await client.query(`
          UPDATE questions SET
            question_text = $1,
            explanation = $2,
            provider = $3,
            certification = $4,
            category = $5,
            difficulty = $6,
            is_multiple_choice = $7,
            tags = $8,
            metadata = $9,
            updated_at = NOW()
          WHERE id = $10
        `, [
          questionText,
          questionData.explanation || '',
          provider,
          certification,
          category,
          difficulty,
          isMultipleChoice,
          tags,
          JSON.stringify(metadata),
          questionId
        ]);

        // Eliminar opciones existentes
        await client.query('DELETE FROM question_options WHERE question_id = $1', [questionId]);
        
        // Insertar nuevas opciones
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          await client.query(`
            INSERT INTO question_options (
              question_id, option_label, option_text, 
              is_correct, option_order
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            questionId,
            option.label || String.fromCharCode(65 + i), // A, B, C, D...
            option.text,
            correctAnswers.includes(i),
            i + 1
          ]);
        }

        await client.query('COMMIT');
        this.stats.updated++;
        
        if (this.stats.processed % 10 === 0) {
          console.log(`🔄 Actualizada pregunta existente (${this.stats.processed}/${this.stats.updated} actualizadas)`);
        }
        
      } else {
        // Insertar nueva pregunta
        await client.query('BEGIN');
        
        const questionResult = await client.query(`
          INSERT INTO questions (
            question_text, explanation, provider, certification, 
            category, difficulty, is_multiple_choice, tags, content_hash, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id
        `, [
          questionText,
          questionData.explanation || '',
          provider,
          certification,
          category,
          difficulty,
          isMultipleChoice,
          tags,
          questionHash,
          JSON.stringify(metadata)
        ]);

        const questionId = questionResult.rows[0].id;

        // Insertar opciones
        for (let i = 0; i < options.length; i++) {
          const option = options[i];
          await client.query(`
            INSERT INTO question_options (
              question_id, option_label, option_text, 
              is_correct, option_order
            ) VALUES ($1, $2, $3, $4, $5)
          `, [
            questionId,
            option.label || String.fromCharCode(65 + i), // A, B, C, D...
            option.text,
            correctAnswers.includes(i),
            i + 1
          ]);
        }

        // Inicializar estadísticas
        await client.query(
          'INSERT INTO question_stats (question_id) VALUES ($1)',
          [questionId]
        );

        await client.query('COMMIT');
        this.stats.inserted++;
        
        if (this.stats.processed % 10 === 0) {
          console.log(`✅ Nueva pregunta insertada (${this.stats.processed}/${this.stats.inserted} nuevas)`);
        }
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`❌ Error procesando pregunta ${questionData.id || 'sin ID'} de ${fileName}:`, error.message);
      this.stats.errors++;
    } finally {
      client.release();
    }
  }

  // Extraer respuestas correctas del formato original
  extractCorrectAnswers(questionData, options) {
    const correctAnswers = [];
    
    // Método 1: correctAnswer definido (índice único)
    if (questionData.correctAnswer !== null && questionData.correctAnswer !== undefined) {
      correctAnswers.push(questionData.correctAnswer);
    }
    
    // Método 2: correctAnswers array
    if (questionData.correctAnswers && Array.isArray(questionData.correctAnswers)) {
      correctAnswers.push(...questionData.correctAnswers);
    }
    
    // Método 3: opciones marcadas como correctas
    if (correctAnswers.length === 0) {
      options.forEach((option, index) => {
        if (option.isCorrect || option.correct) {
          correctAnswers.push(index);
        }
      });
    }
    
    // Método 4: buscar por patrones en el texto (fallback)
    if (correctAnswers.length === 0) {
      // Buscar patrones como "A.", "B.", etc. en la explicación
      const explanation = questionData.explanation || '';
      const matches = explanation.match(/\b[A-Z]\./g);
      if (matches) {
        matches.forEach(match => {
          const index = match.charCodeAt(0) - 65; // A=0, B=1, etc.
          if (index >= 0 && index < options.length) {
            correctAnswers.push(index);
          }
        });
      }
    }
    
    // Si no encontramos respuestas correctas, marcar como sin respuesta
    if (correctAnswers.length === 0) {
      console.log(`⚠️  No se encontraron respuestas correctas para pregunta ${questionData.id}`);
    }
    
    return [...new Set(correctAnswers)]; // Eliminar duplicados
  }

  // Inicializar tablas de base de datos
  async initializeDatabase() {
    const client = await this.pool.connect();
    
    try {
      console.log('🗄️  Inicializando estructura de base de datos...');
      
      // Crear tablas si no existen
      await client.query(`
        CREATE TABLE IF NOT EXISTS questions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          question_text TEXT NOT NULL,
          explanation TEXT DEFAULT '',
          provider VARCHAR(50) NOT NULL DEFAULT 'General',
          certification VARCHAR(50) NOT NULL DEFAULT 'General',
          category VARCHAR(100) NOT NULL DEFAULT 'General',
          difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
          is_multiple_choice BOOLEAN DEFAULT false,
          tags TEXT[] DEFAULT '{}',
          content_hash VARCHAR(64) UNIQUE NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          is_active BOOLEAN DEFAULT true
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS question_options (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          question_id UUID REFERENCES questions(id) ON DELETE CASCADE,
          option_label VARCHAR(5) NOT NULL,
          option_text TEXT NOT NULL,
          is_correct BOOLEAN DEFAULT false,
          option_order INTEGER NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS question_stats (
          question_id UUID PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
          total_attempts INTEGER DEFAULT 0,
          correct_attempts INTEGER DEFAULT 0,
          average_time_seconds INTEGER DEFAULT 0,
          last_attempted TIMESTAMP
        );
      `);

      // Crear índices para optimizar consultas
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_questions_provider ON questions(provider);
        CREATE INDEX IF NOT EXISTS idx_questions_certification ON questions(certification);
        CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
        CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON questions(difficulty);
        CREATE INDEX IF NOT EXISTS idx_questions_tags ON questions USING GIN(tags);
        CREATE INDEX IF NOT EXISTS idx_questions_content_hash ON questions(content_hash);
        CREATE INDEX IF NOT EXISTS idx_question_options_question_id ON question_options(question_id);
      `);

      console.log('✅ Base de datos inicializada correctamente');
      
    } catch (error) {
      console.error('❌ Error inicializando base de datos:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Procesar múltiples archivos
  async processMultipleFiles(filePatterns) {
    console.log('🚀 Iniciando migración de preguntas...\n');
    
    await this.initializeDatabase();
    
    for (const pattern of filePatterns) {
      const files = await this.findFiles(pattern);
      
      for (const file of files) {
        await this.processJsonFile(file);
      }
    }
    
    this.printSummary();
  }

  // Encontrar archivos que coincidan con el patrón
  async findFiles(pattern) {
    try {
      if (pattern.includes('*')) {
        // Manejar wildcards básicos
        const dir = path.dirname(pattern);
        const files = await fs.readdir(dir);
        const baseName = path.basename(pattern).replace('*', '');
        
        return files
          .filter(file => file.includes(baseName) && file.endsWith('.json'))
          .map(file => path.join(dir, file));
      } else {
        // Archivo específico
        return [pattern];
      }
    } catch (error) {
      console.error(`❌ Error buscando archivos ${pattern}:`, error.message);
      return [];
    }
  }

  // Imprimir resumen de la migración
  printSummary() {
    console.log('\n' + '='.repeat(50));
    console.log('📊 RESUMEN DE MIGRACIÓN');
    console.log('='.repeat(50));
    console.log(`✅ Preguntas procesadas: ${this.stats.processed}`);
    console.log(`🆕 Preguntas insertadas: ${this.stats.inserted}`);
    console.log(`🔄 Preguntas actualizadas: ${this.stats.updated}`);
    console.log(`⏭️  Preguntas saltadas: ${this.stats.skipped}`);
    console.log(`❌ Errores: ${this.stats.errors}`);
    console.log('='.repeat(50));

    if (this.stats.errors > 0) {
      console.log('⚠️  Revisa los errores anteriores para más detalles');
    } else {
      console.log('🎉 Migración completada exitosamente!');
    }
  }

  // Cerrar conexión
  async close() {
    await this.pool.end();
  }
}

// Script principal
async function main() {
  const migrator = new QuestionMigrator();
  
  try {
    // Obtener archivos desde argumentos de línea de comandos
    const files = process.argv.slice(2);
    
    if (files.length === 0) {
      console.log('❌ Uso: node migrator.js <archivo1.json> [archivo2.json] ...');
      console.log('   Ejemplo: node migrator.js ./data/questions.json');
      console.log('   Ejemplo: node migrator.js ./data/*.json');
      process.exit(1);
    }
    
    await migrator.processMultipleFiles(files);
    
  } catch (error) {
    console.error('❌ Error fatal:', error);
    process.exit(1);
  } finally {
    await migrator.close();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  main();
}

module.exports = QuestionMigrator;