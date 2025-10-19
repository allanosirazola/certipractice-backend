// setup-exams-table.js - Crear tabla de exámenes en PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'certification_db',
  password: process.env.DB_PASSWORD || 'certification123',
  port: process.env.DB_PORT || 5432,
});

async function setupExamsTable() {
  const client = await pool.connect();
  
  try {
    console.log('🗄️  Conectando a PostgreSQL...');
    
    // Crear tabla de exámenes
    await client.query(`
      CREATE TABLE IF NOT EXISTS exams (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(255) NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT DEFAULT '',
          provider VARCHAR(50) NOT NULL,
          certification VARCHAR(50) NOT NULL,
          questions JSONB NOT NULL DEFAULT '[]',
          answers JSONB DEFAULT '{}',
          time_limit INTEGER DEFAULT 60,
          time_spent INTEGER DEFAULT 0,
          status VARCHAR(20) DEFAULT 'not_started',
          score INTEGER DEFAULT 0,
          passed BOOLEAN DEFAULT false,
          passing_score INTEGER DEFAULT 70,
          started_at TIMESTAMP NULL,
          completed_at TIMESTAMP NULL,
          settings JSONB DEFAULT '{}',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    console.log('✅ Tabla exams creada');

    // Crear índices
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_exams_user_id ON exams(user_id);',
      'CREATE INDEX IF NOT EXISTS idx_exams_status ON exams(status);',
      'CREATE INDEX IF NOT EXISTS idx_exams_provider ON exams(provider);',
      'CREATE INDEX IF NOT EXISTS idx_exams_certification ON exams(certification);',
      'CREATE INDEX IF NOT EXISTS idx_exams_created_at ON exams(created_at);'
    ];

    for (const indexQuery of indexes) {
      await client.query(indexQuery);
    }
    
    console.log('✅ Índices creados');

    // Crear trigger para updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_exams_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS update_exams_updated_at ON exams;
      CREATE TRIGGER update_exams_updated_at
          BEFORE UPDATE ON exams
          FOR EACH ROW
          EXECUTE FUNCTION update_exams_updated_at();
    `);
    
    console.log('✅ Trigger para updated_at creado');

    // Verificar estructura
    const result = await client.query(`
      SELECT 
          column_name, 
          data_type, 
          is_nullable,
          column_default
      FROM information_schema.columns 
      WHERE table_name = 'exams' 
      ORDER BY ordinal_position;
    `);

    console.log('\n📋 Estructura de tabla exams:');
    console.table(result.rows);

    // Verificar que tenemos las tablas necesarias
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log('\n📊 Tablas disponibles:');
    tables.rows.forEach(row => {
      console.log(`  • ${row.table_name}`);
    });

    console.log('\n🎉 ¡Configuración de base de datos completada!');
    
  } catch (error) {
    console.error('❌ Error configurando tabla exams:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  setupExamsTable().catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
  });
}

module.exports = setupExamsTable;